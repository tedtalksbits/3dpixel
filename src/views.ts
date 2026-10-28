// Back and side views. A drawing is extruded with its back mirroring its front, which suits flat
// things like tools but not characters: a face shows through on the back of the head, and the depth
// only follows the outline. These use extra views of the subject to fix both:
//
// - The back: a back-view image (the subject turned away) gives each tile its back colour. Seen from
//   behind, left and right swap, so the image is mirrored onto the drawing. Without an image, the
//   back can be simplified instead: each tile takes the commonest colour around it, which keeps the
//   big areas (hair, a shirt) and drops small details like eyes and logos.
// - The depth: a side-view image gives how far the subject reaches forwards and backwards at each
//   height, so a cap gets a deep brim and a shallow crown. Each piece of a row (a leg, a fist) is
//   kept no deeper than it is wide, since the side view can't say which piece is deep, and rounds
//   off towards its edges like an ellipse, so the result reads as a solid rather than slabs.
//
// Images are lined up with the drawing by their silhouettes' bounding boxes, so they don't need to
// be the same size as the drawing, only the same subject.

import { Tile } from './kenshape';
import { medianCut, RGB } from './gif';
import type { Art } from './pngImport';

/** A flattened drawing: tiles are column-major, tiles[x * H + y]. */
export interface Grid {
  W: number;
  H: number;
  tiles: Tile[];
}

/** The editor's deepest tile. */
const DEPTH_LIMIT = 20;
/** The biggest depth multiplier (percent) side depth sets; deeper subjects are squashed instead. */
const MAX_MULTIPLIER = 150;
/** A piece of a row reaches at most this many times its half-width forwards and back. */
const RUN_DEPTH = 1;

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function gridBox(g: Grid): Box {
  const b = { x0: g.W, y0: g.H, x1: -1, y1: -1 };
  for (let x = 0; x < g.W; x++)
    for (let y = 0; y < g.H; y++)
      if (g.tiles[x * g.H + y].color >= 0) (b.x0 = Math.min(b.x0, x)), (b.y0 = Math.min(b.y0, y)), (b.x1 = Math.max(b.x1, x)), (b.y1 = Math.max(b.y1, y));
  if (b.x1 < 0) throw new Error('Draw or import something first.');
  return b;
}

const rgbOf = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgbKey = (k: number): RGB => [(k >> 16) & 255, (k >> 8) & 255, k & 255];
const hex = (c: RGB) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
const dist2 = (a: RGB, b: RGB) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
function nearest(palette: RGB[], c: RGB): [number, number] {
  let best = 0, bd = Infinity;
  palette.forEach((p, i) => {
    const d = dist2(p, c);
    if (d < bd) (bd = d), (best = i);
  });
  return [best, bd];
}

export interface BackResult {
  /** Tile index -> back colour. */
  colorBack: Map<number, number>;
  /** The palette, with any colours the back needed added at the end. */
  colors: string[];
  notes: string[];
}

/** Colours this close to a palette colour reuse it rather than taking a new slot. */
const SAME_COLOUR = 18 ** 2;

/** Back colours from a back-view image, mirrored onto the drawing. */
export function backFromArt(g: Grid, colors: string[], back: Art, maxColors: number): BackResult {
  const b = gridBox(g);
  const fw = b.x1 - b.x0 + 1, fh = b.y1 - b.y0 + 1;
  // the image's colour for every tile, nearest opaque pixel if the silhouettes differ there
  const opaque: number[] = [];
  for (let i = 0; i < back.k.length; i++) if (back.k[i] >= 0) opaque.push(i);
  if (!opaque.length) throw new Error('The back view is empty.');
  const keyAt = new Map<number, number>();
  for (let x = b.x0; x <= b.x1; x++)
    for (let y = b.y0; y <= b.y1; y++) {
      const i = x * g.H + y;
      if (g.tiles[i].color < 0) continue;
      const bx = Math.min(back.w - 1, Math.floor(((b.x1 - x + 0.5) / fw) * back.w)); // mirrored
      const by = Math.min(back.h - 1, Math.floor(((y - b.y0 + 0.5) / fh) * back.h));
      let k = back.k[by * back.w + bx];
      if (k < 0) {
        let bd = Infinity;
        for (const j of opaque) {
          const d = (j % back.w - bx) ** 2 + (Math.floor(j / back.w) - by) ** 2;
          if (d < bd) (bd = d), (k = back.k[j]);
        }
      }
      keyAt.set(i, k);
    }

  // reuse palette colours where they're close, add the rest (reduced if the palette is full)
  const palette = colors.map(rgbOf);
  const fresh = new Map<number, number>();
  for (const k of keyAt.values()) if (nearest(palette, rgbKey(k))[1] > SAME_COLOUR) fresh.set(k, (fresh.get(k) ?? 0) + 1);
  const notes: string[] = [];
  const room = Math.max(0, maxColors - palette.length);
  if (fresh.size && room) {
    const added = fresh.size <= room ? [...fresh.keys()].map(rgbKey) : medianCut(fresh, room);
    palette.push(...added);
    notes.push(`Added ${added.length} colour${added.length === 1 ? '' : 's'} for the back.`);
  } else if (fresh.size) notes.push('The palette is full, so the back uses the nearest existing colours.');

  const colorBack = new Map<number, number>();
  for (const [i, k] of keyAt) colorBack.set(i, nearest(palette, rgbKey(k))[0]);
  return { colorBack, colors: palette.map((c, i) => (i < colors.length ? colors[i] : hex(c))), notes };
}

