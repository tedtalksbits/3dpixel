// Dope sheet: every part's keys laid out over time. A summary row per part (all its keys at each
// time), which expands into Rotate / Move / Scale rows. Click to select keys (Shift adds), drag to
// move them in time, double-click empty space in a part row to key its pose there, and click empty
// space to move the playhead.

import { Clip, Prop, FPS, snapTime } from './anim';
import { easeLabel } from './easing';
import type { Part } from './rig';

export const PROPS: [Prop, string][] = [
  ['rotation', 'Rotate'],
  ['position', 'Move'],
  ['scale', 'Scale'],
];

/** A key is identified by where it is: part, property and time. */
export const keyId = (part: string, prop: Prop, t: number) => `${part}|${prop}|${t.toFixed(4)}`;
export const parseKeyId = (id: string) => {
  const [part, prop, t] = id.split('|');
  return { part, prop: prop as Prop, t: +t };
};

export interface DopeView {
  clip: Clip | null;
  rows: { part: Part; depth: number }[];
  active: string;
  time: number;
  selected: Set<string>;
  expanded: Set<string>;
}

export interface DopeActions {
  seek(t: number): void;
  selectPart(id: string): void;
  /** Replace the selection, or add to it. */
  select(ids: string[], add: boolean): void;
  /** Move the selected keys by dt seconds (already snapped). */
  move(dt: number): void;
  keyPose(part: string, t: number): void;
  toggle(part: string): void;
}

const PAD = 8; // lanes are inset like the play bar, so times line up with it
const at = (f: number) => `calc(${PAD}px + (100% - ${PAD * 2}px) * ${f})`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function ruler(d: number) {
  // a label every 0.25 s (every 0.5 s on long clips), a small tick every frame when they fit
  const step = d > 3 ? 0.5 : 0.25;
  let s = '';
  for (let t = 0; t <= d + 1e-6; t += step) s += `<span class="ds-sec" style="left:${at(t / d)}">${+t.toFixed(2)}</span>`;
  if (d * FPS <= 120) for (let f = 0; f <= d * FPS; f++) s += `<span class="ds-frame" style="left:${at(f / FPS / d)}"></span>`;
  return s;
}

export function renderDopeSheet(host: HTMLElement, v: DopeView) {
  const c = v.clip;
  if (!c) {
    host.innerHTML = `<div class="ds-empty hint">No clip. Make one from a preset or with "+ New clip" to see its keys here.</div>`;
    return;
  }
  const d = c.duration;
  const rows = v.rows
    .map(({ part, depth }) => {
      const tracks = c.tracks.filter((tr) => tr.part === part.id);
      const times = [...new Set(tracks.flatMap((tr) => tr.keys.map((k) => +k.t.toFixed(4))))].sort((a, b) => a - b);
      const open = v.expanded.has(part.id);
      const summary = times
        .map((t) => {
          const ids = tracks.flatMap((tr) => tr.keys.filter((k) => Math.abs(k.t - t) < 1e-4).map(() => keyId(part.id, tr.prop, t)));
          const sel = ids.every((id) => v.selected.has(id));
          return `<span class="ds-key sum${sel ? ' sel' : ''}" style="left:${at(t / d)}" data-ids="${ids.join(' ')}" data-t="${t}" title="${t.toFixed(2)} s"></span>`;
        })
        .join('');
      const preset = tracks.some((tr) => tr.preset) ? '<span class="ds-tag" title="Made by a live preset: editing a key turns it into plain keys">preset</span>' : '';
      let html = `<div class="ds-row part${part.id === v.active ? ' active' : ''}" data-part="${part.id}">
        <div class="ds-label" style="padding-left:${6 + depth * 12}px"><button class="ds-toggle" data-toggle="${part.id}" title="${open ? 'Hide' : 'Show'} rotate, move and scale">${open ? '▾' : '▸'}</button>${esc(part.name)}${preset}</div>
        <div class="ds-lane">${summary}</div></div>`;
      if (open) {
        for (const [prop, label] of PROPS) {
          const tr = tracks.find((o) => o.prop === prop);
          const keys = tr?.keys ?? [];
          // segments between keys: dashed when held (step), solid otherwise
          const segs = keys
            .slice(0, -1)
            .map((k, i) => {
              const next = keys[i + 1];
              return `<span class="ds-seg${k.ease === 'step' ? ' hold' : ''}" style="left:${at(k.t / d)};width:calc((100% - ${PAD * 2}px) * ${(next.t - k.t) / d})"></span>`;
            })
            .join('');
          const diamonds = keys
            .map((k) => {
              const id = keyId(part.id, prop, k.t);
              return `<span class="ds-key${v.selected.has(id) ? ' sel' : ''}" style="left:${at(k.t / d)}" data-ids="${id}" data-t="${k.t}" title="${k.t.toFixed(2)} s · ${k.v.map((n) => +n.toFixed(2)).join(', ')} · ${esc(easeLabel(k.ease))}"></span>`;
            })
            .join('');
          html += `<div class="ds-row prop" data-part="${part.id}"><div class="ds-label sub" style="padding-left:${24 + depth * 12}px">${label}</div><div class="ds-lane">${segs}${diamonds}</div></div>`;
        }
      }
      return html;
    })
    .join('');
  host.innerHTML = `<div class="ds-grid">
    <div class="ds-row ruler"><div class="ds-label hint">${v.selected.size ? `${v.selected.size} key${v.selected.size === 1 ? '' : 's'} selected` : 'Double-click to key'}</div><div class="ds-lane" data-ruler="1">${ruler(d)}</div></div>
    ${rows}
    <div class="ds-headwrap"><div class="ds-head" style="left:${at(v.time / d)}"></div></div>
  </div>`;
}

