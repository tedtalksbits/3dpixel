// Animation presets: a few sliders that generate ordinary keyframe tracks. A preset stays live
// (its tracks are regenerated when a slider or the clip length changes) until it's customised,
// which leaves the keys behind for hand editing. Repeating presets use whole counts per clip
// (turns, bobs, swings), so every loop closes seamlessly.

import { Clip, Key, Prop, Track, Vec3, newClipId } from './anim';
import { Ease } from './easing';
import { CREATURE_PRESETS } from './creatures';
import { RigCtx, TemplateKind, emptyCtx } from './templates';

/** Object presets by name; creature presets are '<template>.<motion>', e.g. 'biped.walk'. */
export type PresetId = string;
export type ParamValue = number | string;
export type Params = Record<string, ParamValue>;

export interface ParamDef {
  key: string;
  label: string;
  /** Range sliders show `unit` after the value; selects list options. */
  kind: 'range' | 'select';
  default: ParamValue;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: [string, string][];
}

export type PivotSpot = 'centre' | 'top' | 'bottom' | 'left' | 'right';

/** A generated track; `part` defaults to the part the preset was applied to. */
export interface Gen {
  part?: string;
  prop: Prop;
  keys: Key[];
}

export interface PresetDef {
  id: PresetId;
  name: string;
  icon: string;
  help: string;
  /** Where the part's pivot usually belongs for this motion. */
  pivot: PivotSpot;
  pivotHint: string;
  length: number; // default clip length for a new clip, seconds
  params: ParamDef[];
  loops: (p: Params) => boolean;
  generate: (p: Params, duration: number, ctx: RigCtx) => Gen[];
  /** Creature presets belong to a rig template and drive parts by role. */
  template?: TemplateKind;
  roles?: string[];
}

/** A preset applied to one part of a clip. */
export interface PresetUse {
  id: string;
  preset: PresetId;
  part: string;
  params: Params;
}

const AXES: [string, string][] = [
  ['z', 'Z: in the drawing (wheel)'],
  ['y', 'Y: turntable (coin)'],
  ['x', 'X: tumble forward'],
];
const axisIndex = (a: ParamValue) => (a === 'x' ? 0 : a === 'y' ? 1 : 2);
const along = (axis: number, v: number, rest = 0): Vec3 => {
  const out: Vec3 = [rest, rest, rest];
  out[axis] = v;
  return out;
};
const num = (v: ParamValue) => +v || 0;
const key = (t: number, v: Vec3, ease: Ease): Key => ({ t: +t.toFixed(5), v, ease });

/** n even beats across the clip, alternating a and b, easing back to a at the loop point. */
function alternate(n: number, duration: number, a: Vec3, b: Vec3, ease: Ease): Key[] {
  const keys: Key[] = [];
  const step = duration / (n * 2);
  for (let i = 0; i < n * 2; i++) keys.push(key(i * step, i % 2 ? b : a, ease));
  return keys;
}

