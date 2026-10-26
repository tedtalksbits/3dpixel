import './style.css';
import { Project, Tile, newProject, getTile, readKenshape, writeKenshape, cloneProject } from './kenshape';
import { SHAPES } from './shapes';
import { TILE, exportSvg, exportPng, tilePath, SvgGrouping } from './svgExport';
import { importSvg, PaletteMode } from './svgImport';

type Tool = 'draw' | 'erase' | 'pick' | 'fill';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const state = {
  project: newProject(16),
  tool: 'draw' as Tool,
  shape: 0,
  angle: 0,
  color: 12,
  depth: 1,
  showDepth: false,
  hover: null as { x: number; y: number } | null,
  undo: [] as Project[],
  redo: [] as Project[],
  fileHandle: null as any,
  fileName: '',
  dirty: false,
};

// ---------- history ----------

function checkpoint() {
  state.undo.push(cloneProject(state.project));
  if (state.undo.length > 200) state.undo.shift();
  state.redo = [];
  state.dirty = true;
}

function undo() {
  const prev = state.undo.pop();
  if (!prev) return;
  state.redo.push(state.project);
  state.project = prev;
  renderAll();
}

function redo() {
  const next = state.redo.pop();
  if (!next) return;
  state.undo.push(state.project);
  state.project = next;
  renderAll();
}

function setProject(p: Project, fileName = '', handle: any = null) {
  state.project = p;
  state.undo = [];
  state.redo = [];
  state.fileName = fileName;
  state.fileHandle = handle;
  state.dirty = false;
  if (state.color >= p.colors.length) state.color = 0;
  renderAll();
}

// ---------- editing ----------

function paint(x: number, y: number) {
  const t = getTile(state.project, x, y);
  if (state.tool === 'erase') {
    t.color = -1;
  } else {
    Object.assign(t, { shape: state.shape, angle: state.angle, color: state.color, depth: state.depth });
  }
}

function pick(x: number, y: number) {
  const t = getTile(state.project, x, y);
  if (t.color < 0) return;
  Object.assign(state, { shape: t.shape, angle: t.angle, color: t.color, depth: t.depth, tool: 'draw' });
  renderPanels();
}

function sameTile(a: Tile, b: Tile) {
  if (a.color < 0 && b.color < 0) return true;
  return a.color === b.color && a.shape === b.shape && a.angle === b.angle;
}

function floodFill(x: number, y: number) {
  const p = state.project;
  const start = { ...getTile(p, x, y) };
  const stack = [[x, y]];
  const seen = new Set<number>();
  while (stack.length) {
    const [cx, cy] = stack.pop()!;
    if (cx < 0 || cy < 0 || cx >= p.size.x || cy >= p.size.y) continue;
    const key = cx * p.size.y + cy;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!sameTile(getTile(p, cx, cy), start)) continue;
    paint(cx, cy);
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
}

// ---------- canvas ----------

const canvas = $('canvas');
let tilePx = 32;

function fitScale() {
  const wrap = $('canvas-wrap');
  const { x, y } = state.project.size;
  const avail = Math.min((wrap.clientWidth - 48) / x, (wrap.clientHeight - 48) / y);
  tilePx = Math.max(6, Math.min(48, Math.floor(avail)));
}

