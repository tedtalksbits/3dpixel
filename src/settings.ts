import { openColorPicker, closeColorPicker } from './colorPicker';
import { getSecret, setSecret, secretStore } from './secrets';
import { KEY_NAME, KEY_URL, getBalance, balanceText } from './pixellab';

// Per-browser preferences. Stored in localStorage; the app still works if storage is blocked.

export interface Settings {
  bg3dMode: 'gradient' | 'solid';
  bg3d: string;
  floorGrid3d: boolean;
  checkerA: string;
  checkerB: string;
  showGrid: boolean;
  gridColor: string;
  gridOpacity: number;
  selectionColor: string;
  accent: string;
  uiScale: number;
  newSize: number;
  pngSize: number;
}

export const DEFAULTS: Settings = {
  bg3dMode: 'gradient',
  bg3d: '#808890',
  floorGrid3d: true,
  checkerA: '#F4F6F8',
  checkerB: '#E8ECF0',
  showGrid: true,
  gridColor: '#000000',
  gridOpacity: 0.08,
  selectionColor: '#4F9CF0',
  accent: '#4F9CF0',
  uiScale: 13,
  newSize: 16,
  pngSize: 64,
};

const KEY = '3dpixel.settings';

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings: Settings = load();
const listeners: ((s: Settings) => void)[] = [];

export function onSettingsChange(fn: (s: Settings) => void) {
  listeners.push(fn);
}

