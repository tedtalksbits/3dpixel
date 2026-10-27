// Easing (timing) functions: the Robert Penner set as on easings.net, plus step.
// Each maps progress t in [0, 1] to eased progress; Back and Elastic deliberately overshoot.

export type EaseFamily = 'sine' | 'quad' | 'cubic' | 'quart' | 'quint' | 'expo' | 'circ' | 'back' | 'elastic' | 'bounce';
export type EaseDir = 'in' | 'out' | 'inOut';
/** `bezier:x1,y1,x2,y2` is a custom cubic Bézier, like CSS cubic-bezier(); x1 and x2 stay in [0, 1]. */
export type Ease = 'linear' | 'step' | `${EaseFamily}.${EaseDir}` | `bezier:${string}`;

const c1 = 1.70158;
const c2 = c1 * 1.525;
const c3 = c1 + 1;
const c4 = (2 * Math.PI) / 3;
const c5 = (2 * Math.PI) / 4.5;

function bounceOut(t: number) {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
}

/** The "in" curve of each family; out and in-out are derived from it, except where the closed form is standard. */
const IN: Record<EaseFamily, (t: number) => number> = {
  sine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  quad: (t) => t * t,
  cubic: (t) => t * t * t,
  quart: (t) => t ** 4,
  quint: (t) => t ** 5,
  expo: (t) => (t === 0 ? 0 : 2 ** (10 * t - 10)),
  circ: (t) => 1 - Math.sqrt(1 - t * t),
  back: (t) => c3 * t ** 3 - c1 * t * t,
  elastic: (t) => (t === 0 ? 0 : t === 1 ? 1 : -(2 ** (10 * t - 10)) * Math.sin((t * 10 - 10.75) * c4)),
  bounce: (t) => 1 - bounceOut(1 - t),
};

const IN_OUT: Partial<Record<EaseFamily, (t: number) => number>> = {
  back: (t) => (t < 0.5 ? ((2 * t) ** 2 * ((c2 + 1) * 2 * t - c2)) / 2 : ((2 * t - 2) ** 2 * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2),
  elastic: (t) =>
    t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? -(2 ** (20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2 : (2 ** (-20 * t + 10) * Math.sin((20 * t - 11.125) * c5)) / 2 + 1,
};

const bezierCache = new Map<string, (t: number) => number>();

export function parseBezier(name: string): [number, number, number, number] | null {
  const m = /^bezier:(-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)$/.exec(name);
  if (!m) return null;
  const v = m.slice(1).map(Number) as [number, number, number, number];
  return v.every(Number.isFinite) && v[0] >= 0 && v[0] <= 1 && v[2] >= 0 && v[2] <= 1 ? v : null;
}

export const bezierEase = (x1: number, y1: number, x2: number, y2: number): Ease =>
  `bezier:${[x1, y1, x2, y2].map((n) => +n.toFixed(3)).join(',')}`;

/** Progress -> eased progress for a cubic Bézier from (0,0) to (1,1), solving x for t like browsers do. */
function bezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (u: number) => ((ax * u + bx) * u + cx) * u;
  const dX = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
  const Y = (u: number) => ((ay * u + by) * u + cy) * u;
  return (x: number) => {
    let u = x;
    for (let i = 0; i < 8; i++) {
      const err = X(u) - x;
      const d = dX(u);
      if (Math.abs(err) < 1e-7) return Y(u);
      if (Math.abs(d) < 1e-6) break;
      u -= err / d;
    }
    // Newton stalled on a flat spot: bisect instead
    let lo = 0, hi = 1;
    u = x;
    for (let i = 0; i < 40; i++) {
      if (X(u) < x) lo = u;
      else hi = u;
      u = (lo + hi) / 2;
    }
    return Y(u);
  };
}

export function ease(name: Ease, t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  if (name === 'linear') return t;
  if (name === 'step') return 0;
  if (name.startsWith('bezier:')) {
    let f = bezierCache.get(name);
    if (!f) {
      const b = parseBezier(name);
      f = b ? bezier(...b) : (x: number) => x;
      bezierCache.set(name, f);
    }
    return f(t);
  }
  const [family, dir] = name.split('.') as [EaseFamily, EaseDir];
  const f = IN[family];
  if (!f) return t;
  if (dir === 'in') return f(t);
  if (dir === 'out') return 1 - f(1 - t);
  const io = IN_OUT[family];
  if (io) return io(t);
  return t < 0.5 ? f(2 * t) / 2 : 1 - f(2 - 2 * t) / 2;
}

export const EASE_FAMILIES: [EaseFamily, string][] = [
  ['sine', 'Sine'],
  ['quad', 'Quad'],
  ['cubic', 'Cubic'],
  ['quart', 'Quart'],
  ['quint', 'Quint'],
  ['expo', 'Expo'],
  ['circ', 'Circ'],
  ['back', 'Back (overshoot)'],
  ['elastic', 'Elastic'],
  ['bounce', 'Bounce'],
];

/** Every ease with a readable label, for <select>s. */
export const EASE_OPTIONS: [Ease, string][] = [
  ['linear', 'Linear'],
  ['step', 'Step (hold)'],
  ...EASE_FAMILIES.flatMap(([f, label]) =>
    (['in', 'out', 'inOut'] as EaseDir[]).map((d) => [`${f}.${d}` as Ease, `${label} ${d === 'inOut' ? 'in-out' : d}`] as [Ease, string]),
  ),
];

export const isEase = (v: unknown): v is Ease => typeof v === 'string' && (EASE_OPTIONS.some(([e]) => e === v) || !!parseBezier(v));

export const easeLabel = (e: Ease) => EASE_OPTIONS.find(([o]) => o === e)?.[1] ?? (parseBezier(e) ? 'Custom curve' : e);
