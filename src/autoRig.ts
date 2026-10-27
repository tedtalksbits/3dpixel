// Auto-rig a character drawing from a skeleton (PixelLab's 18 joints): split the tiles into body,
// head, arms and legs, put each pivot on its joint (neck, shoulder, hip), and give the parts their
// biped roles, so the biped presets work straight away.
//
// Each tile goes to the nearest bone, measured to the bone's line segment; the torso is the
// shoulder–hip quad. Tiles cut off from the rest of their part (a stray bit of shoulder that
// ended up "arm") then join the neighbouring part they share the most edges with.
// Front-facing sprites (shoulders spread across the image) get the template's front facing, where
// limbs swing towards the viewer; side views get near and far limbs from the joints' draw order.

import { Project, Tile, emptyTile } from './kenshape';
import { Part, newPartId, emptyGrid } from './rig';
import { Facing, RigTemplate } from './templates';
import type { Keypoint, SkeletonLabel } from './pixellab';

type V = [number, number];

export interface AutoRigResult {
  parts: Part[];
  template: RigTemplate;
  /** Joints in tile units, for showing what was found. */
  joints: Map<SkeletonLabel, V>;
  notes: string[];
}

const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1]];
const mid = (a: V, b: V): V => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const len = (a: V) => Math.hypot(a[0], a[1]);

function segDist(p: V, a: V, b: V): number {
  const ab = sub(b, a);
  const l2 = ab[0] ** 2 + ab[1] ** 2;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2)) : 0;
  return len(sub(p, [a[0] + ab[0] * t, a[1] + ab[1] * t]));
}

