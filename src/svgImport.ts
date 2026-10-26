import { Project, newProject, getTile } from './kenshape';
import { SHAPES } from './shapes';
import { TILE } from './svgExport';

export type PaletteMode = 'svg' | 'project';

export interface ImportOptions {
  /** Grid size used when the SVG has to be fitted (ignored for exact imports). */
  gridX: number;
  gridY: number;
  /** 'svg' = palette is replaced by the SVG's own colours, 'project' = snap to the current palette. */
  paletteMode: PaletteMode;
  palette: string[];
  maxColors?: number;
}

export interface ImportResult {
  project: Project;
  exact: boolean;
  notes: string[];
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').replace(/(-?\d+)\.0+(?!\d)/g, '$1');

// path string -> shape/angle, first match wins (e.g. a square's 4 identical angles map to angle 0)
const PATH_LOOKUP = new Map<string, { shape: number; angle: number }>();
SHAPES.forEach((s, shape) =>
  s.path.forEach((p, angle) => {
    const k = norm(p);
    if (!PATH_LOOKUP.has(k)) PATH_LOOKUP.set(k, { shape, angle });
  }),
);

// ---------- colour helpers ----------

const colorCtx = document.createElement('canvas').getContext('2d')!;

export function toHex(css: string): string | null {
  const c = css.trim().toLowerCase();
  if (!c || c === 'none' || c === 'transparent' || c.startsWith('url(')) return null;
  colorCtx.fillStyle = '#000000';
  colorCtx.fillStyle = c;
  const v = colorCtx.fillStyle; // '#rrggbb' or 'rgba(...)'
  if (v.startsWith('#')) return v.toUpperCase();
  const m = v.match(/\d+(\.\d+)?/g);
  if (!m) return null;
  return '#' + m.slice(0, 3).map((n) => (+n).toString(16).padStart(2, '0')).join('').toUpperCase();
}

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const dist2 = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

function nearest(c: number[], palette: number[][]): number {
  let best = 0;
  let bd = Infinity;
  palette.forEach((p, i) => {
    const d = dist2(c, p);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

function fillOf(el: Element): string | null {
  const style = (el as SVGElement).style?.fill;
  return toHex(style || el.getAttribute('fill') || '');
}

// ---------- exact import (SVGs made by Kenney Shape or this editor) ----------

function tryExact(doc: Document, opts: ImportOptions): ImportResult | null {
  const svg = doc.documentElement;
  const vb = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || vb[0] !== 0 || vb[1] !== 0 || vb[2] % TILE || vb[3] % TILE) return null;
  const paths = [...svg.querySelectorAll('path')];
  if (!paths.length || svg.querySelectorAll('rect,circle,ellipse,polygon,polyline,line,use,image,text').length) return null;

  const placed: { x: number; y: number; shape: number; angle: number; color: string }[] = [];
  for (const el of paths) {
    const color = fillOf(el);
    const d = el.getAttribute('d') ?? '';
    if (!color || el.closest('[transform]')) return null;
    const parts = d.split(/(?=M)/).map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      const m = part.match(/^M\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*(m[\s\S]*)$/);
      if (!m) return null;
      const x = +m[1] / TILE;
      const y = +m[2] / TILE;
      const hit = PATH_LOOKUP.get(norm(m[3]));
      if (!hit || !Number.isInteger(x) || !Number.isInteger(y)) return null;
      placed.push({ x, y, ...hit, color });
    }
  }

  const p = newProject(vb[2] / TILE, vb[3] / TILE);
  const svgColors = [...new Set(placed.map((t) => t.color))];
  const colorIndex = mapColors(svgColors, p, opts);
  for (const t of placed) {
    if (t.x < 0 || t.y < 0 || t.x >= p.size.x || t.y >= p.size.y) continue;
    Object.assign(getTile(p, t.x, t.y), { shape: t.shape, angle: t.angle, color: colorIndex.get(t.color)! });
  }
  return { project: p, exact: true, notes: [`Exact import: ${placed.length} tiles, ${p.size.x}×${p.size.y} grid.`] };
}

/** Decide the palette and return SVG colour -> palette index. */
function mapColors(svgColors: string[], p: Project, opts: ImportOptions, weights?: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  if (opts.paletteMode === 'svg') {
    const max = opts.maxColors ?? 16;
    const ordered = [...svgColors].sort((a, b) => (weights?.get(b) ?? 0) - (weights?.get(a) ?? 0));
    const kept = ordered.slice(0, max);
    p.colors = [...kept];
    // pad with the current palette so the project keeps 16 slots, like Kenney Shape expects
    for (const c of opts.palette) if (p.colors.length < max && !p.colors.includes(c)) p.colors.push(c);
    const keptRgb = kept.map(rgb);
    for (const c of svgColors) out.set(c, kept.includes(c) ? kept.indexOf(c) : nearest(rgb(c), keptRgb));
  } else {
    p.colors = [...opts.palette];
    const pal = p.colors.map(rgb);
    for (const c of svgColors) out.set(c, nearest(rgb(c), pal));
  }
  return out;
}

// ---------- fitted import (any SVG) ----------

const SUB = 24; // sample resolution per tile

let maskCache: { shape: number; angle: number; mask: Uint8Array; area: number }[] | null = null;

function shapeMasks() {
  if (maskCache) return maskCache;
  const c = document.createElement('canvas');
  c.width = c.height = SUB;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const seen = new Set<string>();
  maskCache = [];
  SHAPES.forEach((s, shape) =>
    s.path.forEach((path, angle) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, SUB, SUB);
      ctx.setTransform(SUB / TILE, 0, 0, SUB / TILE, 0, 0);
      ctx.fill(new Path2D('M 0 0 ' + path));
      const px = ctx.getImageData(0, 0, SUB, SUB).data;
      const mask = new Uint8Array(SUB * SUB);
      let area = 0;
      for (let i = 0; i < mask.length; i++) if (px[i * 4 + 3] >= 128) (mask[i] = 1), area++;
      const key = mask.join('');
      if (seen.has(key) || !area) return;
      seen.add(key);
      maskCache!.push({ shape, angle, mask, area });
    }),
  );
  return maskCache;
}