function renderCanvas() {
  const p = state.project;
  const vw = p.size.x * TILE;
  const vh = p.size.y * TILE;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${p.size.x * tilePx}" height="${p.size.y * tilePx}" viewBox="0 0 ${vw} ${vh}">`;
  s += `<defs><pattern id="chk" width="64" height="64" patternUnits="userSpaceOnUse">
    <rect width="64" height="64" fill="var(--canvas)"/><rect width="32" height="32" fill="var(--canvas-alt)"/>
    <rect x="32" y="32" width="32" height="32" fill="var(--canvas-alt)"/></pattern></defs>`;
  s += `<rect width="${vw}" height="${vh}" fill="url(#chk)"/>`;
  for (let x = 0; x < p.size.x; x++) {
    for (let y = 0; y < p.size.y; y++) {
      const t = getTile(p, x, y);
      if (t.color < 0) continue;
      s += `<path fill="${p.colors[t.color]}" d="${tilePath(x, y, t.shape, t.angle)}"/>`;
    }
  }
  let grid = '';
  for (let x = 1; x < p.size.x; x++) grid += `M ${x * TILE} 0 V ${vh} `;
  for (let y = 1; y < p.size.y; y++) grid += `M 0 ${y * TILE} H ${vw} `;
  s += `<path d="${grid}" stroke="#000" stroke-opacity="0.08" stroke-width="${32 / tilePx}" fill="none"/>`;
  if (state.showDepth) {
    for (let x = 0; x < p.size.x; x++)
      for (let y = 0; y < p.size.y; y++) {
        const t = getTile(p, x, y);
        if (t.color >= 0)
          s += `<text x="${x * TILE + 16}" y="${y * TILE + 21}" font-size="14" text-anchor="middle" fill="#fff" stroke="#000" stroke-width="3" paint-order="stroke" font-family="monospace">${t.depth}</text>`;
      }
  }
  const h = state.hover;
  if (h) {
    if (state.tool === 'draw' || state.tool === 'fill') {
      s += `<path fill="${p.colors[state.color]}" fill-opacity="0.55" d="${tilePath(h.x, h.y, state.shape, state.angle)}"/>`;
    }
    s += `<rect x="${h.x * TILE}" y="${h.y * TILE}" width="${TILE}" height="${TILE}" fill="none" stroke="${state.tool === 'erase' ? '#e5484d' : '#4f9cf0'}" stroke-width="${64 / tilePx}"/>`;
  }
  canvas.innerHTML = s + '</svg>';
}

function tileAt(e: PointerEvent) {
  const r = canvas.getBoundingClientRect();
  const x = Math.floor(((e.clientX - r.left) / r.width) * state.project.size.x);
  const y = Math.floor(((e.clientY - r.top) / r.height) * state.project.size.y);
  if (x < 0 || y < 0 || x >= state.project.size.x || y >= state.project.size.y) return null;
  return { x, y };
}

let stroke: { button: number; last: { x: number; y: number } | null } | null = null;
let toolBeforeStroke: Tool = 'draw';

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  const t = tileAt(e);
  if (!t) return;
  canvas.setPointerCapture(e.pointerId);
  toolBeforeStroke = state.tool;
  if (e.button === 2) state.tool = 'erase';
  else if (e.altKey) state.tool = 'pick';
  if (state.tool === 'pick') {
    pick(t.x, t.y);
    state.tool = state.tool === 'pick' ? toolBeforeStroke : state.tool;
    renderAll();
    return;
  }
  checkpoint();
  if (state.tool === 'fill') {
    floodFill(t.x, t.y);
    state.tool = toolBeforeStroke;
    renderAll();
    return;
  }
  stroke = { button: e.button, last: null };
  applyStroke(t);
});
canvas.addEventListener('pointermove', (e) => {
  const t = tileAt(e);
  const changed = (t?.x ?? -1) !== (state.hover?.x ?? -1) || (t?.y ?? -1) !== (state.hover?.y ?? -1);
  state.hover = t;
  if (stroke && t) applyStroke(t);
  else if (changed) renderCanvas();
});
canvas.addEventListener('pointerleave', () => {
  state.hover = null;
  renderCanvas();
});
const endStroke = () => {
  if (!stroke) return;
  stroke = null;
  state.tool = toolBeforeStroke;
  renderAll();
};
canvas.addEventListener('pointerup', endStroke);
canvas.addEventListener('pointercancel', endStroke);

