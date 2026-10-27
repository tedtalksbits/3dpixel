// Animation clips: keyframed tracks per rig part, evaluated with easing. Clips are edited as Euler
// degrees (readable, and spins can pass 360°) and baked into glTF keyframes on export.

import { Ease, ease, isEase } from './easing';
import type { PresetUse } from './presets';

export type Prop = 'rotation' | 'position' | 'scale';
export type Vec3 = [number, number, number];

export interface Key {
  t: number; // seconds
  v: Vec3; // rotation: degrees about X, Y, Z · position: offset in tiles, +Y up · scale: factor
  /** Easing of the segment from this key to the next. */
  ease: Ease;
}

export interface Track {
  part: string; // Part.id
  prop: Prop;
  keys: Key[]; // sorted by t
  /** Id of the PresetUse that generates this track; it's rebuilt when the preset changes. */
  preset?: string;
}

export interface Clip {
  id: string;
  name: string;
  duration: number; // seconds
  loop: boolean;
  tracks: Track[];
  /** Live presets; see presets.ts. */
  presets?: PresetUse[];
}

export interface Pose {
  rotation: Vec3;
  position: Vec3;
  scale: Vec3;
}

export const FPS = 24; // key times snap to frames at this rate
export const BAKE_FPS = 30; // samples per second written to glTF (plus every key time)

export const REST: Record<Prop, Vec3> = { rotation: [0, 0, 0], position: [0, 0, 0], scale: [1, 1, 1] };
export const restPose = (): Pose => ({ rotation: [0, 0, 0], position: [0, 0, 0], scale: [1, 1, 1] });

let counter = 0;
export const newClipId = () => `c${Date.now().toString(36)}${(counter++).toString(36)}`;

export const newClip = (name: string): Clip => ({ id: newClipId(), name, duration: 1, loop: true, tracks: [] });

export const snapTime = (t: number) => Math.round(t * FPS) / FPS;

const lerp = (a: Vec3, b: Vec3, k: number): Vec3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

/**
 * Value of a track at time t. Before the first key and after the last it holds, except in a
 * looping clip, where the gap across the loop point eases from the last key into the first, so
 * loops are seamless without a duplicate end key, and cycles can start part-way through.
 */
export function sampleTrack(track: Track, t: number, clip: Clip): Vec3 {
  const keys = track.keys;
  if (!keys.length) return [...REST[track.prop]];
  if (t < keys[0].t) {
    const last = keys[keys.length - 1];
    if (clip.loop && keys.length > 1 && last.t < clip.duration) {
      const span = clip.duration - last.t + keys[0].t;
      return lerp(last.v, keys[0].v, ease(last.ease, (t + clip.duration - last.t) / span));
    }
    return [...keys[0].v];
  }
  if (t === keys[0].t) return [...keys[0].v];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t < b.t) return lerp(a.v, b.v, ease(a.ease, (t - a.t) / (b.t - a.t)));
  }
  const last = keys[keys.length - 1];
  if (clip.loop && keys.length > 1 && last.t < clip.duration) {
    const span = clip.duration - last.t + keys[0].t;
    return lerp(last.v, keys[0].v, ease(last.ease, (t - last.t) / span));
  }
  return [...last.v];
}

/** Pose of every animated part at time t (wrapped for looping clips). */
export function evalClip(clip: Clip, t: number): Map<string, Pose> {
  const time = clip.loop && clip.duration > 0 ? ((t % clip.duration) + clip.duration) % clip.duration : Math.min(t, clip.duration);
  const out = new Map<string, Pose>();
  for (const tr of clip.tracks) {
    if (!out.has(tr.part)) out.set(tr.part, restPose());
    out.get(tr.part)![tr.prop] = sampleTrack(tr, time, clip);
  }
  return out;
}

export function findTrack(clip: Clip, part: string, prop: Prop) {
  return clip.tracks.find((tr) => tr.part === part && tr.prop === prop);
}