/** A plain back: each tile takes the commonest front colour around it, so small details drop out. */
export function simpleBack(g: Grid): Map<number, number> {
  const b = gridBox(g);
  const r = Math.max(1, Math.round(Math.min(b.x1 - b.x0 + 1, b.y1 - b.y0 + 1) / 10));
  const out = new Map<number, number>();
  const count = new Map<number, number>();
  for (let x = b.x0; x <= b.x1; x++)
    for (let y = b.y0; y <= b.y1; y++) {
      const t = g.tiles[x * g.H + y];
      if (t.color < 0) continue;
      count.clear();
      let best = t.color, bestN = 0;
      for (let nx = Math.max(0, x - r); nx <= Math.min(g.W - 1, x + r); nx++)
        for (let ny = Math.max(0, y - r); ny <= Math.min(g.H - 1, y + r); ny++) {
          const c = g.tiles[nx * g.H + ny].color;
          if (c < 0) continue;
          const n = (count.get(c) ?? 0) + 1;
          count.set(c, n);
          if (n > bestN) (bestN = n), (best = c);
        }
      out.set(x * g.H + y, best);
    }
  return out;
}

export interface DepthResult {
  /** Tile index -> [depth, depthBack]. */
  depth: Map<number, [number, number]>;
  /** The depth multiplier (percent) the depths are measured in. */
  multiplier: number;
  notes: string[];
}

/**
 * Depths from a side-view image of the subject facing `faces`. Each row of the drawing reaches as
 * far forwards and backwards as the side view does at that height, rounding off across the row.
 */
export function depthFromSide(g: Grid, side: Art, faces: 'right' | 'left'): DepthResult {
  const b = gridBox(g);
  const fh = b.y1 - b.y0 + 1;
  const scale = fh / side.h; // tiles per side-view pixel

  // the side view's front-to-back reach in each of its rows, in tiles from the middle of its outline
  const spans: ([number, number] | null)[] = [];
  for (let r = 0; r < side.h; r++) {
    let s0 = -1, s1 = -1;
    for (let c = 0; c < side.w; c++) if (side.k[r * side.w + c] >= 0) (s0 < 0 && (s0 = c)), (s1 = c);
    if (s0 < 0) spans.push(null);
    else {
      const ahead = s1 + 1 - side.w / 2, behind = side.w / 2 - s0;
      spans.push(faces === 'right' ? [ahead * scale, behind * scale] : [behind * scale, ahead * scale]);
    }
  }
  if (!spans.some(Boolean)) throw new Error('The side view is empty.');
  const spanAt = (r: number) => {
    for (let d = 0; d < side.h; d++) {
      const s = spans[r - d] ?? spans[r + d];
      if (s) return s;
    }
    return spans.find(Boolean)!;
  };

  // reach per tile, in tiles: an ellipse across each run of tiles, around the row's own middle
  const reach = new Map<number, [number, number]>();
  let most = 0, deepest = 0;
  for (let y = b.y0; y <= b.y1; y++) {
    const [F, B] = spanAt(Math.min(side.h - 1, Math.floor(((y - b.y0 + 0.5) / fh) * side.h)));
    const mid = (F - B) / 2, half = (F + B) / 2;
    for (let x = b.x0; x <= b.x1; ) {
      if (g.tiles[x * g.H + y].color < 0) {
        x++;
        continue;
      }
      let e = x;
      while (e + 1 <= b.x1 && g.tiles[(e + 1) * g.H + y].color >= 0) e++;
      const c = (x + e + 1) / 2, hw = (e - x + 1) / 2;
      // the side view's reach is the whole row's: a leg sharing a row with a fist only gets as
      // deep as it is wide, and the row's lean forwards or back stays within the piece
      const h = Math.min(half, hw * RUN_DEPTH);
      const m = Math.max(-0.8 * h, Math.min(0.8 * h, mid));
      for (let t = x; t <= e; t++) {
        const u = (t + 0.5 - c) / hw;
        const r = Math.sqrt(Math.max(0, 1 - u * u));
        const f = Math.max(0.25, (m + h) * r), bk = Math.max(0.25, (h - m) * r);
        reach.set(t * g.H + y, [f, bk]);
        most = Math.max(most, f, bk);
        deepest = Math.max(deepest, f + bk);
      }
      x = e + 1;
    }
  }

  // a tile of depth d reaches d/2 × multiplier. Deep subjects get a bigger multiplier, up to a
  // point: past it each depth step is a tall wall, so the subject is squashed front to back instead
  const needed = Math.max(100, Math.ceil(((most * 2) / DEPTH_LIMIT) * 10) * 10);
  const multiplier = Math.min(MAX_MULTIPLIER, needed);
  const unit = multiplier / 100;
  const squash = multiplier / needed;
  const toDepth = (v: number) => Math.max(1, Math.min(DEPTH_LIMIT, Math.round((v * squash * 2) / unit)));
  const depth = new Map<number, [number, number]>();
  for (const [i, [f, bk]] of reach) depth.set(i, [toDepth(f), toDepth(bk)]);
  const notes = [`Carved the depth from the side view: ${+(deepest * squash).toFixed(1)} tiles front to back at the deepest.`];
  if (squash < 1) notes.push(`Squashed to ${Math.round(squash * 100)}% front to back to keep the depth steps small.`);
  if (multiplier > 100) notes.push(`Depth multiplier set to ${multiplier}%.`);
  return { depth, multiplier, notes };
}
