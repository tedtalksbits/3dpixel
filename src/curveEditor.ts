// Curve editor for one ease: a graph of progress over time, a menu of named eases, and two
// handles that make it a custom cubic Bézier. Dragging a handle on a named ease starts from that
// ease's own Bézier (the control points easings.net gives), so tweaks begin from what's there.

import { Ease, EASE_OPTIONS, bezierEase, ease, parseBezier } from './easing';

/** Bézier equivalents of the named eases, from easings.net. Elastic, bounce and step have none. */
const AS_BEZIER: Partial<Record<string, [number, number, number, number]>> = {
  linear: [0, 0, 1, 1],
  'sine.in': [0.12, 0, 0.39, 0],
  'sine.out': [0.61, 1, 0.88, 1],
  'sine.inOut': [0.37, 0, 0.63, 1],
  'quad.in': [0.11, 0, 0.5, 0],
  'quad.out': [0.5, 1, 0.89, 1],
  'quad.inOut': [0.45, 0, 0.55, 1],
  'cubic.in': [0.32, 0, 0.67, 0],
  'cubic.out': [0.33, 1, 0.68, 1],
  'cubic.inOut': [0.65, 0, 0.35, 1],
  'quart.in': [0.5, 0, 0.75, 0],
  'quart.out': [0.25, 1, 0.5, 1],
  'quart.inOut': [0.76, 0, 0.24, 1],
  'quint.in': [0.64, 0, 0.78, 0],
  'quint.out': [0.22, 1, 0.36, 1],
  'quint.inOut': [0.83, 0, 0.17, 1],
  'expo.in': [0.7, 0, 0.84, 0],
  'expo.out': [0.16, 1, 0.3, 1],
  'expo.inOut': [0.87, 0, 0.13, 1],
  'circ.in': [0.55, 0, 1, 0.45],
  'circ.out': [0, 0.55, 0.45, 1],
  'circ.inOut': [0.85, 0, 0.15, 1],
  'back.in': [0.36, 0, 0.66, -0.56],
  'back.out': [0.34, 1.56, 0.64, 1],
  'back.inOut': [0.68, -0.6, 0.32, 1.6],
};

const W = 220;
const H = 150;
const PADX = 14;
const LO = -0.45; // values shown: room for overshoot below 0 and above 1
const HI = 1.45;
const sx = (x: number) => PADX + x * (W - PADX * 2);
const sy = (y: number) => H - ((y - LO) / (HI - LO)) * H;

export interface CurveHandlers {
  /** live = true while dragging (no undo step yet); false when the change is final. */
  change(e: Ease, live: boolean): void;
}

/** `current` null means the selected keys use different eases. */
export function renderCurveEditor(host: HTMLElement, current: Ease | null, title: string) {
  const b = current ? parseBezier(current) ?? AS_BEZIER[current] ?? null : null;
  const path = current
    ? Array.from({ length: 65 }, (_, i) => {
        const x = i / 64;
        // step holds, then jumps at the end: draw that honestly
        const y = current === 'step' ? (i === 64 ? 1 : 0) : ease(current, x);
        return `${i ? 'L' : 'M'}${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`;
      }).join(' ')
    : '';
  const custom = current?.startsWith('bezier:');
  const options =
    (current ? '' : '<option value="" selected>Mixed</option>') +
    EASE_OPTIONS.map(([e, l]) => `<option value="${e}"${e === current ? ' selected' : ''}>${l}</option>`).join('') +
    `<option value="custom"${custom ? ' selected' : ''}>Custom curve</option>`;
  const handles = b
    ? `<line x1="${sx(0)}" y1="${sy(0)}" x2="${sx(b[0])}" y2="${sy(b[1])}" class="ce-arm"/>
       <line x1="${sx(1)}" y1="${sy(1)}" x2="${sx(b[2])}" y2="${sy(b[3])}" class="ce-arm"/>
       <circle cx="${sx(b[0])}" cy="${sy(b[1])}" r="6" class="ce-handle" data-h="1"/>
       <circle cx="${sx(b[2])}" cy="${sy(b[3])}" r="6" class="ce-handle" data-h="2"/>`
    : '';
  host.innerHTML = `<div class="ce-title">${title}</div>
    <select class="ce-select" title="How the value moves from this key to the next">${options}</select>
    <svg class="ce-graph" viewBox="0 0 ${W} ${H}" width="100%" data-bezier="${b ? b.join(',') : ''}">
      <rect x="${sx(0)}" y="${sy(1)}" width="${sx(1) - sx(0)}" height="${sy(0) - sy(1)}" class="ce-box"/>
      <text x="${sx(0) + 3}" y="${sy(1) + 11}" class="ce-label">next key</text>
      <text x="${sx(0) + 3}" y="${sy(0) - 4}" class="ce-label">this key</text>
      <path d="${path}" class="ce-curve"/>
      ${handles}
    </svg>
    <p class="hint">${b ? 'Drag the handles to shape the curve.' : current ? 'This ease has no handles; pick Custom curve to draw your own.' : 'The selected keys use different eases.'}</p>`;
}

export function bindCurveEditor(host: HTMLElement, getCurrent: () => Ease | null, h: CurveHandlers) {
  host.addEventListener('change', (e) => {
    const sel = e.target as HTMLSelectElement;
    if (!sel.matches('.ce-select') || !sel.value) return;
    const cur = getCurrent();
    const start = (cur && (parseBezier(cur) ?? AS_BEZIER[cur])) || [0.42, 0, 0.58, 1];
    h.change(sel.value === 'custom' ? bezierEase(...start) : (sel.value as Ease), false);
  });
  host.addEventListener('pointerdown', (e) => {
    const dot = (e.target as Element).closest<SVGCircleElement>('.ce-handle');
    const svg = dot?.ownerSVGElement;
    if (!dot || !svg) return;
    e.preventDefault();
    const which = dot.dataset.h === '1' ? 0 : 2;
    let b = svg.dataset.bezier!.split(',').map(Number) as [number, number, number, number];
    const toCurve = (ev: PointerEvent) => {
      // live changes redraw the graph, so measure whichever one is on screen now
      const r = (host.querySelector('svg.ce-graph') ?? svg).getBoundingClientRect();
      const x = ((ev.clientX - r.left) / r.width) * W;
      const y = ((ev.clientY - r.top) / r.height) * H;
      const cx = Math.max(0, Math.min(1, (x - PADX) / (W - PADX * 2)));
      const cy = Math.max(LO, Math.min(HI, LO + ((H - y) / H) * (HI - LO)));
      return [cx, cy];
    };
    let moved = false;
    const move = (ev: PointerEvent) => {
      const [cx, cy] = toCurve(ev);
      b = [...b] as typeof b;
      b[which] = cx;
      b[which + 1] = cy;
      moved = true;
      h.change(bezierEase(...b), true);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) h.change(bezierEase(...b), false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
}