function applyStroke(t: { x: number; y: number }) {
  const last = stroke!.last;
  if (last && last.x === t.x && last.y === t.y) return;
  // pointer events are sparse on fast drags, so walk the line from the previous tile
  const from = last ?? t;
  const steps = Math.max(Math.abs(t.x - from.x), Math.abs(t.y - from.y));
  for (let i = last ? 1 : 0; i <= steps; i++) {
    const k = steps ? i / steps : 0;
    paint(Math.round(from.x + (t.x - from.x) * k), Math.round(from.y + (t.y - from.y) * k));
  }
  stroke!.last = t;
  renderCanvas();
}

// ---------- panels ----------

const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: 'draw', label: 'Draw', key: 'B' },
  { id: 'erase', label: 'Erase', key: 'E' },
  { id: 'fill', label: 'Fill', key: 'G' },
  { id: 'pick', label: 'Pick', key: 'I' },
];

function shapeIcon(shape: number, angle: number) {
  return `<svg viewBox="-2 -2 36 36"><path d="${tilePath(0, 0, shape, angle)}"/></svg>`;
}

function renderPanels() {
  $('tools').innerHTML = TOOLS.map(
    (t) => `<button data-tool="${t.id}" class="${state.tool === t.id ? 'active' : ''}" title="${t.label} (${t.key})">${t.label}</button>`,
  ).join('');
  $('shapes').innerHTML = SHAPES.map(
    (s, i) => `<button data-shape="${i}" class="${state.shape === i ? 'active' : ''}" title="${s.name}">${shapeIcon(i, state.angle)}</button>`,
  ).join('');
  $('angle-label').textContent = `${state.angle * 90}°`;
  $('palette').innerHTML = state.project.colors
    .map((c, i) => `<button class="swatch ${state.color === i ? 'active' : ''}" data-color="${i}" style="background:${c}" title="${c}"></button>`)
    .join('');
  $<HTMLInputElement>('depth').value = String(state.depth);
  $('depth-label').textContent = String(state.depth);
  $<HTMLInputElement>('title').value = state.project.title;
  $<HTMLButtonElement>('btn-undo').disabled = !state.undo.length;
  $<HTMLButtonElement>('btn-redo').disabled = !state.redo.length;
  const { x, y } = state.project.size;
  $('status').textContent = `${state.fileName || 'unsaved'}${state.dirty ? ' •' : ''} · ${x}×${y}`;
}

let previewTimer = 0;
let previewUrls: string[] = [];
function renderPreview() {
  clearTimeout(previewTimer);
  previewTimer = window.setTimeout(async () => {
    const size = pngSize();
    const crisp = $<HTMLInputElement>('png-crisp').checked;
    const [small, large] = await Promise.all([exportPng(state.project, size, size, { crisp }), exportPng(state.project, 256, 256)]);
    previewUrls.forEach(URL.revokeObjectURL);
    previewUrls = [URL.createObjectURL(small), URL.createObjectURL(large)];
    const img = $<HTMLImageElement>('preview-small');
    img.src = previewUrls[0];
    img.width = Math.min(size, 128);
    img.height = Math.min(size, 128);
    $<HTMLImageElement>('preview-large').src = previewUrls[1];
  }, 120);
}

function renderAll() {
  fitScale();
  renderCanvas();
  renderPanels();
  renderPreview();
}

$('tools').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (b?.dataset.tool) {
    state.tool = b.dataset.tool as Tool;
    renderPanels();
  }
});
$('shapes').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (b?.dataset.shape) {
    state.shape = +b.dataset.shape;
    if (state.tool !== 'fill') state.tool = 'draw';
    renderPanels();
  }
});

const rotate = (d: number) => {
  state.angle = (state.angle + d + 4) % 4;
  renderPanels();
  renderCanvas();
};
$('rot-cw').addEventListener('click', () => rotate(1));
$('rot-ccw').addEventListener('click', () => rotate(-1));