async function rasterize(doc: Document, w: number, h: number): Promise<Uint8ClampedArray> {
  const svg = doc.documentElement.cloneNode(true) as SVGSVGElement;
  if (!svg.getAttribute('viewBox')) {
    const ow = parseFloat(svg.getAttribute('width') ?? '') || w;
    const oh = parseFloat(svg.getAttribute('height') ?? '') || h;
    svg.setAttribute('viewBox', `0 0 ${ow} ${oh}`);
  }
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h).data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function fitted(doc: Document, opts: ImportOptions): Promise<ImportResult> {
  const { gridX, gridY } = opts;
  const W = gridX * SUB;
  const H = gridY * SUB;
  const px = await rasterize(doc, W, H);
  const notes: string[] = [];

  // candidate colours: the SVG's declared fills, else the most common rendered colours
  let candidates = [...new Set([...doc.querySelectorAll('*')].map(fillOf).filter((c): c is string => !!c))];
  if (!candidates.length) {
    const counts = new Map<string, number>();
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 250) continue;
      const k = '#' + [px[i], px[i + 1], px[i + 2]].map((v) => (v & 0xf0).toString(16).padStart(2, '0')).join('').toUpperCase();
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    candidates = [...counts].sort((a, b) => b[1] - a[1]).slice(0, opts.maxColors ?? 16).map(([k]) => k);
    notes.push('No solid fills found; colours were sampled from the rendered image.');
  }
  if (!candidates.length) candidates = ['#000000'];
  const candRgb = candidates.map(rgb);

  // label each sample pixel with a candidate colour, or -1 if transparent
  const labels = new Int16Array(W * H);
  const weight = new Map<string, number>();
  for (let i = 0; i < labels.length; i++) {
    const o = i * 4;
    if (px[o + 3] < 128) {
      labels[i] = -1;
      continue;
    }
    const a = px[o + 3] / 255; // undo premultiplied blending against transparent
    const n = nearest([px[o] / a, px[o + 1] / a, px[o + 2] / a], candRgb);
    labels[i] = n;
    weight.set(candidates[n], (weight.get(candidates[n]) ?? 0) + 1);
  }

  const used = candidates.filter((c) => weight.has(c));
  const p = newProject(gridX, gridY);
  const colorIndex = mapColors(used, p, opts, weight);
  if (opts.paletteMode === 'svg' && used.length > (opts.maxColors ?? 16)) notes.push(`SVG has ${used.length} colours; merged down to ${opts.maxColors ?? 16}.`);

  // Each tile holds one shape in one colour, so pick the candidate with the lowest pixel error.
  // Getting the silhouette wrong (opaque vs empty) costs more than getting a colour wrong.
  const COLOR_COST = 0.6;
  const masks = shapeMasks();
  const local = new Int16Array(SUB * SUB);
  for (let tx = 0; tx < gridX; tx++) {
    for (let ty = 0; ty < gridY; ty++) {
      const present = new Set<number>();
      let opaque = 0;
      for (let sy = 0; sy < SUB; sy++)
        for (let sx = 0; sx < SUB; sx++) {
          const l = labels[(ty * SUB + sy) * W + tx * SUB + sx];
          local[sy * SUB + sx] = l;
          if (l >= 0) present.add(l), opaque++;
        }
      let best = { err: opaque, shape: -1, angle: 0, color: -1 }; // empty tile
      for (const c of present) {
        for (const m of masks) {
          let err = 0;
          for (let i = 0; i < local.length; i++) {
            const l = local[i];
            if (m.mask[i]) err += l < 0 ? 1 : l !== c ? COLOR_COST : 0;
            else if (l >= 0) err += 1;
          }
          if (err < best.err - 1e-6) best = { err, shape: m.shape, angle: m.angle, color: c };
        }
      }
      if (best.shape < 0) continue;
      Object.assign(getTile(p, tx, ty), { shape: best.shape, angle: best.angle, color: colorIndex.get(candidates[best.color])! });
    }
  }
  notes.unshift(`Fitted import onto a ${gridX}×${gridY} grid.`);
  return { project: p, exact: false, notes };
}

export async function importSvg(text: string, opts: ImportOptions): Promise<ImportResult> {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (doc.querySelector('parsererror') || doc.documentElement.nodeName.toLowerCase() !== 'svg') throw new Error('Not a valid SVG file.');
  return tryExact(doc, opts) ?? fitted(doc, opts);
}
