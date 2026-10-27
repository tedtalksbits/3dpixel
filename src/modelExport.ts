import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Color } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { Project } from './kenshape';
import { MeshPart, buildModel } from './mesh';
import { Part, treeOrder } from './rig';

export type ModelScale = 'tile' | 'fit';
export type ModelPivot = 'center' | 'bottom';

export interface ModelExportOptions {
  /** 'tile' = one tile is 1 unit, 'fit' = the model's widest side is 1 unit. */
  scale?: ModelScale;
  /** 'bottom' puts the origin at the bottom centre of the drawing, handy for props standing on the ground. */
  pivot?: ModelPivot;
}

type Vec3 = [number, number, number];

/** One rig part's meshes, in model space, with its pivot. */
interface PartModel {
  part: Part;
  name: string;
  meshes: MeshPart[];
  pivot: Vec3;
}

function transformFor(p: Project, meshes: MeshPart[], opts: ModelExportOptions) {
  const s = opts.scale === 'fit' ? 1 / Math.max(p.size.x, p.size.y) : 1;
  let minY = Infinity;
  if (opts.pivot === 'bottom') for (const m of meshes) for (let i = 1; i < m.positions.length; i += 3) minY = Math.min(minY, m.positions[i]);
  const dy = opts.pivot === 'bottom' && isFinite(minY) ? -minY : 0;
  return (x: number, y: number, z: number): Vec3 => [x * s, (y + dy) * s, z * s];
}

const materialName = (p: Project, c: number) => `color${c}_${(p.colors[c] ?? '#FFFFFF').slice(1).toUpperCase()}`;

/** Node names engines can use: no spaces, unique. */
function uniqueNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((n) => {
    const base = n.trim().replace(/\s+/g, '_').replace(/[^\w\-.]/g, '') || 'part';
    let name = base;
    for (let i = 2; used.has(name); i++) name = `${base}_${i}`;
    used.add(name);
    return name;
  });
}

/** Each part's meshes, parents first. Parts sit at their z offset; pivots are in model space. */
function partModels(p: Project, rig: Part[]): PartModel[] {
  const mult = (p.depthMultiplier ?? 100) / 100;
  const ordered = treeOrder(rig);
  const names = uniqueNames(ordered.map((o) => o.name));
  return ordered.map((part, i) => {
    const dz = part.z * mult;
    const meshes = buildModel({ ...p, tiles: part.tiles });
    if (dz) for (const m of meshes) for (let k = 2; k < m.positions.length; k += 3) m.positions[k] += dz;
    return { part, name: names[i], meshes, pivot: [part.pivot[0] - p.size.x / 2, p.size.y / 2 - part.pivot[1], dz] };
  });
}

function makeMesh(p: Project, m: MeshPart, pos: number[], name: string) {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(m.normals, 3));
  geo.setIndex(m.indices);
  const mat = new MeshStandardMaterial({ color: new Color(p.colors[m.color] ?? '#ffffff'), roughness: 1, metalness: 0 });
  mat.name = materialName(p, m.color);
  const mesh = new Mesh(geo, mat);
  mesh.name = name;
  return mesh;
}

/**
 * Three.js group with one mesh per palette colour. With more than one rig part, each part is a
 * node positioned at its pivot (relative to its parent's), holding that part's meshes, so the
 * part rotates about its pivot when the node is rotated.
 */