const colorEdit = $<HTMLInputElement>('color-edit');
$('palette').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('.swatch');
  if (!b) return;
  state.color = +b.dataset.color!;
  if (state.tool === 'erase' || state.tool === 'pick') state.tool = 'draw';
  renderPanels();
});
$('palette').addEventListener('dblclick', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('.swatch');
  if (!b) return;
  colorEdit.value = state.project.colors[+b.dataset.color!].toLowerCase();
  colorEdit.dataset.index = b.dataset.color;
  colorEdit.click();
});
colorEdit.addEventListener('focus', () => checkpoint());
colorEdit.addEventListener('input', () => {
  state.project.colors[+colorEdit.dataset.index!] = colorEdit.value.toUpperCase();
  renderAll();
});

$<HTMLInputElement>('depth').addEventListener('input', (e) => {
  state.depth = +(e.target as HTMLInputElement).value;
  $('depth-label').textContent = String(state.depth);
});
$<HTMLInputElement>('show-depth').addEventListener('change', (e) => {
  state.showDepth = (e.target as HTMLInputElement).checked;
  renderCanvas();
});
$<HTMLInputElement>('title').addEventListener('change', (e) => {
  checkpoint();
  state.project.title = (e.target as HTMLInputElement).value.trim() || 'Untitled';
  renderPanels();
});

// ---------- files ----------

const w = window as any;
const hasFsApi = typeof w.showSaveFilePicker === 'function';

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const safeName = () => state.project.title.replace(/[^\w\- ]+/g, '').trim() || 'shape';

async function saveBlob(blob: Blob, suggested: string, ext: string, desc: string, mime: string, handle?: any) {
  if (!hasFsApi) {
    download(blob, suggested);
    return { name: suggested, handle: null };
  }
  try {
    const h =
      handle ??
      (await w.showSaveFilePicker({ suggestedName: suggested, types: [{ description: desc, accept: { [mime]: [ext] } }] }));
    const ws = await h.createWritable();
    await ws.write(blob);
    await ws.close();
    return { name: h.name as string, handle: h };
  } catch (err: any) {
    if (err?.name === 'AbortError') return null;
    throw err;
  }
}

async function save(as = false) {
  const blob = await writeKenshape(state.project);
  const res = await saveBlob(blob, `${safeName()}.kenshape`, '.kenshape', 'Kenney Shape project', 'application/octet-stream', as ? undefined : state.fileHandle ?? undefined);
  if (!res) return;
  state.fileName = res.name;
  state.fileHandle = res.handle;
  state.dirty = false;
  flash(`Saved ${res.name}`);
  renderPanels();
}

async function openFile(file: File, handle: any = null) {
  try {
    if (file.name.toLowerCase().endsWith('.svg')) {
      await doImportSvg(await file.text(), file.name);
    } else {
      setProject(await readKenshape(await file.arrayBuffer()), file.name, handle);
      flash(`Opened ${file.name}`);
    }
  } catch (err: any) {
    flash(`Could not open ${file.name}: ${err?.message ?? err}`, true);
  }
}

async function doImportSvg(text: string, name: string) {
  const gridSel = $<HTMLSelectElement>('import-grid').value;
  const n = gridSel === 'current' ? null : +gridSel;
  const res = await importSvg(text, {
    gridX: n ?? state.project.size.x,
    gridY: n ?? state.project.size.y,
    paletteMode: $<HTMLSelectElement>('import-palette').value as PaletteMode,
    palette: state.project.colors,
  });
  res.project.title = name.replace(/\.svg$/i, '');
  const prev = state.project;
  setProject(res.project, '');
  state.undo = [prev];
  state.dirty = true;
  renderAll();
  flash(res.notes.join(' '));
}

async function pickOpen(accept: 'any' | 'svg') {
  if (typeof w.showOpenFilePicker === 'function') {
    try {
      const types =
        accept === 'svg'
          ? [{ description: 'SVG image', accept: { 'image/svg+xml': ['.svg'] } }]
          : [
              { description: 'Kenney Shape project or SVG', accept: { 'application/octet-stream': ['.kenshape'], 'image/svg+xml': ['.svg'] } },
            ];
      const [h] = await w.showOpenFilePicker({ types });
      await openFile(await h.getFile(), h);
    } catch (err: any) {
      if (err?.name !== 'AbortError') flash(String(err?.message ?? err), true);
    }
    return;
  }
  const input = $<HTMLInputElement>('file-input');
  input.accept = accept === 'svg' ? '.svg' : '.kenshape,.svg';
  input.click();
}

