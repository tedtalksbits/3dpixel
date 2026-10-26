import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Color } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { Project } from './kenshape';
import { MeshPart, buildModel } from './mesh';

export type ModelScale = 'tile' | 'fit';
export type ModelPivot = 'center' | 'bottom';

export interface ModelExportOptions {
  /** 'tile' = one tile is 1 unit, 'fit' = the model's widest side is 1 unit. */
  scale?: ModelScale;
  /** 'bottom' puts the origin at the bottom centre of the drawing, handy for props standing on the ground. */
  pivot?: ModelPivot;
}

function transformFor(p: Project, parts: MeshPart[], opts: ModelExportOptions) {
  const s = opts.scale === 'fit' ? 1 / Math.max(p.size.x, p.size.y) : 1;
  let minY = Infinity;
  if (opts.pivot === 'bottom') for (const m of parts) for (let i = 1; i < m.positions.length; i += 3) minY = Math.min(minY, m.positions[i]);
  const dy = opts.pivot === 'bottom' && isFinite(minY) ? -minY : 0;
  return (x: number, y: number, z: number): [number, number, number] => [x * s, (y + dy) * s, z * s];
}

const materialName = (p: Project, c: number) => `color${c}_${(p.colors[c] ?? '#FFFFFF').slice(1).toUpperCase()}`;

/** Three.js group with one mesh per palette colour. */
export function buildGroup(p: Project, opts: ModelExportOptions = {}, parts = buildModel(p)): Group {
  const tf = transformFor(p, parts, opts);
  const group = new Group();
  group.name = p.title || 'shape';
  for (const m of parts) {
    const pos: number[] = [];
    for (let i = 0; i < m.positions.length; i += 3) pos.push(...tf(m.positions[i], m.positions[i + 1], m.positions[i + 2]));
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new Float32BufferAttribute(m.normals, 3));
    geo.setIndex(m.indices);
    const mat = new MeshStandardMaterial({ color: new Color(p.colors[m.color] ?? '#ffffff'), roughness: 1, metalness: 0 });
    mat.name = materialName(p, m.color);
    const mesh = new Mesh(geo, mat);
    mesh.name = mat.name;
    group.add(mesh);
  }
  return group;
}

export async function exportGlb(p: Project, opts: ModelExportOptions = {}): Promise<Blob> {
  const group = buildGroup(p, opts);
  const out = await new GLTFExporter().parseAsync(group, { binary: true });
  group.traverse((o) => {
    if (o instanceof Mesh) {
      o.geometry.dispose();
      (o.material as MeshStandardMaterial).dispose();
    }
  });
  return new Blob([out as ArrayBuffer], { type: 'model/gltf-binary' });
}

/** Wavefront OBJ plus its MTL; faces are grouped by material. */
export function exportObj(p: Project, mtlName: string, opts: ModelExportOptions = {}): { obj: string; mtl: string } {
  const parts = buildModel(p);
  const tf = transformFor(p, parts, opts);
  const f = (n: number) => +n.toFixed(6);
  const lines = [`# ${p.title}`, `mtllib ${mtlName}`, `o ${(p.title || 'shape').replace(/\s+/g, '_')}`];
  let vBase = 1;
  for (const m of parts) {
    for (let i = 0; i < m.positions.length; i += 3) lines.push(`v ${tf(m.positions[i], m.positions[i + 1], m.positions[i + 2]).map(f).join(' ')}`);
    for (let i = 0; i < m.normals.length; i += 3) lines.push(`vn ${f(m.normals[i])} ${f(m.normals[i + 1])} ${f(m.normals[i + 2])}`);
    lines.push(`usemtl ${materialName(p, m.color)}`);
    for (let i = 0; i < m.indices.length; i += 3) {
      const [a, b, c] = [m.indices[i], m.indices[i + 1], m.indices[i + 2]].map((k) => k + vBase);
      lines.push(`f ${a}//${a} ${b}//${b} ${c}//${c}`);
    }
    vBase += m.positions.length / 3;
  }

  const mtl: string[] = [];
  for (const m of parts) {
    const hex = p.colors[m.color] ?? '#FFFFFF';
    const rgb = [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(6)).join(' ');
    mtl.push(`newmtl ${materialName(p, m.color)}`, `Kd ${rgb}`, 'Ka 0 0 0', 'Ks 0 0 0', 'd 1', 'illum 1', '');
  }
  return { obj: lines.join('\n') + '\n', mtl: mtl.join('\n') };
}
