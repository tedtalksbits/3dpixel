// Creature presets: walk cycles and gaits for the rig templates in templates.ts. They drive parts by
// role, so any model rigged with the template works; roles a model doesn't have are skipped.
//
// Legs use a stance/swing cycle rather than a plain sine: each foot plants forward, sweeps back
// at a steady speed while it's on the ground (so it doesn't skate), then swings forward with an
// ease. Timing comes from the gait tables in docs/animation-design.md. All values are starting
// points, exposed as sliders.

import type { Key, Prop, Vec3 } from './anim';
import type { Ease } from './easing';
import type { Gen, Params, PresetDef } from './presets';
import type { RigCtx } from './templates';

type Point = [phase: number, value: number, ease: Ease];

const num = (v: number | string) => +v || 0;
const wrap = (x: number) => ((x % 1) + 1) % 1;

/** Keys for a pattern that repeats `cycles` times across the clip; points are [phase in cycle, value, ease]. */
function cycle(d: number, cycles: number, points: Point[]): { t: number; v: number; ease: Ease }[] {
  const out: { t: number; v: number; ease: Ease }[] = [];
  for (let c = 0; c < cycles; c++) for (const [ph, v, ease] of points) out.push({ t: +(((c + wrap(ph)) / cycles) * d).toFixed(5), v, ease });
  out.sort((a, b) => a.t - b.t);
  return out.filter((k, i) => !i || k.t - out[i - 1].t > 1e-6);
}

const vec = (prop: Prop, axis: number, v: number): Vec3 => {
  const out: Vec3 = prop === 'scale' ? [1, 1, 1] : [0, 0, 0];
  out[axis] = v;
  return out;
};

/** A track on one axis of one role's part, or nothing when the model has no such part. */
function track(ctx: RigCtx, role: string, prop: Prop, axis: number, d: number, cycles: number, points: Point[]): Gen[] {
  const part = ctx.part(role);
  if (!part) return [];
  const keys: Key[] = cycle(d, cycles, points).map((k) => ({ t: k.t, v: vec(prop, axis, k.v), ease: k.ease }));
  return [{ part, prop, keys }];
}

/** Plant forward at `phase`, sweep back steadily for `duty` of the cycle, then swing forward. */
const leg = (phase: number, duty: number, amp: number): Point[] => [
  [phase, amp, 'linear'],
  [phase + duty, -amp, 'sine.inOut'],
];

/** A cosine: `center + amp` at `phase`, `center - amp` half a cycle later. */
const wave = (phase: number, amp: number, center = 0): Point[] => [
  [phase, center + amp, 'sine.inOut'],
  [phase + 0.5, center - amp, 'sine.inOut'],
];

const Y = 1;

// ---------- bipeds ----------

function bipedGait(p: Params, d: number, ctx: RigCtx, duty: number): Gen[] {
  const s = ctx.facing; // swinging towards the way it faces is a positive angle when facing right
  const stride = num(p.stride);
  const arms = num(p.arms);
  const bounce = num(p.bounce);
  const out: Gen[] = [
    ...track(ctx, 'leg.near', 'rotation', ctx.axis, d, 1, leg(0, duty, s * stride)),
    ...track(ctx, 'leg.far', 'rotation', ctx.axis, d, 1, leg(0.5, duty, s * stride)),
    // arms swing against the legs on the same side
    ...track(ctx, 'arm.near', 'rotation', ctx.axis, d, 1, wave(0.5, s * arms)),
    ...track(ctx, 'arm.far', 'rotation', ctx.axis, d, 1, wave(0, s * arms)),
    // the body is lowest just after each contact and highest as the legs pass
    ...track(ctx, 'body', 'position', Y, d, 2, wave(0.5, bounce / 2, bounce / 2)),
    // the head lags the body a little, which keeps it from looking stiff
    ...track(ctx, 'head', 'rotation', ctx.axis, d, 2, wave(0.1, -s * num(p.head))),
    ...track(ctx, 'tail', 'rotation', ctx.axis, d, 1, wave(0.25, 8)),
  ];
  if (num(p.lean)) out.push(...track(ctx, 'body', 'rotation', ctx.axis, d, 1, [[0, -s * num(p.lean), 'linear']]));
  return out;
}

const bipedParams = (stride: number, arms: number, bounce: number, lean: number, head: number) => [
  { key: 'stride', label: 'Leg swing', kind: 'range' as const, default: stride, min: 5, max: 70, step: 1, unit: '°' },
  { key: 'arms', label: 'Arm swing', kind: 'range' as const, default: arms, min: 0, max: 80, step: 1, unit: '°' },
  { key: 'bounce', label: 'Bounce', kind: 'range' as const, default: bounce, min: 0, max: 2, step: 0.05, unit: ' tiles' },
  { key: 'lean', label: 'Lean forward', kind: 'range' as const, default: lean, min: 0, max: 30, step: 1, unit: '°' },
  { key: 'head', label: 'Head bob', kind: 'range' as const, default: head, min: 0, max: 15, step: 0.5, unit: '°' },
];