$<HTMLInputElement>('file-input').addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  if (f) openFile(f);
  input.value = '';
});

$('btn-new').addEventListener('click', () => {
  if (state.dirty && !confirm('Discard unsaved changes?')) return;
  const n = +$<HTMLSelectElement>('new-size').value;
  const p = newProject(n);
  p.colors = [...state.project.colors];
  setProject(p);
});
$('btn-open').addEventListener('click', () => {
  if (state.dirty && !confirm('Discard unsaved changes?')) return;
  pickOpen('any');
});
$('btn-save').addEventListener('click', () => save());
$('btn-save-as').addEventListener('click', () => save(true));
$('btn-undo').addEventListener('click', undo);
$('btn-redo').addEventListener('click', redo);
$('btn-import-svg').addEventListener('click', () => pickOpen('svg'));

const pngSize = () => Math.max(1, Math.min(4096, Math.round(+$<HTMLInputElement>('png-size').value || 64)));
$('png-size').addEventListener('input', renderPreview);
$('png-crisp').addEventListener('change', renderPreview);

$('btn-export-svg').addEventListener('click', async () => {
  const grouping = $<HTMLSelectElement>('svg-grouping').value as SvgGrouping;
  const svg = exportSvg(state.project, { grouping, width: state.project.size.x * 16, height: state.project.size.y * 16 });
  const res = await saveBlob(new Blob([svg], { type: 'image/svg+xml' }), `${safeName()}.svg`, '.svg', 'SVG image', 'image/svg+xml');
  if (res) flash(`Exported ${res.name}`);
});
$('btn-export-png').addEventListener('click', async () => {
  const size = pngSize();
  const blob = await exportPng(state.project, size, size, { crisp: $<HTMLInputElement>('png-crisp').checked });
  const res = await saveBlob(blob, `${safeName()}.png`, '.png', 'PNG image', 'image/png');
  if (res) flash(`Exported ${res.name} (${size}×${size})`);
});

// drag and drop
const wrap = $('canvas-wrap');
wrap.addEventListener('dragover', (e) => {
  e.preventDefault();
  wrap.classList.add('dragging');
});
wrap.addEventListener('dragleave', () => wrap.classList.remove('dragging'));
wrap.addEventListener('drop', (e) => {
  e.preventDefault();
  wrap.classList.remove('dragging');
  const f = e.dataTransfer?.files[0];
  if (f) openFile(f);
});

// ---------- keyboard ----------

window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).matches('input:not([type=range]):not([type=checkbox]), select')) return;
  const k = e.key.toLowerCase();
  if (e.ctrlKey || e.metaKey) {
    if (k === 'z' && !e.shiftKey) undo();
    else if (k === 'y' || (k === 'z' && e.shiftKey)) redo();
    else if (k === 's') save(e.shiftKey);
    else if (k === 'o') pickOpen('any');
    else return;
    e.preventDefault();
    return;
  }
  const tool = TOOLS.find((t) => t.key.toLowerCase() === k);
  if (tool) state.tool = tool.id;
  else if (k === 'r') return rotate(e.shiftKey ? -1 : 1);
  else if (k >= '1' && k <= '9') state.depth = +k;
  else if (k === '0') state.depth = 10;
  else return;
  renderPanels();
  renderCanvas();
});

let toast = 0;
function flash(msg: string, error = false) {
  const el = $('status');
  el.textContent = msg;
  el.style.color = error ? '#e5484d' : '';
  clearTimeout(toast);
  toast = window.setTimeout(() => {
    el.style.color = '';
    renderPanels();
  }, 3500);
}

window.addEventListener('beforeunload', (e) => {
  if (state.dirty) e.preventDefault();
});
window.addEventListener('resize', () => {
  fitScale();
  renderCanvas();
});

renderAll();