const OBJECT_PRESETS: Record<string, PresetDef> = {
  spin: {
    id: 'spin',
    name: 'Spin',
    icon: '⟳',
    help: 'Turns round and round at a steady speed. Wheels, coins, fans, pickups.',
    pivot: 'centre',
    pivotHint: 'centre (the axle)',
    length: 1,
    params: [
      { key: 'axis', label: 'Axis', kind: 'select', default: 'z', options: AXES },
      { key: 'turns', label: 'Turns per loop', kind: 'range', default: 1, min: 1, max: 8, step: 1 },
      { key: 'direction', label: 'Direction', kind: 'select', default: 'cw', options: [['cw', 'Clockwise'], ['ccw', 'Counter-clockwise']] },
      { key: 'ease', label: 'Speed', kind: 'select', default: 'linear', options: [['linear', 'Steady'], ['sine.inOut', 'Wind up and slow down']] },
    ],
    loops: () => true,
    generate: (p, d) => {
      const ax = axisIndex(p.axis);
      // clockwise as seen from the front (+Z) or above (+Y) is a negative angle
      const total = 360 * num(p.turns) * (p.direction === 'ccw' ? 1 : -1);
      return [{ prop: 'rotation', keys: [key(0, along(ax, 0), p.ease as Ease), key(d, along(ax, total), p.ease as Ease)] }];
    },
  },
  bob: {
    id: 'bob',
    name: 'Bob',
    icon: '↕',
    help: 'Floats up and down. Hovering pickups, boats, idle breathing.',
    pivot: 'centre',
    pivotHint: 'anywhere (it only moves)',
    length: 2,
    params: [
      { key: 'height', label: 'Height', kind: 'range', default: 0.5, min: 0.1, max: 4, step: 0.1, unit: ' tiles' },
      { key: 'count', label: 'Bobs per loop', kind: 'range', default: 1, min: 1, max: 4, step: 1 },
      { key: 'ease', label: 'Feel', kind: 'select', default: 'sine.inOut', options: [['sine.inOut', 'Float'], ['quad.out', 'Bouncy (quick up)']] },
    ],
    loops: () => true,
    generate: (p, d) => [{ prop: 'position', keys: alternate(num(p.count), d, [0, 0, 0], [0, num(p.height), 0], p.ease as Ease) }],
  },
  swing: {
    id: 'swing',
    name: 'Swing',
    icon: '⤸',
    help: 'Rocks back and forth like a pendulum. Hanging signs, lanterns, bells, tails.',
    pivot: 'top',
    pivotHint: 'top (where it hangs)',
    length: 1.5,
    params: [
      { key: 'angle', label: 'Angle', kind: 'range', default: 20, min: 2, max: 90, step: 1, unit: '°' },
      { key: 'count', label: 'Swings per loop', kind: 'range', default: 1, min: 1, max: 4, step: 1 },
      { key: 'axis', label: 'Axis', kind: 'select', default: 'z', options: AXES },
    ],
    loops: () => true,
    generate: (p, d) => {
      const ax = axisIndex(p.axis);
      const a = num(p.angle);
      return [{ prop: 'rotation', keys: alternate(num(p.count), d, along(ax, a), along(ax, -a), 'sine.inOut') }];
    },
  },
  hinge: {
    id: 'hinge',
    name: 'Hinge',
    icon: '⌐',
    help: 'Opens on a hinge. Doors, lids, chests, trapdoors.',
    pivot: 'left',
    pivotHint: 'on the hinge edge',
    length: 1.5,
    params: [
      { key: 'angle', label: 'Opens by', kind: 'range', default: 90, min: -180, max: 180, step: 5, unit: '°' },
      { key: 'mode', label: 'Plays', kind: 'select', default: 'openClose', options: [['openClose', 'Open, hold, close (loop)'], ['open', 'Open once'], ['close', 'Close once']] },
      { key: 'axis', label: 'Axis', kind: 'select', default: 'z', options: [['z', 'Z: lid in the drawing'], ['y', 'Y: door swinging out'], ['x', 'X: flap tipping forward']] },
      { key: 'ease', label: 'Feel', kind: 'select', default: 'cubic.inOut', options: [['cubic.inOut', 'Smooth'], ['back.out', 'Snappy (overshoot)'], ['bounce.out', 'Slam (bounce)']] },
    ],
    loops: (p) => p.mode === 'openClose',
    generate: (p, d) => {
      const ax = axisIndex(p.axis);
      const shut = along(ax, 0);
      const open = along(ax, num(p.angle));
      const e = p.ease as Ease;
      if (p.mode === 'open') return [{ prop: 'rotation', keys: [key(0, shut, e), key(d, open, e)] }];
      if (p.mode === 'close') return [{ prop: 'rotation', keys: [key(0, open, e), key(d, shut, e)] }];
      // open over the first 40%, hold, then close; the loop eases from the last key back to shut
      return [{ prop: 'rotation', keys: [key(0, shut, e), key(d * 0.4, open, 'linear'), key(d * 0.6, open, e)] }];
    },
  },
  pulse: {
    id: 'pulse',
    name: 'Pulse',
    icon: '◉',
    help: 'Grows and shrinks. Hearts, power-ups, buttons, breathing.',
    pivot: 'centre',
    pivotHint: 'centre (bottom to squash on the ground)',
    length: 1,
    params: [
      { key: 'amount', label: 'Grows to', kind: 'range', default: 1.2, min: 1.02, max: 2, step: 0.02, unit: '×' },
      { key: 'count', label: 'Pulses per loop', kind: 'range', default: 1, min: 1, max: 4, step: 1 },
      { key: 'style', label: 'Style', kind: 'select', default: 'uniform', options: [['uniform', 'Even'], ['squash', 'Stretch up, keep volume']] },
    ],
    loops: () => true,
    generate: (p, d) => {
      const k = num(p.amount);
      // keeping volume: stretch one axis by k and shrink the other two by 1/√k
      const big: Vec3 = p.style === 'squash' ? [1 / Math.sqrt(k), k, 1 / Math.sqrt(k)] : [k, k, k];
      return [{ prop: 'scale', keys: alternate(num(p.count), d, [1, 1, 1], big, 'sine.inOut') }];
    },
  },
  pop: {
    id: 'pop',
    name: 'Pop',
    icon: '✸',
    help: 'Pops into view, or out of it. Spawning pickups, UI, things appearing.',
    pivot: 'bottom',
    pivotHint: 'bottom (grows from the ground) or centre',
    length: 0.35,
    params: [
      { key: 'mode', label: 'Pops', kind: 'select', default: 'in', options: [['in', 'In (appear)'], ['out', 'Out (vanish)']] },
      { key: 'ease', label: 'Feel', kind: 'select', default: 'back', options: [['back', 'Overshoot'], ['elastic', 'Springy'], ['cubic', 'Smooth']] },
    ],
    loops: () => false,
    generate: (p, d) => {
      const zero: Vec3 = [0, 0, 0];
      const one: Vec3 = [1, 1, 1];
      if (p.mode === 'out') return [{ prop: 'scale', keys: [key(0, one, `${p.ease}.in` as Ease), key(d, zero, 'linear')] }];
      return [{ prop: 'scale', keys: [key(0, zero, `${p.ease}.out` as Ease), key(d, one, 'linear')] }];
    },
  },
};

