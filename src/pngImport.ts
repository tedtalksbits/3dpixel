// Pixel art (PNG, or any image the browser can decode) to tiles: one pixel becomes one square tile.
//
// Sprites are often shared scaled up (each art pixel drawn as a 4×4 block, say), so the real pixel
// size is detected from the lengths of same-colour runs and the image is sampled back down. Fully
// transparent margins are trimmed. Colours are kept exactly when they fit the palette, else reduced
// by median cut. Depth is either flat, or rounded: thicker towards the middle of the silhouette, so
// the extruded model reads as a solid figure rather than a cut-out.

import { Project, newProject, getTile } from './kenshape';
import { medianCut, RGB } from './gif';

export type PngPalette = 'image' | 'project';
export type PngDepth = 'flat' | 'rounded';

export interface PngImportOptions {
  /** 'pixel' = one art pixel per tile; a number scales bigger art down so neither side exceeds it. */
  size: 'pixel' | number;
  trim: boolean;
  paletteMode: PngPalette;
  /** The current palette, for 'project' mode. */
  palette: string[];
  maxColors: number;
  depth: PngDepth;
  /**
   * Flat: every tile's depth. Rounded: the depth in the thickest part. 'auto' makes rounded shapes
   * about as thick as the body is wide (up to the depth limit), and flat ones 2 deep.
   */
  thickness: number | 'auto';
}

export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array; // RGBA
}

export interface PngImportResult {
  project: Project;
  notes: string[];
}

/** Largest grid side; bigger images are scaled down to fit. */
export const PNG_MAX = 128;
/** The editor's deepest tile. */
const DEPTH_LIMIT = 20;

const hex = (c: RGB) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
const rgbOf = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** Pixel key: RGB as a number, or -1 for transparent (under half opacity). */
function keys(px: Pixels): Int32Array {
  const out = new Int32Array(px.width * px.height);
  const d = px.data;
  for (let i = 0; i < out.length; i++) {
    const o = i * 4;
    out[i] = d[o + 3] < 128 ? -1 : (d[o] << 16) | (d[o + 1] << 8) | d[o + 2];
  }
  return out;
}

/**
 * The size of one art pixel in image pixels, and where the pixel grid starts: the GCD of all
 * same-colour runs that don't touch the image edge (those may be cut off).
 */
export function detectScale(k: Int32Array, w: number, h: number): { scale: number; ox: number; oy: number } {
  let g = 0;
  let ox = -1;
  let oy = -1;
  const scan = (n: number, len: number, at: (line: number, i: number) => number, first: (pos: number) => void) => {
    for (let line = 0; line < n; line++) {
      let start = 0;
      for (let i = 1; i <= len; i++) {
        if (i < len && at(line, i) === at(line, start)) continue;
        if (start > 0 && i < len) g = gcd(g, i - start);
        if (i < len) first(i);
        start = i;
      }
    }
  };
  scan(h, w, (y, x) => k[y * w + x], (x) => ox < 0 && (ox = x));
  scan(w, h, (x, y) => k[y * w + x], (y) => oy < 0 && (oy = y));
  const scale = Math.max(1, g);
  return { scale, ox: ox < 0 ? 0 : ox % scale, oy: oy < 0 ? 0 : oy % scale };
}

/** Resample to w×h tiles: each tile takes the most common key in its block (transparent wins ties). */
function resample(k: Int32Array, sw: number, sh: number, x0: number, y0: number, bw: number, bh: number, w: number, h: number): Int32Array {
  const out = new Int32Array(w * h);
  const count = new Map<number, number>();
  for (let ty = 0; ty < h; ty++)
    for (let tx = 0; tx < w; tx++) {
      count.clear();
      const xa = Math.floor(x0 + tx * bw), xb = Math.max(xa + 1, Math.floor(x0 + (tx + 1) * bw));
      const ya = Math.floor(y0 + ty * bh), yb = Math.max(ya + 1, Math.floor(y0 + (ty + 1) * bh));
      let best = -1, bestN = 0;
      for (let y = ya; y < Math.min(yb, sh); y++)
        for (let x = xa; x < Math.min(xb, sw); x++) {
          const v = k[y * sw + x];
          const n = (count.get(v) ?? 0) + 1;
          count.set(v, n);
          if (n > bestN || (n === bestN && v === -1)) (best = v), (bestN = n);
        }
      out[ty * w + tx] = best;
    }
  return out;
}