function inPolygon(p: V, poly: V[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const snap = (v: number) => Math.round(v * 2) / 2;

interface Bone {
  key: string;
  name: string;
  role: string;
  pivot: V;
  dist: (p: V) => number;
}

/**
 * Rig the flattened drawing `tiles`. Keypoints are fractions of an image covering the whole grid,
 * as estimateSkeleton returns them.
 */
export function autoRig(p: Project, tiles: Tile[], keypoints: Keypoint[]): AutoRigResult {
  const W = p.size.x, H = p.size.y;
  const joints = new Map<SkeletonLabel, V>();
  for (const k of keypoints) joints.set(k.label, [k.x * W, k.y * H]);
  const z = new Map(keypoints.map((k) => [k.label, k.z_index]));
  const need: SkeletonLabel[] = ['NECK', 'RIGHT SHOULDER', 'LEFT SHOULDER', 'RIGHT HIP', 'LEFT HIP'];
  const missing = need.filter((l) => !joints.has(l));
  if (missing.length) throw new Error(`The skeleton is missing ${missing.join(', ').toLowerCase()}, so this doesn't look like a two-legged character.`);
  const J = (l: SkeletonLabel, fallback?: V): V => joints.get(l) ?? fallback!;

  const neck = J('NECK');
  const rs = J('RIGHT SHOULDER'), ls = J('LEFT SHOULDER');
  const rh = J('RIGHT HIP'), lh = J('LEFT HIP');
  const pelvis = mid(rh, lh);
  const face = joints.get('NOSE') ?? (joints.has('RIGHT EYE') && joints.has('LEFT EYE') ? mid(J('RIGHT EYE'), J('LEFT EYE')) : [neck[0], neck[1] - len(sub(pelvis, neck)) * 0.3]);
  // the nose sits mid-face, so the head reaches about as far again past it
  const headTop: V = [face[0] + (face[0] - neck[0]) * 0.9, face[1] + (face[1] - neck[1]) * 0.9];

  // front or side: in a front view the shoulders and hips spread across the image
  const torsoH = Math.max(1, Math.abs(pelvis[1] - neck[1]));
  const spread = (Math.abs(rs[0] - ls[0]) + Math.abs(rh[0] - lh[0])) / 2;
  const front = spread > torsoH * 0.3;
  const facing: Facing = front ? 'front' : face[0] >= neck[0] ? 'right' : 'left';

  // which side is nearer the viewer: the one drawn on top
  const zOf = (side: 'RIGHT' | 'LEFT') =>
    (['SHOULDER', 'ELBOW', 'ARM', 'HIP', 'KNEE', 'LEG'] as const).reduce((s, j) => s + (z.get(`${side} ${j}` as SkeletonLabel) ?? 0), 0);
  const nearSide = zOf('LEFT') > zOf('RIGHT') ? 'LEFT' : 'RIGHT';
  const sideName = (side: 'RIGHT' | 'LEFT') => (front ? (side === 'RIGHT' ? 'Right' : 'Left') : side === nearSide ? 'Near' : 'Far');
  const sideRole = (side: 'RIGHT' | 'LEFT') => (side === nearSide ? 'near' : 'far');

  const torsoQuad: V[] = [rs, ls, lh, rh];
  const bones: Bone[] = [
    {
      key: 'body',
      name: 'Body',
      role: 'body',
      pivot: pelvis,
      // inside the shoulder–hip outline is body; outside it, the sides and hip line count but not
      // the shoulder line, and limbs win close calls, so shoulder pads turn with the arm
      dist: (q) =>
        front && inPolygon(q, torsoQuad) ? 0 : Math.min(segDist(q, neck, pelvis), segDist(q, rs, rh), segDist(q, ls, lh), segDist(q, rh, lh)) + 0.5,
    },
    {
      key: 'head',
      name: 'Head',
      role: 'head',
      pivot: neck,
      // only past the neck: the top of the chest stays body
      dist: (q) => ((q[0] - neck[0]) * (headTop[0] - neck[0]) + (q[1] - neck[1]) * (headTop[1] - neck[1]) < 0 ? Infinity : segDist(q, neck, headTop)),
    },
  ];
  for (const side of ['RIGHT', 'LEFT'] as const) {
    const sh = J(`${side} SHOULDER`), el = J(`${side} ELBOW`, sh), hand = J(`${side} ARM`, el);
    const hip = J(`${side} HIP`), knee = J(`${side} KNEE`, hip), foot = J(`${side} LEG`, knee);
    bones.push(
      { key: `arm.${side}`, name: `${sideName(side)} arm`, role: `arm.${sideRole(side)}`, pivot: sh, dist: (q) => Math.min(segDist(q, sh, el), segDist(q, el, hand)) },
      { key: `leg.${side}`, name: `${sideName(side)} leg`, role: `leg.${sideRole(side)}`, pivot: hip, dist: (q) => Math.min(segDist(q, hip, knee), segDist(q, knee, foot)) },
    );
  }

  // nearest bone per tile
  const owner = new Int16Array(W * H).fill(-1);
  for (let x = 0; x < W; x++)
    for (let y = 0; y < H; y++) {
      const i = x * H + y;
      if (tiles[i].color < 0) continue;
      const c: V = [x + 0.5, y + 0.5];
      let best = 0, bd = Infinity;
      bones.forEach((b, bi) => {
        const d = b.dist(c);
        if (d < bd - 1e-9) (bd = d), (best = bi);
      });
      owner[i] = best;
    }
  cleanUp(owner, W, H, bones.length);

  // side views: far limbs sit behind the body and near ones in front, by about a quarter of its depth
  let maxDepth = 1;
  for (let i = 0; i < owner.length; i++) if (owner[i] >= 0) maxDepth = Math.max(maxDepth, tiles[i].depth || 1);
  const offset = front ? 0 : snap(maxDepth / 4);

  const parts: Part[] = [];
  const notes: string[] = [];
  bones.forEach((b, bi) => {
    const grid = emptyGrid(p);
    let n = 0;
    for (let i = 0; i < owner.length; i++) if (owner[i] === bi) (grid[i] = { ...emptyTile(), ...tiles[i] }), n++;
    if (!n) {
      notes.push(`No tiles for the ${b.name.toLowerCase()}.`);
      return;
    }
    const far = b.role.endsWith('.far');
    const near = b.role.endsWith('.near');
    parts.push({
      id: b.key === 'body' ? 'body' : newPartId(),
      name: b.name,
      tiles: grid,
      pivot: [snap(b.pivot[0]), snap(b.pivot[1])],
      z: far ? -offset : near ? offset : 0,
      parent: b.key === 'body' ? null : 'body',
      visible: true,
      role: b.role,
    });
  });
  if (!parts.some((pt) => pt.id === 'body')) throw new Error('No tiles landed on the body; is the skeleton on the character?');
  notes.unshift(`Rigged ${parts.length} parts, facing ${facing === 'front' ? 'the viewer' : facing}.`);
  return { parts, template: { kind: 'biped', facing }, joints, notes };
}

/** Tiles cut off from the main piece of their part join the neighbouring part they touch most. */
function cleanUp(owner: Int16Array, W: number, H: number, nParts: number) {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? -1 : owner[x * H + y]);
  for (let pass = 0; pass < 4; pass++) {
    // label the 4-connected pieces of each part
    const piece = new Int32Array(W * H).fill(-1);
    const sizes: number[] = [];
    const partOf: number[] = [];
    for (let i = 0; i < owner.length; i++) {
      if (owner[i] < 0 || piece[i] >= 0) continue;
      const id = sizes.length;
      let size = 0;
      const stack = [i];
      piece[i] = id;
      while (stack.length) {
        const j = stack.pop()!;
        size++;
        const x = Math.floor(j / H), y = j % H;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          const k = nx * H + ny;
          if (at(nx, ny) === owner[i] && piece[k] < 0) (piece[k] = id), stack.push(k);
        }
      }
      sizes.push(size);
      partOf.push(owner[i]);
    }
    const main = new Int32Array(nParts).fill(-1);
    sizes.forEach((s, id) => {
      const pt = partOf[id];
      if (main[pt] < 0 || s > sizes[main[pt]]) main[pt] = id;
    });
    // each stray piece moves as a whole, to the part it shares the most edges with
    const votes = new Map<number, Map<number, number>>();
    for (let i = 0; i < owner.length; i++) {
      if (owner[i] < 0 || main[owner[i]] === piece[i]) continue;
      const x = Math.floor(i / H), y = i % H;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        const o = at(nx, ny);
        if (o < 0 || o === owner[i]) continue;
        const v = votes.get(piece[i]) ?? new Map<number, number>();
        v.set(o, (v.get(o) ?? 0) + 1);
        votes.set(piece[i], v);
      }
    }
    const target = new Map([...votes].map(([id, v]) => [id, [...v].sort((a, b) => b[1] - a[1])[0][0]]));
    let moved = 0;
    for (let i = 0; i < owner.length; i++) {
      const t = target.get(piece[i]);
      if (t !== undefined) (owner[i] = t), moved++; // a piece touching nothing stays put
    }
    if (!moved) break;
  }
}
