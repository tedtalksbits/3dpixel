import { shapeOutline } from './mesh';
import { SHAPES } from './shapes';

// Flipping or rotating a tile has to swap in the shape/angle whose geometry matches the
// transformed outline. The table is worked out from the outlines themselves.

export type ShapeXf = 'flipX' | 'flipY' | 'rotCW' | 'rotCCW';

const N = 16;

function inside(pts: [number, number][], x: number, y: number) {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

const masks: { shape: number; angle: number; mask: Uint8Array }[] = [];
for (let shape = 0; shape < SHAPES.length; shape++) {
  for (let angle = 0; angle < 4; angle++) {
    const pts = shapeOutline(shape, angle, 8);
    const mask = new Uint8Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) mask[j * N + i] = inside(pts, (i + 0.5) / N, (j + 0.5) / N) ? 1 : 0;
    masks.push({ shape, angle, mask });
  }
}

function transformMask(m: Uint8Array, xf: ShapeXf) {
  const out = new Uint8Array(N * N);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      let ti = i;
      let tj = j;
      if (xf === 'flipX') ti = N - 1 - i;
      else if (xf === 'flipY') tj = N - 1 - j;
      else if (xf === 'rotCW') (ti = N - 1 - j), (tj = i);
      else (ti = j), (tj = N - 1 - i);
      out[tj * N + ti] = m[j * N + i];
    }
  return out;
}

const table = new Map<string, { shape: number; angle: number }>();

export function transformShape(shape: number, angle: number, xf: ShapeXf): { shape: number; angle: number } {
  const key = `${shape}:${angle}:${xf}`;
  let hit = table.get(key);
  if (hit) return hit;
  const src = masks.find((m) => m.shape === shape && m.angle === angle) ?? masks[0];
  const want = transformMask(src.mask, xf);
  let best = { shape, angle, d: Infinity };
  for (const m of masks) {
    let d = 0;
    for (let i = 0; i < want.length; i++) d += want[i] !== m.mask[i] ? 1 : 0;
    // prefer the same shape when several match, so a square stays a square
    if (d < best.d || (d === best.d && m.shape === shape && best.shape !== shape)) best = { shape: m.shape, angle: m.angle, d };
  }
  hit = { shape: best.shape, angle: best.angle };
  table.set(key, hit);
  return hit;
}
