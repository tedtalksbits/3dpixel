// Popover colour picker: saturation/value area, hue strip, hex and RGB fields,
// recent colours and (where the browser supports it) a screen eyedropper.

type RGB = [number, number, number];

export const hexToRgb = (hex: string): RGB => {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const rgbToHex = ([r, g, b]: RGB) =>
  '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();

function rgbToHsv([r, g, b]: RGB): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max];
}

function hsvToRgb(h: number, s: number, v: number): RGB {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255;
  };
  return [f(5), f(3), f(1)];
}

const RECENT_KEY = '3dpixel.recentColors';
function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  } catch {
    return [];
  }
}
function pushRecent(hex: string) {
  const list = [hex, ...loadRecent().filter((c) => c !== hex)].slice(0, 16);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {}
}

export interface PickerOptions {
  title?: string;
  onChange: (hex: string) => void;
  /** Called once when the popover closes, with the starting and final colour. */
  onClose?: (initial: string, final: string) => void;
}

let open: { close: () => void } | null = null;

export function closeColorPicker() {
  open?.close();
}

export function openColorPicker(anchor: HTMLElement, initial: string, opts: PickerOptions) {
  closeColorPicker();
  let [h, s, v] = rgbToHsv(hexToRgb(initial));
  let current = initial.toUpperCase();

  const el = document.createElement('div');
  el.className = 'picker';
  el.innerHTML = `
    ${opts.title ? `<div class="picker-title">${opts.title}</div>` : ''}
    <div class="picker-sv"><canvas width="216" height="150"></canvas><span class="picker-knob"></span></div>
    <div class="picker-hue"><canvas width="216" height="14"></canvas><span class="picker-knob hue"></span></div>
    <div class="picker-row">
      <span class="picker-swatch"><span class="picker-old" title="Original — click to restore"></span><span class="picker-new"></span></span>
      <input class="picker-hex mono" maxlength="7" spellcheck="false" />
      ${'EyeDropper' in window ? '<button class="picker-eyedrop" title="Pick a colour from the screen">Pick</button>' : ''}
    </div>
    <div class="picker-rgb">
      <label>R<input type="number" min="0" max="255" data-ch="0" /></label>
      <label>G<input type="number" min="0" max="255" data-ch="1" /></label>
      <label>B<input type="number" min="0" max="255" data-ch="2" /></label>
    </div>
    <div class="picker-recent-label">Recent</div>
    <div class="picker-recent"></div>`;
  document.body.appendChild(el);

  const sv = el.querySelector<HTMLCanvasElement>('.picker-sv canvas')!;
  const hue = el.querySelector<HTMLCanvasElement>('.picker-hue canvas')!;
  const svKnob = el.querySelector<HTMLElement>('.picker-sv .picker-knob')!;
  const hueKnob = el.querySelector<HTMLElement>('.picker-hue .picker-knob')!;
  const hexIn = el.querySelector<HTMLInputElement>('.picker-hex')!;
  const rgbIn = [...el.querySelectorAll<HTMLInputElement>('.picker-rgb input')];
  el.querySelector<HTMLElement>('.picker-old')!.style.background = initial;

  const hctx = hue.getContext('2d')!;
  const hg = hctx.createLinearGradient(0, 0, hue.width, 0);
  for (let i = 0; i <= 6; i++) hg.addColorStop(i / 6, `hsl(${i * 60},100%,50%)`);
  hctx.fillStyle = hg;
  hctx.fillRect(0, 0, hue.width, hue.height);

  function drawSv() {
    const c = sv.getContext('2d')!;
    c.fillStyle = `hsl(${h},100%,50%)`;
    c.fillRect(0, 0, sv.width, sv.height);
    const white = c.createLinearGradient(0, 0, sv.width, 0);
    white.addColorStop(0, '#fff');
    white.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = white;
    c.fillRect(0, 0, sv.width, sv.height);
    const black = c.createLinearGradient(0, 0, 0, sv.height);
    black.addColorStop(0, 'rgba(0,0,0,0)');
    black.addColorStop(1, '#000');
    c.fillStyle = black;
    c.fillRect(0, 0, sv.width, sv.height);
  }

  function sync(from: 'hsv' | 'hex' | 'rgb' | 'init', emit = true) {
    const rgb = hsvToRgb(h, s, v);
    current = rgbToHex(rgb);
    if (from !== 'hex') hexIn.value = current;
    if (from !== 'rgb') rgbIn.forEach((inp, i) => (inp.value = String(Math.round(rgb[i]))));
    svKnob.style.left = `${s * 100}%`;
    svKnob.style.top = `${(1 - v) * 100}%`;
    svKnob.style.background = current;
    hueKnob.style.left = `${(h / 360) * 100}%`;
    el.querySelector<HTMLElement>('.picker-new')!.style.background = current;
    if (emit) opts.onChange(current);
  }

  function setHex(hex: string, from: 'hex' | 'hsv' = 'hsv') {
    [h, s, v] = rgbToHsv(hexToRgb(hex));
    drawSv();
    sync(from);
  }

  function drag(target: HTMLElement, onMove: (fx: number, fy: number) => void) {
    target.addEventListener('pointerdown', (e) => {
      target.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        const r = target.getBoundingClientRect();
        onMove(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)));
      };
      move(e);
      target.onpointermove = move;
      target.onpointerup = () => (target.onpointermove = null);
    });
  }
  drag(sv.parentElement!, (fx, fy) => {
    s = fx;
    v = 1 - fy;
    sync('hsv');
  });
  drag(hue.parentElement!, (fx) => {
    h = Math.min(359.9, fx * 360);
    drawSv();
    sync('hsv');
  });

  hexIn.addEventListener('input', () => {
    const t = hexIn.value.trim().replace(/^#?/, '#');
    if (/^#[0-9a-f]{6}$/i.test(t)) setHex(t, 'hex');
    else if (/^#[0-9a-f]{3}$/i.test(t)) setHex('#' + [...t.slice(1)].map((c) => c + c).join(''), 'hex');
  });
  rgbIn.forEach((inp) =>
    inp.addEventListener('input', () => {
      const rgb = rgbIn.map((i) => Math.max(0, Math.min(255, +i.value || 0))) as RGB;
      [h, s, v] = rgbToHsv(rgb);
      drawSv();
      sync('rgb');
    }),
  );
  el.querySelector('.picker-old')!.addEventListener('click', () => setHex(initial));
  el.querySelector('.picker-eyedrop')?.addEventListener('click', async () => {
    try {
      const res = await new (window as any).EyeDropper().open();
      setHex(res.sRGBHex);
    } catch {}
  });

  const recent = el.querySelector<HTMLElement>('.picker-recent')!;
  const recentList = loadRecent();
  recent.innerHTML = recentList.length
    ? recentList.map((c) => `<button style="background:${c}" data-c="${c}" title="${c}"></button>`).join('')
    : '<span class="hint">Colours you pick show up here.</span>';
  recent.addEventListener('click', (e) => {
    const c = (e.target as HTMLElement).dataset.c;
    if (c) setHex(c);
  });

  // position under the anchor, kept inside the window
  const r = anchor.getBoundingClientRect();
  const pw = el.offsetWidth;
  const ph = el.offsetHeight;
  let left = r.left;
  let top = r.bottom + 6;
  if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
  if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
  el.style.left = `${Math.max(8, left)}px`;
  el.style.top = `${top}px`;

  const outside = (e: PointerEvent) => {
    if (!el.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' || (e.key === 'Enter' && e.target === hexIn)) {
      e.stopPropagation();
      close();
    }
  };
  function close() {
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', onKey, true);
    el.remove();
    open = null;
    if (current !== initial.toUpperCase()) pushRecent(current);
    opts.onClose?.(initial, current);
  }
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
  document.addEventListener('keydown', onKey, true);
  open = { close };

  drawSv();
  sync('init', false);
  hexIn.focus();
  hexIn.select();
}