const BIPED = ['body', 'head', 'arm.near', 'arm.far', 'leg.near', 'leg.far', 'tail'];

// ---------- four legs ----------

interface Gait {
  /** When each foot plants, as a fraction of the cycle. */
  phase: Record<'back.near' | 'front.near' | 'back.far' | 'front.far', number>;
  duty: number; // fraction of the cycle a foot is on the ground
  bobs: number; // body bounces per cycle
}

const GAITS: Record<string, Gait> = {
  walk: { phase: { 'back.near': 0, 'front.near': 0.25, 'back.far': 0.5, 'front.far': 0.75 }, duty: 0.65, bobs: 2 },
  trot: { phase: { 'back.near': 0, 'front.far': 0, 'front.near': 0.5, 'back.far': 0.5 }, duty: 0.5, bobs: 2 },
  pace: { phase: { 'back.near': 0, 'front.near': 0, 'back.far': 0.5, 'front.far': 0.5 }, duty: 0.5, bobs: 2 },
  canter: { phase: { 'back.near': 0, 'back.far': 0.3, 'front.near': 0.3, 'front.far': 0.55 }, duty: 0.45, bobs: 1 },
  gallop: { phase: { 'back.near': 0, 'back.far': 0.1, 'front.far': 0.4, 'front.near': 0.5 }, duty: 0.35, bobs: 1 },
};

function quadGait(gait: Gait, p: Params, d: number, ctx: RigCtx): Gen[] {
  const s = ctx.facing;
  const stride = s * num(p.stride);
  const bounce = num(p.bounce);
  const out: Gen[] = [];
  for (const [legName, ph] of Object.entries(gait.phase)) out.push(...track(ctx, `leg.${legName}`, 'rotation', ctx.axis, d, 1, leg(ph, gait.duty, stride)));
  out.push(
    ...track(ctx, 'body', 'position', Y, d, gait.bobs, wave(0.5, bounce / 2, bounce / 2)),
    ...track(ctx, 'head', 'rotation', ctx.axis, d, gait.bobs, wave(0.1, -s * num(p.head))),
    ...track(ctx, 'tail', 'rotation', ctx.axis, d, 1, wave(0.25, num(p.tail))),
  );
  // canter and gallop rock the body: nose up as the back legs push, down as the front legs land
  if (num(p.rock)) out.push(...track(ctx, 'body', 'rotation', ctx.axis, d, 1, wave(0.2, s * num(p.rock))));
  return out;
}

const quadParams = (stride: number, bounce: number, head: number, tail: number, rock: number) => [
  { key: 'stride', label: 'Leg swing', kind: 'range' as const, default: stride, min: 5, max: 70, step: 1, unit: '°' },
  { key: 'bounce', label: 'Bounce', kind: 'range' as const, default: bounce, min: 0, max: 2, step: 0.05, unit: ' tiles' },
  { key: 'head', label: 'Head bob', kind: 'range' as const, default: head, min: 0, max: 20, step: 0.5, unit: '°' },
  { key: 'tail', label: 'Tail sway', kind: 'range' as const, default: tail, min: 0, max: 45, step: 1, unit: '°' },
  { key: 'rock', label: 'Body rock', kind: 'range' as const, default: rock, min: 0, max: 20, step: 0.5, unit: '°' },
];

const QUAD = ['body', 'head', 'leg.front.near', 'leg.front.far', 'leg.back.near', 'leg.back.far', 'tail'];

const gaitPreset = (id: string, name: string, icon: string, help: string, length: number, gait: Gait, params: ReturnType<typeof quadParams>, template: 'quadruped' | 'shell' = 'quadruped'): PresetDef => ({
  id,
  name,
  icon,
  help,
  template,
  roles: QUAD,
  pivot: 'centre',
  pivotHint: 'set per part',
  length,
  params,
  loops: () => true,
  generate: (p, d, ctx) => quadGait(gait, p, d, ctx),
});

// ---------- shell creatures ----------

const LIMBS = ['head', 'leg.front.near', 'leg.front.far', 'leg.back.near', 'leg.back.far', 'tail'];

type TimedKey = [t: number, v: Vec3, ease: Ease];

