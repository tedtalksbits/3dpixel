import { ShapeUtils, Vector2 } from 'three';
import { Project, getTile } from './kenshape';
import { SHAPES } from './shapes';
import { TILE } from './svgExport';

// Builds an extruded model the same way Kenney Shape does: one tile = 1 unit, the grid is
// centred on the origin, +Y is up and +Z faces the viewer. A tile reaches depth/2 towards
// the front and depthBack/2 towards the back (depthBack 0 = same as depth), scaled by
// depthMultiplier. The back face uses colorBack when it is set.

export interface MeshPart {
  color: number; // palette index
  positions: number[];
  normals: number[];
  indices: number[];
}

export interface ModelOptions {
  /** Segments per quadratic curve. */
  curveSegments?: number;
  /** Drop side walls hidden between neighbouring tiles. */
  cullHidden?: boolean;
}

type Pt = [number, number];

/** Flatten a relative shape path (m / l / q) into a closed outline in tile units, y down. */
function outline(path: string, segments: number): Pt[] {
  const tok = path.trim().split(/[\s,]+/);
  const pts: Pt[] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < tok.length; ) {
    const cmd = tok[i++];
    const n = () => parseFloat(tok[i++]);
    if (cmd === 'm' || cmd === 'l') {
      x += n();
      y += n();
      pts.push([x, y]);
    } else if (cmd === 'q') {
      const cx = x + n();
      const cy = y + n();
      const ex = x + n();
      const ey = y + n();
      for (let s = 1; s <= segments; s++) {
        const t = s / segments;
        const a = (1 - t) * (1 - t);
        const b = 2 * (1 - t) * t;
        const c = t * t;
        pts.push([a * x + b * cx + c * ex, a * y + b * cy + c * ey]);
      }
      x = ex;
      y = ey;
    } else {
      throw new Error(`Unsupported path command '${cmd}'`);
    }
  }
  // drop repeated points, including the closing point
  const out: Pt[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6) out.push(p);
  }
  if (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-6) out.pop();
  return out.map(([px, py]) => [px / TILE, py / TILE]);
}

const outlineCache = new Map<string, Pt[]>();
export function shapeOutline(shape: number, angle: number, segments: number): Pt[] {
  const key = `${shape}:${angle}:${segments}`;
  let o = outlineCache.get(key);
  if (!o) {
    o = outline((SHAPES[shape] ?? SHAPES[0]).path[angle] ?? SHAPES[0].path[0], segments);
    outlineCache.set(key, o);
  }
  return o;
}

export function tileDepths(depth: number, depthBack: number): [number, number] {
  let f = depth;
  let b = depthBack;
  if (f === 0) f = b;
  if (b === 0) b = f;
  if (f === 0 && b === 0) f = b = 1;
  return [f, b];
}

interface Side {
  a: Pt;
  b: Pt;
  zf: number;
  zb: number;
  color: number;
  hidden: boolean;
}

export function buildModel(p: Project, opts: ModelOptions = {}): MeshPart[] {
  const segments = opts.curveSegments ?? 8;
  const cull = opts.cullHidden ?? true;
  const mult = (p.depthMultiplier ?? 100) / 100;
  const parts = new Map<number, MeshPart>();
  const part = (c: number) => {
    let m = parts.get(c);
    if (!m) parts.set(c, (m = { color: c, positions: [], normals: [], indices: [] }));
    return m;
  };
  const sides: Side[] = [];
  const halfX = p.size.x / 2;
  const halfY = p.size.y / 2;

  for (let tx = 0; tx < p.size.x; tx++) {
    for (let ty = 0; ty < p.size.y; ty++) {
      const t = getTile(p, tx, ty);
      if (t.color < 0) continue;
      const [df, db] = tileDepths(t.depth, t.depthBack);
      const zf = (df / 2) * mult;
      const zb = (-db / 2) * mult;

      let pts: Pt[] = shapeOutline(t.shape, t.angle, segments).map(([u, v]) => [tx + u - halfX, halfY - ty - v]);
      if (ShapeUtils.area(pts.map(([x, y]) => new Vector2(x, y))) < 0) pts = pts.reverse(); // make counter-clockwise
      const tris = ShapeUtils.triangulateShape(
        pts.map(([x, y]) => new Vector2(x, y)),
        [],
      ).map(([a, b, c]) => {
        const cross = (pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) - (pts[b][1] - pts[a][1]) * (pts[c][0] - pts[a][0]);
        return cross >= 0 ? [a, b, c] : [a, c, b]; // counter-clockwise = facing +Z
      });

      // front cap
      const front = part(t.color);
      let base = front.positions.length / 3;
      for (const [x, y] of pts) front.positions.push(x, y, zf), front.normals.push(0, 0, 1);
      for (const [a, b, c] of tris) front.indices.push(base + a, base + b, base + c);

      // back cap
      const back = part(t.colorBack >= 0 ? t.colorBack : t.color);
      base = back.positions.length / 3;
      for (const [x, y] of pts) back.positions.push(x, y, zb), back.normals.push(0, 0, -1);
      for (const [a, b, c] of tris) back.indices.push(base + a, base + c, base + b);

      for (let i = 0; i < pts.length; i++) {
        sides.push({ a: pts[i], b: pts[(i + 1) % pts.length], zf, zb, color: t.color, hidden: false });
      }
    }
  }

  if (cull) {
    // two tiles with the same depth range that share an edge hide each other's walls
    const key = (a: Pt, b: Pt, zf: number, zb: number) =>
      `${a[0].toFixed(4)},${a[1].toFixed(4)}|${b[0].toFixed(4)},${b[1].toFixed(4)}|${zf.toFixed(4)},${zb.toFixed(4)}`;
    const byKey = new Map<string, Side[]>();
    for (const s of sides) {
      const k = key(s.a, s.b, s.zf, s.zb);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k)!.push(s);
    }
    for (const s of sides) {
      if (s.hidden) continue;
      const twin = byKey.get(key(s.b, s.a, s.zf, s.zb))?.find((o) => !o.hidden);
      if (twin) s.hidden = twin.hidden = true;
    }
  }

  for (const s of sides) {
    if (s.hidden) continue;
    const [ax, ay] = s.a;
    const [bx, by] = s.b;
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-9) continue;
    const nx = (by - ay) / len; // outward normal of a counter-clockwise outline
    const ny = -(bx - ax) / len;
    const m = part(s.color);
    const base = m.positions.length / 3;
    m.positions.push(ax, ay, s.zf, bx, by, s.zf, bx, by, s.zb, ax, ay, s.zb);
    for (let i = 0; i < 4; i++) m.normals.push(nx, ny, 0);
    m.indices.push(base, base + 3, base + 2, base, base + 2, base + 1);
  }

  return [...parts.values()].sort((a, b) => a.color - b.color);
}