export const PRESETS: Record<PresetId, PresetDef> = { ...OBJECT_PRESETS, ...Object.fromEntries(CREATURE_PRESETS.map((d) => [d.id, d])) };

/** Presets for any single part. */
export const PRESET_LIST = Object.values(OBJECT_PRESETS);
export const presetsFor = (kind: TemplateKind) => CREATURE_PRESETS.filter((d) => d.template === kind);

export const defaultParams = (def: PresetDef): Params => Object.fromEntries(def.params.map((p) => [p.key, p.default]));

/** Regenerate one preset's tracks in its clip. Tracks it owned are replaced; returns the props it drives. */
export function applyPreset(clip: Clip, use: PresetUse, ctx: RigCtx = emptyCtx): Gen[] {
  const def = PRESETS[use.preset];
  clip.tracks = clip.tracks.filter((tr) => tr.preset !== use.id);
  const made = def.generate(use.params, clip.duration, ctx);
  for (const g of made) {
    const tr: Track = { part: g.part ?? use.part, prop: g.prop, keys: g.keys, preset: use.id };
    clip.tracks.push(tr);
  }
  return made;
}

/** Add a preset to a clip, replacing whatever already drives the same part and properties. */
export function addPreset(clip: Clip, preset: PresetId, part: string, ctx: RigCtx = emptyCtx): PresetUse {
  const def = PRESETS[preset];
  const use: PresetUse = { id: newClipId(), preset, part, params: defaultParams(def) };
  const drives = new Set(def.generate(use.params, clip.duration, ctx).map((g) => `${g.part ?? part}|${g.prop}`));
  const clash = (tr: Track) => drives.has(`${tr.part}|${tr.prop}`);
  // earlier presets that drive the same part and property give way (their other tracks go too)
  for (const old of [...(clip.presets ?? [])]) if (clip.tracks.some((tr) => tr.preset === old.id && clash(tr))) removePreset(clip, old.id);
  clip.tracks = clip.tracks.filter((tr) => !clash(tr));
  (clip.presets ??= []).push(use);
  applyPreset(clip, use, ctx);
  return use;
}

export function removePreset(clip: Clip, id: string) {
  clip.presets = (clip.presets ?? []).filter((u) => u.id !== id);
  clip.tracks = clip.tracks.filter((tr) => tr.preset !== id);
}

/** Keep the keys but stop the preset regenerating them, so they can be edited by hand. */
export function customisePreset(clip: Clip, id: string) {
  clip.presets = (clip.presets ?? []).filter((u) => u.id !== id);
  for (const tr of clip.tracks) if (tr.preset === id) delete tr.preset;
}

/** After the clip's length changes, rebuild every live preset to fit it. */
export function refreshPresets(clip: Clip, ctx: RigCtx = emptyCtx) {
  for (const use of clip.presets ?? []) applyPreset(clip, use, ctx);
}

/** Bring stored params in line with the preset's definition (unknown keys dropped, bad values defaulted). */
export function cleanParams(def: PresetDef, raw: unknown): Params {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: Params = {};
  for (const p of def.params) {
    const v = src[p.key];
    if (p.kind === 'select') out[p.key] = p.options!.some(([o]) => o === v) ? (v as string) : p.default;
    else out[p.key] = Number.isFinite(+(v as number)) && v !== null && v !== '' ? Math.max(p.min!, Math.min(p.max!, +(v as number))) : p.default;
  }
  return out;
}

/** Validate presets read from a file, and untag tracks whose preset didn't survive. */
export function cleanPresets(clip: Clip, partIds: Set<string>) {
  const raw: any[] = Array.isArray(clip.presets) ? clip.presets : [];
  clip.presets = raw.flatMap((u) => {
    const def = u && PRESETS[u.preset as PresetId];
    if (!def || !partIds.has(u.part) || typeof u.id !== 'string') return [];
    return [{ id: u.id, preset: def.id, part: u.part, params: cleanParams(def, u.params) }];
  });
  if (!clip.presets.length) delete clip.presets;
  const live = new Set((clip.presets ?? []).map((u) => u.id));
  for (const tr of clip.tracks) if (tr.preset && !live.has(tr.preset)) delete tr.preset;
}