export function buildGroup(p: Project, opts: ModelExportOptions = {}, rig?: Part[]): Group {
  const group = new Group();
  group.name = p.title || 'shape';

  if (!rig || rig.length < 2) {
    const meshes = buildModel(rig ? { ...p, tiles: rig[0].tiles } : p);
    const tf = transformFor(p, meshes, opts);
    for (const m of meshes) {
      const pos: number[] = [];
      for (let i = 0; i < m.positions.length; i += 3) pos.push(...tf(m.positions[i], m.positions[i + 1], m.positions[i + 2]));
      group.add(makeMesh(p, m, pos, materialName(p, m.color)));
    }
    return group;
  }

  const models = partModels(p, rig);
  const tf = transformFor(p, models.flatMap((o) => o.meshes), opts);
  const nodes = new Map<string, { node: Group; at: Vec3 }>();
  for (const pm of models) {
    const at = tf(...pm.pivot);
    const node = new Group();
    node.name = pm.name;
    node.userData.partId = pm.part.id;
    const parent = pm.part.parent ? nodes.get(pm.part.parent) : undefined;
    const origin = parent?.at ?? [0, 0, 0];
    node.position.set(at[0] - origin[0], at[1] - origin[1], at[2] - origin[2]);
    (parent?.node ?? group).add(node);
    nodes.set(pm.part.id, { node, at });
    for (const m of pm.meshes) {
      const pos: number[] = [];
      for (let i = 0; i < m.positions.length; i += 3) {
        const v = tf(m.positions[i], m.positions[i + 1], m.positions[i + 2]);
        pos.push(v[0] - at[0], v[1] - at[1], v[2] - at[2]);
      }
      node.add(makeMesh(p, m, pos, `${pm.name}_${materialName(p, m.color)}`));
    }
  }
  return group;
}

export function disposeGroup(group: Group) {
  group.traverse((o) => {
    if (o instanceof Mesh) {
      o.geometry.dispose();
      (o.material as MeshStandardMaterial).dispose();
    }
  });
}

export async function exportGlb(p: Project, opts: ModelExportOptions = {}, rig?: Part[]): Promise<Blob> {
  const group = buildGroup(p, opts, rig);
  const out = await new GLTFExporter().parseAsync(group, { binary: true });
  disposeGroup(group);
  return new Blob([out as ArrayBuffer], { type: 'model/gltf-binary' });
}

/** Wavefront OBJ plus its MTL; one object per rig part, faces grouped by material. OBJ can't hold pivots. */
export function exportObj(p: Project, mtlName: string, opts: ModelExportOptions = {}, rig?: Part[]): { obj: string; mtl: string } {
  const title = (p.title || 'shape').replace(/\s+/g, '_');
  const objects =
    rig && rig.length > 1
      ? partModels(p, rig).map((o) => ({ name: o.name, meshes: o.meshes }))
      : [{ name: title, meshes: buildModel(rig ? { ...p, tiles: rig[0].tiles } : p) }];
  const tf = transformFor(p, objects.flatMap((o) => o.meshes), opts);
  const f = (n: number) => +n.toFixed(6);
  const lines = [`# ${p.title}`, `mtllib ${mtlName}`];
  const used = new Set<number>();
  let vBase = 1;
  for (const o of objects) {
    lines.push(`o ${o.name}`);
    for (const m of o.meshes) {
      used.add(m.color);
      for (let i = 0; i < m.positions.length; i += 3) lines.push(`v ${tf(m.positions[i], m.positions[i + 1], m.positions[i + 2]).map(f).join(' ')}`);
      for (let i = 0; i < m.normals.length; i += 3) lines.push(`vn ${f(m.normals[i])} ${f(m.normals[i + 1])} ${f(m.normals[i + 2])}`);
      lines.push(`usemtl ${materialName(p, m.color)}`);
      for (let i = 0; i < m.indices.length; i += 3) {
        const [a, b, c] = [m.indices[i], m.indices[i + 1], m.indices[i + 2]].map((k) => k + vBase);
        lines.push(`f ${a}//${a} ${b}//${b} ${c}//${c}`);
      }
      vBase += m.positions.length / 3;
    }
  }

  const mtl: string[] = [];
  for (const c of [...used].sort((a, b) => a - b)) {
    const hex = p.colors[c] ?? '#FFFFFF';
    const rgb = [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(6)).join(' ');
    mtl.push(`newmtl ${materialName(p, c)}`, `Kd ${rgb}`, 'Ka 0 0 0', 'Ks 0 0 0', 'd 1', 'illum 1', '');
  }
  return { obj: lines.join('\n') + '\n', mtl: mtl.join('\n') };
}