/** Retract (in = true) or peek out, as normalized keys per role; the head comes out last. */
function shellMotion(p: Params, ctx: RigCtx, retract: boolean): Map<string, Partial<Record<Prop, TimedKey[]>>> {
  const out = new Map<string, Partial<Record<Prop, TimedKey[]>>>();
  const shellId = ctx.part('body');
  if (!shellId) return out;
  const s = ctx.facing;
  const [sx, sy] = ctx.pivot(shellId);
  const depth = num(p.depth);
  const shrink = num(p.shrink);
  const drop = num(p.drop);
  const rest: Vec3 = [0, 0, 0];
  for (const role of LIMBS) {
    const id = ctx.part(role);
    if (!id) continue;
    const [px, py] = ctx.pivot(id);
    // slide the limb's joint towards the middle of the shell (y up), then shrink it out of sight
    const inside: Vec3 = [(sx - px) * depth, -(sy - py) * depth, 0];
    const small: Vec3 = [shrink, shrink, shrink];
    const isHead = role === 'head';
    if (retract) {
      const antic: Vec3 = isHead ? [s * 0.2, 0.2, 0] : [0, 0.1, 0];
      out.set(id, {
        position: [[0, rest, 'sine.inOut'], [0.18, antic, 'back.in'], [0.55, inside, 'linear']],
        scale: [[0, [1, 1, 1], 'linear'], [0.18, [1, 1, 1], 'quad.in'], [0.55, small, 'linear']],
      });
    } else {
      const [a, b] = isHead ? [0.45, 1] : [0.3, 0.7];
      out.set(id, {
        position: [[0, inside, 'linear'], [a, inside, 'back.out'], [b, rest, 'linear']],
        scale: [[0, small, 'linear'], [a, small, 'back.out'], [b, [1, 1, 1], 'linear']],
      });
    }
  }
  out.set(
    shellId,
    retract
      ? {
          // a small squash as it braces, then the shell drops onto the ground and bounces
          position: [[0, rest, 'linear'], [0.55, rest, 'bounce.out'], [1, [0, -drop, 0], 'linear']],
          scale: [[0, [1, 1, 1], 'sine.inOut'], [0.18, [1.04, 0.94, 1], 'sine.inOut'], [0.4, [1, 1, 1], 'linear']],
        }
      : { position: [[0, [0, -drop, 0], 'back.out'], [0.3, rest, 'linear']] },
  );
  return out;
}

function shellRetract(p: Params, d: number, ctx: RigCtx): Gen[] {
  const mode = p.mode;
  // hide and peek: retract in the first 45%, hold, peek out in the last 45%
  const parts: [Map<string, Partial<Record<Prop, TimedKey[]>>>, number, number][] =
    mode === 'peek'
      ? [[shellMotion(p, ctx, false), 0, 1]]
      : mode === 'both'
        ? [
            [shellMotion(p, ctx, true), 0, 0.45],
            [shellMotion(p, ctx, false), 0.55, 1],
          ]
        : [[shellMotion(p, ctx, true), 0, 1]];
  const merged = new Map<string, Key[]>();
  for (const [motion, from, to] of parts) {
    for (const [part, props] of motion) {
      for (const [prop, keys] of Object.entries(props) as [Prop, TimedKey[]][]) {
        const id = `${part}|${prop}`;
        if (!merged.has(id)) merged.set(id, []);
        // the last key of a section holds (linear) until the next section starts
        const mapped = keys.map(([t, v, ease], i): Key => ({ t: +(d * (from + t * (to - from))).toFixed(5), v, ease: i === keys.length - 1 ? 'linear' : ease }));
        merged.get(id)!.push(...mapped);
      }
    }
  }
  return [...merged].map(([id, keys]) => {
    const [part, prop] = id.split('|') as [string, Prop];
    keys.sort((a, b) => a.t - b.t);
    return { part, prop, keys };
  });
}

// ---------- the presets ----------