/** Distance from each opaque cell to the nearest transparent one or the edge (1 = on the outline). */
export function insideDistance(k: Int32Array, w: number, h: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = k[i] < 0 ? 0 : INF;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
  const D = Math.SQRT2;
  // two-pass chamfer distance, close enough to Euclidean for shaping depth
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + D, at(x + 1, y - 1) + D);
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + D, at(x - 1, y + 1) + D);
    }
  return d;
}

export function pixelsToProject(px: Pixels, opts: PngImportOptions): PngImportResult {
  const notes: string[] = [];
  const full = keys(px);
  const { scale, ox, oy } = detectScale(full, px.width, px.height);

  // the art at one pixel per art pixel
  let w = Math.floor((px.width - ox) / scale);
  let h = Math.floor((px.height - oy) / scale);
  let k = scale > 1 ? resample(full, px.width, px.height, ox, oy, scale, scale, w, h) : full;
  if (scale > 1) notes.push(`Detected ${scale}× scaled pixel art.`);

  if (opts.trim) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (k[y * w + x] >= 0) (x0 = Math.min(x0, x)), (y0 = Math.min(y0, y)), (x1 = Math.max(x1, x)), (y1 = Math.max(y1, y));
    if (x1 < 0) throw new Error('The image is fully transparent.');
    if (x0 > 0 || y0 > 0 || x1 < w - 1 || y1 < h - 1) {
      const tw = x1 - x0 + 1, th = y1 - y0 + 1;
      k = resample(k, w, h, x0, y0, 1, 1, tw, th);
      w = tw;
      h = th;
    }
  }

  const limit = opts.size === 'pixel' ? PNG_MAX : Math.max(1, Math.min(PNG_MAX, Math.round(opts.size)));
  if (w > limit || h > limit) {
    const f = limit / Math.max(w, h);
    const nw = Math.max(1, Math.round(w * f)), nh = Math.max(1, Math.round(h * f));
    notes.push(`Scaled ${w}×${h} down to fit ${limit}×${limit}.`);
    k = resample(k, w, h, 0, 0, w / nw, h / nh, nw, nh);
    w = nw;
    h = nh;
  }

  // palette
  const hist = new Map<number, number>();
  for (const v of k) if (v >= 0) hist.set(v, (hist.get(v) ?? 0) + 1);
  if (!hist.size) throw new Error('The image is fully transparent.');
  let palette: RGB[];
  if (opts.paletteMode === 'project') palette = opts.palette.map(rgbOf);
  else if (hist.size <= opts.maxColors)
    palette = [...hist].sort((a, b) => b[1] - a[1]).map(([c]) => [(c >> 16) & 255, (c >> 8) & 255, c & 255]);
  else {
    palette = [...new Map(medianCut(hist, opts.maxColors).map((c) => [hex(c), c])).values()];
    notes.push(`Reduced ${hist.size} colours to ${palette.length}.`);
  }
  const index = new Map<number, number>();
  for (const c of hist.keys()) {
    const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
    let best = 0, bd = Infinity;
    palette.forEach((p, i) => {
      const dd = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
      if (dd < bd) (bd = dd), (best = i);
    });
    index.set(c, best);
  }

  // depth
  const dist = opts.depth === 'rounded' ? insideDistance(k, w, h) : null;
  let max = 1;
  if (dist) for (const v of dist) max = Math.max(max, v);
  const auto = dist ? max * 1.2 : 2; // a little flatter than a true circle reads better for sprites
  const thick = Math.max(1, Math.min(DEPTH_LIMIT, Math.round(opts.thickness === 'auto' ? auto : opts.thickness)));
  let depthAt = (_i: number) => thick;
  if (dist && thick > 1) {
    // a circular profile: steep at the outline, flattening towards the middle
    depthAt = (i) => {
      const t = Math.min(1, (dist[i] - 0.5) / Math.max(1, max - 0.5));
      return Math.max(1, Math.round(1 + (thick - 1) * Math.sqrt(1 - (1 - t) ** 2)));
    };
  }

  const p = newProject(w, h);
  p.colors = palette.map(hex);
  let tiles = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (k[i] < 0) continue;
      Object.assign(getTile(p, x, y), { shape: 0, angle: 0, color: index.get(k[i])!, depth: depthAt(i) });
      tiles++;
    }
  notes.unshift(`Imported ${w}×${h} pixels as ${tiles} tiles in ${p.colors.length} colours, up to ${thick} deep.`);
  return { project: p, notes };
}

/** Decode an image file (PNG, GIF's first frame, WebP, …) and convert it. */
export async function importPng(blob: Blob, opts: PngImportOptions): Promise<PngImportResult> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  } catch {
    throw new Error('Not an image this app can read.');
  }
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  return pixelsToProject({ data, width, height }, opts);
}