export function updateSettings(patch: Partial<Settings>) {
  Object.assign(settings, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {}
  applyCss();
  listeners.forEach((fn) => fn(settings));
}

function applyCss() {
  const r = document.documentElement.style;
  r.setProperty('--accent', settings.accent);
  r.setProperty('--canvas', settings.checkerA);
  r.setProperty('--canvas-alt', settings.checkerB);
  r.setProperty('--selection', settings.selectionColor);
  r.fontSize = `${settings.uiScale}px`;
  document.documentElement.style.setProperty('font-size', `${settings.uiScale}px`);
}
applyCss();

// ---------- dialog ----------

type Field =
  | { key: keyof Settings; label: string; type: 'color' }
  | { key: keyof Settings; label: string; type: 'toggle' }
  | { key: keyof Settings; label: string; type: 'range'; min: number; max: number; step: number; format?: (v: number) => string }
  | { key: keyof Settings; label: string; type: 'select'; options: [string, string][] };

const SECTIONS: { title: string; fields: Field[] }[] = [
  {
    title: '3D view',
    fields: [
      { key: 'bg3dMode', label: 'Background', type: 'select', options: [['gradient', 'Dark gradient'], ['solid', 'Solid colour']] },
      { key: 'bg3d', label: 'Background colour', type: 'color' },
      { key: 'floorGrid3d', label: 'Floor grid', type: 'toggle' },
    ],
  },
  {
    title: 'Canvas',
    fields: [
      { key: 'checkerA', label: 'Checker light', type: 'color' },
      { key: 'checkerB', label: 'Checker dark', type: 'color' },
      { key: 'showGrid', label: 'Grid lines', type: 'toggle' },
      { key: 'gridColor', label: 'Grid colour', type: 'color' },
      { key: 'gridOpacity', label: 'Grid opacity', type: 'range', min: 0, max: 0.6, step: 0.02, format: (v) => `${Math.round(v * 100)}%` },
      { key: 'selectionColor', label: 'Selection colour', type: 'color' },
    ],
  },
  {
    title: 'Interface',
    fields: [
      { key: 'accent', label: 'Accent colour', type: 'color' },
      { key: 'uiScale', label: 'Text size', type: 'range', min: 11, max: 17, step: 1, format: (v) => `${v}px` },
    ],
  },
  {
    title: 'Defaults',
    fields: [
      { key: 'newSize', label: 'New project size', type: 'select', options: ['8', '16', '24', '32', '48', '64'].map((n) => [n, `${n}×${n}`]) },
      { key: 'pngSize', label: 'PNG export size', type: 'range', min: 16, max: 512, step: 16, format: (v) => `${v}px` },
    ],
  },
];

// ---------- PixelLab key ----------

/** Fired on window when the PixelLab key is saved or removed. */
export const KEY_EVENT = 'pixellab-key';

function pixelLabSection(key: string | null) {
  const masked = key ? `•••• ${key.slice(-4)}` : '';
  return `<section><h2>PixelLab</h2>
    <p class="hint">An API key lets you generate sprites and auto-rig characters with <a href="${KEY_URL}" target="_blank" rel="noopener">PixelLab</a>. It is kept in ${secretStore} and sent only to api.pixellab.ai.</p>
    ${
      key
        ? `<div class="setting"><span>API key</span><span class="control"><span class="mono">${masked}</span><button data-act="pl-check">Check balance</button><button data-act="pl-remove">Remove</button></span></div>`
        : `<div class="setting"><span>API key</span><span class="control"><input type="password" id="pl-key" placeholder="Paste your key" autocomplete="off" spellcheck="false" /><button data-act="pl-save">Save</button></span></div>`
    }
    <p class="hint" id="pl-status"></p></section>`;
}

export async function openSettings() {
  let key: string | null = null;
  try {
    key = await getSecret(KEY_NAME);
  } catch {}
  let dlg = document.getElementById('settings-dialog') as HTMLDialogElement | null;
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'settings-dialog';
    dlg.className = 'dialog';
    document.body.appendChild(dlg);
    dlg.addEventListener('close', closeColorPicker);
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) dlg!.close(); // click on the backdrop
    });
  }
  const render = () => {
    dlg!.innerHTML = `
      <header><h1>Settings</h1><button class="icon" data-act="close" title="Close (Esc)">✕</button></header>
      <div class="dialog-body">
        ${SECTIONS.map(
          (sec) => `<section><h2>${sec.title}</h2>${sec.fields
            .map((f) => {
              const v = settings[f.key];
              let control = '';
              if (f.type === 'color') control = `<button class="color-btn" data-key="${f.key}"><span style="background:${v}"></span>${v}</button>`;
              else if (f.type === 'toggle') control = `<input type="checkbox" data-key="${f.key}" ${v ? 'checked' : ''} />`;
              else if (f.type === 'range')
                control = `<input type="range" data-key="${f.key}" min="${f.min}" max="${f.max}" step="${f.step}" value="${v}" /><span class="mono val">${f.format ? f.format(v as number) : v}</span>`;
              else control = `<select data-key="${f.key}">${f.options.map(([val, l]) => `<option value="${val}" ${String(v) === val ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
              const disabled = f.key === 'bg3d' && settings.bg3dMode !== 'solid' ? ' disabled' : '';
              return `<div class="setting${disabled}"><span>${f.label}</span><span class="control">${control}</span></div>`;
            })
            .join('')}</section>`,
        ).join('')}
        ${pixelLabSection(key)}
      </div>
      <footer><button data-act="reset">Reset to defaults</button><button data-act="close" class="primary">Done</button></footer>`;
  };
  render();

  dlg.onclick = (e) => {
    const t = e.target as HTMLElement;
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'close') dlg!.close();
    const status = (msg: string) => {
      const el = dlg!.querySelector('#pl-status');
      if (el) el.textContent = msg;
    };
    if (act === 'pl-save') {
      const v = (dlg!.querySelector('#pl-key') as HTMLInputElement).value.trim();
      if (!v) return status('Paste your key first.');
      setSecret(KEY_NAME, v).then(
        async () => {
          key = v;
          window.dispatchEvent(new Event(KEY_EVENT));
          render();
          status('Saved. Checking it…');
          getBalance().then((b) => status(`Key works: ${balanceText(b)}.`), (err) => status(err.message));
        },
        (err) => status(String(err?.message ?? err)),
      );
    }
    if (act === 'pl-check') {
      status('Checking…');
      getBalance().then((b) => status(balanceText(b)), (err) => status(err.message));
    }
    if (act === 'pl-remove') {
      setSecret(KEY_NAME, null).then(() => {
        key = null;
        window.dispatchEvent(new Event(KEY_EVENT));
        render();
        status('Key removed.');
      }, (err) => status(String(err?.message ?? err)));
    }
    if (act === 'reset' && confirm('Reset all settings to their defaults?')) {
      updateSettings({ ...DEFAULTS });
      render();
    }
    const colorBtn = t.closest<HTMLElement>('.color-btn');
    if (colorBtn) {
      const key = colorBtn.dataset.key as keyof Settings;
      openColorPicker(colorBtn, settings[key] as string, {
        onChange: (hex) => {
          updateSettings({ [key]: hex } as Partial<Settings>);
          colorBtn.innerHTML = `<span style="background:${hex}"></span>${hex}`;
        },
      });
    }
  };
  dlg.onkeydown = (e) => {
    if (e.key === 'Enter' && (e.target as HTMLElement).id === 'pl-key') (dlg!.querySelector('[data-act=pl-save]') as HTMLElement).click();
  };
  dlg.oninput = (e) => {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    const key = t.dataset.key as keyof Settings | undefined;
    if (!key) return;
    const field = SECTIONS.flatMap((s) => s.fields).find((f) => f.key === key)!;
    let value: unknown = t.value;
    if (field.type === 'toggle') value = (t as HTMLInputElement).checked;
    else if (field.type === 'range' || typeof DEFAULTS[key] === 'number') value = +t.value;
    updateSettings({ [key]: value } as Partial<Settings>);
    if (field.type === 'range') {
      const out = t.parentElement!.querySelector('.val');
      if (out) out.textContent = field.format ? field.format(value as number) : String(value);
    }
    if (key === 'bg3dMode') render();
  };
  dlg.showModal();
}