export const CREATURE_PRESETS: PresetDef[] = [
  {
    id: 'biped.walk',
    name: 'Walk',
    icon: '🚶',
    help: 'A walk cycle: legs and arms swing in opposition, the body bobs twice per step cycle.',
    template: 'biped',
    roles: BIPED,
    pivot: 'centre',
    pivotHint: 'set per part',
    length: 1,
    params: bipedParams(25, 20, 0.3, 0, 3),
    loops: () => true,
    generate: (p, d, ctx) => bipedGait(p, d, ctx, 0.6),
  },
  {
    id: 'biped.run',
    name: 'Run',
    icon: '🏃',
    help: 'A run cycle: bigger swings, more bounce, a forward lean, feet on the ground less.',
    template: 'biped',
    roles: BIPED,
    pivot: 'centre',
    pivotHint: 'set per part',
    length: 0.6,
    params: bipedParams(45, 45, 0.6, 10, 4),
    loops: () => true,
    generate: (p, d, ctx) => bipedGait(p, d, ctx, 0.38),
  },
  {
    id: 'biped.idle',
    name: 'Idle',
    icon: '🧍',
    help: 'Standing still but alive: breathing, a slight head bob and arm sway.',
    template: 'biped',
    roles: BIPED,
    pivot: 'centre',
    pivotHint: 'set per part',
    length: 2.5,
    params: [
      { key: 'breath', label: 'Breathing', kind: 'range', default: 0.03, min: 0, max: 0.15, step: 0.005, unit: '×' },
      { key: 'head', label: 'Head bob', kind: 'range', default: 2, min: 0, max: 10, step: 0.5, unit: '°' },
      { key: 'arms', label: 'Arm sway', kind: 'range', default: 3, min: 0, max: 15, step: 0.5, unit: '°' },
    ],
    loops: () => true,
    generate: (p, d, ctx) => [
      ...track(ctx, 'body', 'scale', Y, d, 1, wave(0.5, num(p.breath) / 2, 1 + num(p.breath) / 2)),
      ...track(ctx, 'head', 'rotation', ctx.axis, d, 1, wave(0.6, -ctx.facing * num(p.head))),
      ...track(ctx, 'arm.near', 'rotation', ctx.axis, d, 1, wave(0.5, ctx.facing * num(p.arms))),
      ...track(ctx, 'arm.far', 'rotation', ctx.axis, d, 1, wave(0.6, ctx.facing * num(p.arms))),
      ...track(ctx, 'tail', 'rotation', ctx.axis, d, 1, wave(0.25, 6)),
    ],
  },
  gaitPreset('quad.walk', 'Walk', '🐕', 'Four-beat walk: back, front, back, front, so two or three feet are always down.', 1.1, GAITS.walk, quadParams(22, 0.15, 4, 10, 0)),
  gaitPreset('quad.trot', 'Trot', '🐎', 'Diagonal pairs move together. Bouncy.', 0.6, GAITS.trot, quadParams(28, 0.3, 5, 12, 0)),
  gaitPreset('quad.pace', 'Pace', '🐫', 'Same-side pairs move together, like camels and some dogs.', 0.6, GAITS.pace, quadParams(26, 0.25, 4, 10, 0)),
  gaitPreset('quad.canter', 'Canter', '🏇', 'A rocking three-beat run.', 0.7, GAITS.canter, quadParams(35, 0.35, 6, 14, 4)),
  gaitPreset('quad.gallop', 'Gallop', '💨', 'The fastest gait: gather, then stretch out in a leap.', 0.45, GAITS.gallop, quadParams(45, 0.5, 6, 16, 8)),
  {
    id: 'quad.idle',
    name: 'Idle',
    icon: '🐈',
    help: 'Breathing, a slow head bob and a tail wag.',
    template: 'quadruped',
    roles: QUAD,
    pivot: 'centre',
    pivotHint: 'set per part',
    length: 2,
    params: [
      { key: 'breath', label: 'Breathing', kind: 'range', default: 0.03, min: 0, max: 0.15, step: 0.005, unit: '×' },
      { key: 'head', label: 'Head bob', kind: 'range', default: 3, min: 0, max: 15, step: 0.5, unit: '°' },
      { key: 'tail', label: 'Tail wag', kind: 'range', default: 15, min: 0, max: 45, step: 1, unit: '°' },
    ],
    loops: () => true,
    generate: (p, d, ctx) => [
      ...track(ctx, 'body', 'scale', Y, d, 1, wave(0.5, num(p.breath) / 2, 1 + num(p.breath) / 2)),
      ...track(ctx, 'head', 'rotation', ctx.axis, d, 1, wave(0.6, -ctx.facing * num(p.head))),
      ...track(ctx, 'tail', 'rotation', ctx.axis, d, 2, wave(0, num(p.tail))),
    ],
  },
  {
    id: 'shell.retract',
    name: 'Hide',
    icon: '🐢',
    help: 'Pulls the head, legs and tail into the shell, and the shell drops to the ground. Or peeks back out.',
    template: 'shell',
    roles: ['body', ...LIMBS],
    pivot: 'centre',
    pivotHint: 'set per part',
    length: 0.8,
    params: [
      { key: 'mode', label: 'Plays', kind: 'select', default: 'retract', options: [['retract', 'Hide in the shell'], ['peek', 'Peek back out'], ['both', 'Hide, then peek (loop)']] },
      { key: 'drop', label: 'Shell drops', kind: 'range', default: 1, min: 0, max: 4, step: 0.25, unit: ' tiles' },
      { key: 'depth', label: 'Pull in', kind: 'range', default: 0.8, min: 0.2, max: 1, step: 0.05, unit: '×' },
      { key: 'shrink', label: 'Shrink to', kind: 'range', default: 0.15, min: 0.001, max: 1, step: 0.01, unit: '×' },
    ],
    loops: (p) => p.mode === 'both',
    generate: shellRetract,
  },
  gaitPreset('shell.walk', 'Walk', '🐾', 'A slow four-beat walk with a small bob.', 1.8, GAITS.walk, quadParams(15, 0.1, 4, 6, 0), 'shell'),
];