/** Set one component of a property at time t, creating the track and key as needed (auto-key). */
export function setKey(clip: Clip, part: string, prop: Prop, t: number, axis: 0 | 1 | 2, value: number, keyEase: Ease) {
  let tr = findTrack(clip, part, prop);
  if (!tr) clip.tracks.push((tr = { part, prop, keys: [] }));
  let key = tr.keys.find((k) => Math.abs(k.t - t) < 1e-6);
  if (!key) {
    key = { t, v: sampleTrack(tr, t, clip), ease: keyEase };
    tr.keys.push(key);
    tr.keys.sort((a, b) => a.t - b.t);
  }
  key.v[axis] = value;
}

/** Times (deduplicated) with a key for this part, for markers on the play bar. */
export function keyTimes(clip: Clip, part?: string): number[] {
  const set = new Set<number>();
  for (const tr of clip.tracks) if (!part || tr.part === part) for (const k of tr.keys) set.add(+k.t.toFixed(4));
  return [...set].sort((a, b) => a - b);
}

export function keysAt(clip: Clip, part: string, t: number): Key[] {
  return clip.tracks.filter((tr) => tr.part === part).flatMap((tr) => tr.keys.filter((k) => Math.abs(k.t - t) < 1e-6));
}

export function deleteKeysAt(clip: Clip, part: string, t: number) {
  for (const tr of clip.tracks) if (tr.part === part) tr.keys = tr.keys.filter((k) => Math.abs(k.t - t) >= 1e-6);
  clip.tracks = clip.tracks.filter((tr) => tr.keys.length);
}

/** Sample times for baking: a fixed rate plus every key time, so holds and snaps stay exact. */
export function bakeTimes(clip: Clip): number[] {
  const n = Math.max(1, Math.ceil(clip.duration * BAKE_FPS));
  const set = new Set<number>();
  for (let i = 0; i <= n; i++) set.add(+((clip.duration * i) / n).toFixed(5));
  for (const tr of clip.tracks) for (const k of tr.keys) if (k.t <= clip.duration) set.add(+k.t.toFixed(5));
  // a step ease jumps at the next key: sample just before it so the hold survives linear interpolation
  for (const tr of clip.tracks)
    for (let i = 1; i < tr.keys.length; i++) if (tr.keys[i - 1].ease === 'step' && tr.keys[i].t > 0.0005) set.add(+(tr.keys[i].t - 0.0005).toFixed(5));
  return [...set].filter((t) => t >= 0 && t <= clip.duration).sort((a, b) => a - b);
}

/** Read clips from a file, dropping anything malformed or pointing at parts that don't exist. */
export function parseClips(raw: unknown, partIds: Set<string>): Clip[] {
  if (!Array.isArray(raw)) return [];
  const vec = (v: unknown, d: Vec3): Vec3 => (Array.isArray(v) && v.length === 3 ? (v.map((n, i) => (Number.isFinite(+n) ? +n : d[i])) as Vec3) : [...d]);
  return raw.flatMap((c: any) => {
    if (!c || typeof c !== 'object') return [];
    const clip: Clip = {
      id: String(c.id ?? newClipId()),
      name: String(c.name ?? 'Clip'),
      duration: Math.max(1 / FPS, +c.duration || 1),
      loop: c.loop !== false,
      tracks: [],
    };
    for (const tr of Array.isArray(c.tracks) ? c.tracks : []) {
      if (!partIds.has(tr?.part) || !(tr.prop in REST)) continue;
      const keys: Key[] = (Array.isArray(tr.keys) ? tr.keys : [])
        .filter((k: any) => Number.isFinite(+k?.t))
        .map((k: any) => ({ t: +k.t, v: vec(k.v, REST[tr.prop as Prop]), ease: isEase(k.ease) ? k.ease : 'cubic.inOut' }))
        .sort((a: Key, b: Key) => a.t - b.t);
      if (keys.length) clip.tracks.push({ part: tr.part, prop: tr.prop, keys, ...(typeof tr.preset === 'string' ? { preset: tr.preset } : {}) });
    }
    if (Array.isArray(c.presets)) clip.presets = c.presets; // checked by cleanPresets in presets.ts
    return [clip];
  });
}

/** Clip name as exported. Godot loops clips whose names end in "loop", so looping clips get "-loop". */
export const exportName = (clip: Clip) => (clip.loop && !/loop$|cycle$/i.test(clip.name) ? `${clip.name}-loop` : clip.name);
