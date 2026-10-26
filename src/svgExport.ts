import { Project, getTile } from './kenshape';
import { SHAPES } from './shapes';

export const TILE = 32;

export type SvgGrouping = 'shape' | 'color';

export interface SvgOptions {
  width?: number;
  height?: number;
  /** 'shape' = one <path> per tile (same as Kenney Shape), 'color' = one merged <path> per colour (no seams). */
  grouping?: SvgGrouping;
  /** Turns off anti-aliasing when the SVG is rasterised. */
  crisp?: boolean;
  background?: string;
}

export function tilePath(x: number, y: number, shape: number, angle: number): string {
  return `M ${x * TILE} ${y * TILE} ${SHAPES[shape]?.path[angle] ?? SHAPES[0].path[0]}`;
}

export function exportSvg(p: Project, opts: SvgOptions = {}): string {
  const vw = p.size.x * TILE;
  const vh = p.size.y * TILE;
  const w = opts.width ?? vw / 2;
  const h = opts.height ?? vh / 2;
  const grouping = opts.grouping ?? 'shape';
  const rendering = opts.crisp ? " shape-rendering='crispEdges'" : '';
  let body = '';
  if (opts.background) body += `<rect width='${vw}' height='${vh}' fill='${opts.background}'/>\n`;

  if (grouping === 'shape') {
    for (let x = 0; x < p.size.x; x++) {
      for (let y = 0; y < p.size.y; y++) {
        const t = getTile(p, x, y);
        if (t.color < 0) continue;
        body += `<path stroke='none' fill='${p.colors[t.color]}' d='${tilePath(x, y, t.shape, t.angle)}'/>\n`;
      }
    }
  } else {
    const byColor = new Map<number, string[]>();
    for (let x = 0; x < p.size.x; x++) {
      for (let y = 0; y < p.size.y; y++) {
        const t = getTile(p, x, y);
        if (t.color < 0) continue;
        if (!byColor.has(t.color)) byColor.set(t.color, []);
        byColor.get(t.color)!.push(tilePath(x, y, t.shape, t.angle));
      }
    }
    for (const [c, parts] of byColor) {
      body += `<path stroke='none' fill='${p.colors[c]}' d='${parts.join(' ')}'/>\n`;
    }
  }

  return (
    `<svg width='${w}' height='${h}' viewBox='0 0 ${vw} ${vh}' xmlns='http://www.w3.org/2000/svg'${rendering}>\n` +
    `<g>\n${body}</g>\n</svg>`
  );
}

/** Rasterise the project to a PNG at an exact pixel size. */
export async function exportPng(p: Project, width: number, height = width, opts: SvgOptions = {}): Promise<Blob> {
  const svg = exportSvg(p, { grouping: 'color', ...opts, width, height });
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
    return await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('PNG encode failed'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}
