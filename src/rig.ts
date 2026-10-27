// Parts for rigging: a model is a stack of layers ("parts"), each with its own tile grid, a pivot
// it rotates around, a Z offset and a parent. They become one glTF node each, so engines can move
// them. The .kenshape keeps the flattened art in `tiles` (so Kenney Shape still opens it) and the
// parts under the extra key `rig`.

import { Project, Tile, emptyTile } from './kenshape';
import { Clip, parseClips } from './anim';

export interface Part {
  id: string;
  name: string;
  /** Full grid, same layout as Project.tiles. */
  tiles: Tile[];
  /** Rotation centre in tile units from the top-left, y down. Snaps to half tiles in the editor. */
  pivot: [number, number];
  /** Offset along Z in tile units (scaled by depthMultiplier like depth); negative = behind. */
  z: number;
  parent: string | null;
  /** Editor only: hidden parts are still saved and exported. */
  visible: boolean;
}

export const RIG_KEY = 'rig';

let counter = 0;
export const newPartId = () => `p${Date.now().toString(36)}${(counter++).toString(36)}`;

export const emptyGrid = (p: Project) => Array.from({ length: p.size.x * p.size.y }, emptyTile);

export function basePart(p: Project, tiles = p.tiles): Part {
  return { id: 'body', name: 'Body', tiles, pivot: [p.size.x / 2, p.size.y / 2], z: 0, parent: null, visible: true };
}

/** Parts in drawing order, back to front: by z, then by list order. */
export function drawOrder(parts: Part[]): Part[] {
  return parts.map((part, i) => ({ part, i })).sort((a, b) => a.part.z - b.part.z || a.i - b.i).map((o) => o.part);
}

/** One grid with every part composited, front-most tile wins. */
export function flattenTiles(p: Project, parts: Part[]): Tile[] {
  if (parts.length === 1) return parts[0].tiles;
  const out = emptyGrid(p);
  for (const part of drawOrder(parts)) part.tiles.forEach((t, i) => t.color >= 0 && (out[i] = t));
  return out;
}

/** Would making `parent` the parent of `id` create a loop? */
export function wouldCycle(parts: Part[], id: string, parent: string | null): boolean {
  for (let cur = parent, n = 0; cur && n <= parts.length; n++) {
    if (cur === id) return true;
    cur = parts.find((o) => o.id === cur)?.parent ?? null;
  }
  return false;
}

/** Parents listed before their children, for building node trees. */
export function treeOrder(parts: Part[]): Part[] {
  const out: Part[] = [];
  const visit = (parent: string | null) => {
    for (const part of parts) if (part.parent === parent) out.push(part), visit(part.id);
  };
  visit(null);
  return out;
}

/**
 * Where a part's pivot would naturally go, judged from where it touches its parent:
 * - a long part (an arm, leg or tail) pivots at the end nearer the attachment, centred across
 *   its width, or across the shared edge when that edge is at the end (a leg under a torso);
 *   on a tie it picks the top, since limbs usually hang
 * - a squarish part (a head) pivots at the middle of the shared edges
 * - a part that touches nothing pivots at its centre
 */
export function autoPivot(p: Project, part: Part, parent: Part | null): [number, number] {
  const filled = (tiles: Tile[], x: number, y: number) => x >= 0 && y >= 0 && x < p.size.x && y < p.size.y && tiles[x * p.size.y + y].color >= 0;
  const snap = (v: number) => Math.round(v * 2) / 2;
  const shared: [number, number][] = []; // midpoints of edges shared with a parent tile
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let x = 0; x < p.size.x; x++) {
    for (let y = 0; y < p.size.y; y++) {
      if (!filled(part.tiles, x, y)) continue;
      minX = Math.min(minX, x), minY = Math.min(minY, y), maxX = Math.max(maxX, x + 1), maxY = Math.max(maxY, y + 1);
      if (!parent) continue;
      if (filled(parent.tiles, x, y - 1)) shared.push([x + 0.5, y]);
      if (filled(parent.tiles, x, y + 1)) shared.push([x + 0.5, y + 1]);
      if (filled(parent.tiles, x - 1, y)) shared.push([x, y + 0.5]);
      if (filled(parent.tiles, x + 1, y)) shared.push([x + 1, y + 0.5]);
    }
  }
  if (minX === Infinity) return [p.size.x / 2, p.size.y / 2];
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  if (!shared.length) return [snap(cx), snap(cy)];
  const mean = (i: 0 | 1) => shared.reduce((s, q) => s + q[i], 0) / shared.length;
  const w = maxX - minX;
  const h = maxY - minY;
  if (w === h) return [snap(mean(0)), snap(mean(1))];
  const vertical = h > w;
  const [lo, hi, along] = vertical ? [minY, maxY, mean(1)] : [minX, maxX, mean(0)];
  const end = Math.abs(along - lo) <= Math.abs(along - hi) ? lo : hi;
  const atEnd = shared.every((q) => q[vertical ? 1 : 0] === end);
  const across = atEnd ? mean(vertical ? 0 : 1) : vertical ? cx : cy;
  return vertical ? [snap(across), end] : [end, snap(across)];
}

// ---------- file format ----------

interface StoredPart extends Omit<Part, 'tiles'> {
  /** Sparse: [index, tile] for non-empty tiles. */
  tiles: [number, Tile][];
}
interface StoredRig {
  version: 1;
  active: number;
  parts: StoredPart[];
  clips?: Clip[];
}

/** Take the parts out of a loaded project. Without a rig, the whole drawing is one part. */
export function takeRig(p: Project): { parts: Part[]; active: number; clips: Clip[] } {
  const raw = p[RIG_KEY] as StoredRig | undefined;
  delete p[RIG_KEY];
  const count = p.size.x * p.size.y;
  if (!raw || !Array.isArray(raw.parts) || !raw.parts.length) return { parts: [basePart(p)], active: 0, clips: [] };
  const parts: Part[] = raw.parts.map((s, i) => {
    const tiles = emptyGrid(p);
    for (const [k, t] of Array.isArray(s.tiles) ? s.tiles : []) if (k >= 0 && k < count) tiles[k] = { ...emptyTile(), ...t };
    return {
      id: String(s.id ?? `p${i}`),
      name: String(s.name ?? `Part ${i + 1}`),
      tiles,
      pivot: Array.isArray(s.pivot) ? [+s.pivot[0] || 0, +s.pivot[1] || 0] : [p.size.x / 2, p.size.y / 2],
      z: +s.z || 0,
      parent: s.parent ?? null,
      visible: s.visible !== false,
    };
  });
  for (const part of parts) {
    if (part.parent && (!parts.some((o) => o.id === part.parent) || wouldCycle(parts, part.id, part.parent))) part.parent = null;
  }
  const active = Math.max(0, Math.min(parts.length - 1, raw.active | 0));
  return { parts, active, clips: parseClips(raw.clips, new Set(parts.map((o) => o.id))) };
}

/** The project as written to disk: flattened tiles, plus the parts and clips when there's anything to rig. */
export function withRig(p: Project, parts: Part[], active: number, clips: Clip[] = []): Project {
  const out: Project = { ...p, tiles: flattenTiles(p, parts) };
  if (parts.length < 2 && !clips.length) return out;
  const rig: StoredRig = {
    version: 1,
    active,
    parts: parts.map(({ tiles, ...rest }) => ({
      ...rest,
      tiles: tiles.flatMap((t, i) => (t.color >= 0 ? [[i, t] as [number, Tile]] : [])),
    })),
  };
  if (clips.length) rig.clips = clips;
  return { ...out, [RIG_KEY]: rig };
}
