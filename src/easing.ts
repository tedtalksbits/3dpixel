// Easing (timing) functions: the Robert Penner set as on easings.net, plus step.
// Each maps progress t in [0, 1] to eased progress; Back and Elastic deliberately overshoot.

export type EaseFamily = 'sine' | 'quad' | 'cubic' | 'quart' | 'quint' | 'expo' | 'circ' | 'back' | 'elastic' | 'bounce';
export type EaseDir = 'in' | 'out' | 'inOut';
export type Ease = 'linear' | 'step' | `${EaseFamily}.${EaseDir}`;

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

export function ease(name: Ease, t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  if (name === 'linear') return t;
  if (name === 'step') return 0;
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

export const isEase = (v: unknown): v is Ease => EASE_OPTIONS.some(([e]) => e === v);