/** Move only the playhead (cheap, for playback). */
export function moveDopeHead(host: HTMLElement, clip: Clip | null, time: number) {
  const head = host.querySelector<HTMLElement>('.ds-head');
  if (head && clip) head.style.left = at(time / clip.duration);
}

export function bindDopeSheet(host: HTMLElement, getClip: () => Clip | null, act: DopeActions) {
  // selecting and seeking redraw the sheet, so lanes are measured once, before anything changes
  const timeAt = (r: DOMRect, x: number) => {
    const c = getClip()!;
    return Math.max(0, Math.min(c.duration, snapTime(((x - r.left - PAD) / (r.width - PAD * 2)) * c.duration)));
  };
  host.addEventListener('pointerdown', (e) => {
    const el = e.target as HTMLElement;
    const c = getClip();
    if (!c || e.button !== 0) return;
    const toggle = el.closest<HTMLElement>('[data-toggle]');
    if (toggle) return act.toggle(toggle.dataset.toggle!);
    const row = el.closest<HTMLElement>('.ds-row');
    const lane = el.closest<HTMLElement>('.ds-lane');
    const key = el.closest<HTMLElement>('.ds-key');
    if (row?.dataset.part && !lane) return act.selectPart(row.dataset.part);
    if (!lane) return;
    const box = lane.getBoundingClientRect();
    if (!key) {
      // empty lane or ruler: scrub
      act.seek(timeAt(box, e.clientX));
      if (row?.dataset.part) act.selectPart(row.dataset.part);
      const move = (ev: PointerEvent) => act.seek(timeAt(box, ev.clientX));
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return;
    }
    // a key: select it (Shift adds), then drag the selection along the timeline
    e.preventDefault();
    const ids = key.dataset.ids!.split(' ').filter(Boolean);
    const already = key.classList.contains('sel');
    if (!already || e.shiftKey) act.select(ids, e.shiftKey);
    if (row?.dataset.part) act.selectPart(row.dataset.part);
    act.seek(+key.dataset.t!);
    const startT = +key.dataset.t!;
    const pxPerSec = (box.width - PAD * 2) / c.duration;
    let dt = 0;
    const move = (ev: PointerEvent) => {
      dt = snapTime((ev.clientX - e.clientX) / pxPerSec);
      dt = Math.max(-startT, Math.min(c.duration - startT, dt));
      for (const k of host.querySelectorAll<HTMLElement>('.ds-key.sel')) k.style.transform = `translateX(${dt * pxPerSec}px) rotate(45deg)`;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (Math.abs(dt) > 1e-6) act.move(dt);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  host.addEventListener('dblclick', (e) => {
    const el = e.target as HTMLElement;
    const lane = el.closest<HTMLElement>('.ds-lane');
    const row = el.closest<HTMLElement>('.ds-row');
    if (!lane || !row?.dataset.part || el.closest('.ds-key') || !getClip()) return;
    act.keyPose(row.dataset.part, timeAt(lane.getBoundingClientRect(), e.clientX));
  });
}
