import './style.css';
import { Project, Tile, newProject, getTile, readKenshape, writeKenshape, cloneProject, emptyTile, tileIndex } from './kenshape';
import { SHAPES } from './shapes';
import { TILE, exportSvg, exportPng, tilePath, SvgGrouping } from './svgExport';
import { importSvg, PaletteMode } from './svgImport';
import { Preview3D } from './preview3d';
import { exportGlb, exportObj, ModelScale, ModelPivot } from './modelExport';
import { tileDepths } from './mesh';
import { transformShape, ShapeXf } from './transform';
import { openColorPicker, hexToRgb } from './colorPicker';
import { settings, onSettingsChange, openSettings } from './settings';

type Tool = 'move' | 'select' | 'wand' | 'draw' | 'erase' | 'fill' | 'depth' | 'pick';
type DepthMode = 'set' | 'raise' | 'lower';
type DepthView = 'off' | 'numbers' | 'map';
type WandMatch = 'color' | 'colorDepth' | 'tile';

const DEPTH_MIN = 1;
const DEPTH_MAX = 20;
const PALETTE_MAX = 64;

interface FloatItem {
  x: number;
  y: number;
  tile: Tile;
}
/** Tiles lifted off the canvas by a move, paste or transform. They keep their data even when nudged past the edge. */
interface Floating {
  cells: [number, number][];
  items: FloatItem[];
  dx: number;
  dy: number;
  whole: boolean; // moving the whole drawing, so there's no selection outline to keep afterwards
}
interface Snapshot {
  project: Project;
  sel: number[];
}

const pack = (x: number, y: number) => (x + 4096) * 8192 + (y + 4096);
const unpack = (k: number): [number, number] => [Math.floor(k / 8192) - 4096, (k % 8192) - 4096];
const clampDepth = (d: number) => Math.max(DEPTH_MIN, Math.min(DEPTH_MAX, Math.round(d)));

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const state = {
  project: newProject(settings.newSize),
  tool: 'draw' as Tool,
  shape: 0,
  angle: 0,
  color: 12,
  depth: 1,
  apply: { shape: true, color: true, depth: true },
  depthMode: 'set' as DepthMode,
  depthView: 'off' as DepthView,
  depthMapWithTool: true,
  wandMatch: 'color' as WandMatch,
  wandContiguous: true,
  fillContiguous: true,
  sel: new Set<number>(),
  float: null as Floating | null,
  clipboard: null as { cells: [number, number][]; items: FloatItem[] } | null,
  hover: null as { x: number; y: number } | null,
  undo: [] as Snapshot[],
  redo: [] as Snapshot[],
  fileHandle: null as any,
  fileName: '',
  dirty: false,
};

const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < state.project.size.x && y < state.project.size.y;

// ---------- history ----------

const snapshot = (): Snapshot => ({ project: cloneProject(state.project), sel: [...state.sel] });

function checkpoint() {
  state.undo.push(snapshot());
  if (state.undo.length > 200) state.undo.shift();
  state.redo = [];
  state.dirty = true;
}

function restore(s: Snapshot) {
  state.project = s.project;
  state.sel = new Set(s.sel);
  state.float = null;
}

function undo() {
  const prev = state.undo.pop();
  if (!prev) return;
  commitFloat();
  state.redo.push(snapshot());
  restore(prev);
  renderAll();
}

function redo() {
  const next = state.redo.pop();
  if (!next) return;
  commitFloat();
  state.undo.push(snapshot());
  restore(next);
  renderAll();
}

function setProject(p: Project, fileName = '', handle: any = null) {
  state.project = p;
  state.undo = [];
  state.redo = [];
  state.sel.clear();
  state.float = null;
  state.fileName = fileName;
  state.fileHandle = handle;
  state.dirty = false;
  if (state.color >= p.colors.length) state.color = 0;
  renderAll();
}

// ---------- selection and floating tiles ----------

function selCells(): [number, number][] {
  const f = state.float;
  if (f) return f.whole ? [] : f.cells.map(([x, y]) => [x + f.dx, y + f.dy]);
  return [...state.sel].map(unpack);
}
const hasSelection = () => state.sel.size > 0 || (!!state.float && !state.float.whole);
const canPaintAt = (x: number, y: number) => inBounds(x, y) && (state.sel.size === 0 || state.sel.has(pack(x, y)));

/** Lift the selection (or the whole drawing) into a floating layer. */
function lift(whole: boolean): boolean {
  if (state.float) return true;
  const p = state.project;
  let cells: [number, number][];
  if (whole) {
    cells = [];
    for (let x = 0; x < p.size.x; x++) for (let y = 0; y < p.size.y; y++) if (getTile(p, x, y).color >= 0) cells.push([x, y]);
  } else cells = [...state.sel].map(unpack);
  const items = cells.filter(([x, y]) => inBounds(x, y) && getTile(p, x, y).color >= 0).map(([x, y]) => ({ x, y, tile: { ...getTile(p, x, y) } }));
  if (!items.length && whole) return false;
  checkpoint();
  for (const it of items) p.tiles[tileIndex(p, it.x, it.y)] = emptyTile();
  state.float = { cells, items, dx: 0, dy: 0, whole };
  return true;
}

function commitFloat() {
  const f = state.float;
  if (!f) return;
  const p = state.project;
  for (const it of f.items) {
    const x = it.x + f.dx;
    const y = it.y + f.dy;
    if (inBounds(x, y)) p.tiles[tileIndex(p, x, y)] = { ...it.tile };
  }
  state.sel = new Set(f.whole ? [] : f.cells.map(([x, y]) => [x + f.dx, y + f.dy]).filter(([x, y]) => inBounds(x, y)).map(([x, y]) => pack(x, y)));
  state.float = null;
  state.dirty = true;
}

/** The project as it currently looks, floating tiles included. */
function composite(): Project {
  const f = state.float;
  if (!f) return state.project;
  const p = { ...state.project, tiles: state.project.tiles.slice() };
  for (const it of f.items) {
    const x = it.x + f.dx;
    const y = it.y + f.dy;
    if (inBounds(x, y)) p.tiles[tileIndex(p, x, y)] = it.tile;
  }
  return p;
}

function nudge(dx: number, dy: number) {
  if (!state.float && !lift(state.sel.size === 0)) return;
  state.float!.dx += dx;
  state.float!.dy += dy;
  renderCanvas();
  renderPanels();
  renderLive();
}

function transformSelection(xf: ShapeXf) {
  if (!state.float && !lift(state.sel.size === 0)) return;
  const f = state.float!;
  const bake = ([x, y]: [number, number]): [number, number] => [x + f.dx, y + f.dy];
  f.cells = f.cells.map(bake);
  f.items.forEach((it) => ([it.x, it.y] = bake([it.x, it.y])));
  f.dx = f.dy = 0;
  const xs = (f.cells.length ? f.cells : f.items.map((i) => [i.x, i.y] as [number, number])).map((c) => c[0]);
  const ys = (f.cells.length ? f.cells : f.items.map((i) => [i.x, i.y] as [number, number])).map((c) => c[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const w = maxX - minX;
  const h = maxY - minY;
  const ox = Math.floor((w - h) / 2);
  const oy = Math.floor((h - w) / 2);
  const map = ([x, y]: [number, number]): [number, number] => {
    if (xf === 'flipX') return [minX + maxX - x, y];
    if (xf === 'flipY') return [x, minY + maxY - y];
    if (xf === 'rotCW') return [minX + ox + (maxY - y), minY + oy + (x - minX)];
    return [minX + ox + (y - minY), minY + oy + (maxX - x)];
  };
  f.cells = f.cells.map(map);
  for (const it of f.items) {
    [it.x, it.y] = map([it.x, it.y]);
    const t = transformShape(it.tile.shape, it.tile.angle, xf);
    it.tile = { ...it.tile, ...t };
  }
  renderAll();
}

function setSelection(cells: Iterable<number>, mode: 'replace' | 'add' | 'subtract') {
  if (mode === 'replace') state.sel = new Set(cells);
  else for (const c of cells) mode === 'add' ? state.sel.add(c) : state.sel.delete(c);
}

function selectAll() {
  commitFloat();
  const cells: number[] = [];
  for (let x = 0; x < state.project.size.x; x++) for (let y = 0; y < state.project.size.y; y++) cells.push(pack(x, y));
  state.sel = new Set(cells);
  renderAll();
}

function deselect() {
  commitFloat();
  state.sel.clear();
  renderAll();
}

function invertSelection() {
  commitFloat();
  const next = new Set<number>();
  for (let x = 0; x < state.project.size.x; x++) for (let y = 0; y < state.project.size.y; y++) if (!state.sel.has(pack(x, y))) next.add(pack(x, y));
  state.sel = next;
  renderAll();
}

function wandMatches(a: Tile, b: Tile) {
  if (a.color < 0 || b.color < 0) return a.color < 0 && b.color < 0;
  if (a.color !== b.color) return false;
  if (state.wandMatch === 'color') return true;
  if (a.depth !== b.depth) return false;
  return state.wandMatch === 'colorDepth' || (a.shape === b.shape && a.angle === b.angle);
}

function regionFrom(x: number, y: number, match: (t: Tile) => boolean, contiguous: boolean, limit?: Set<number>): number[] {
  const p = state.project;
  const ok = (cx: number, cy: number) => inBounds(cx, cy) && (!limit || limit.size === 0 || limit.has(pack(cx, cy))) && match(getTile(p, cx, cy));
  const out: number[] = [];
  if (!contiguous) {
    for (let cx = 0; cx < p.size.x; cx++) for (let cy = 0; cy < p.size.y; cy++) if (ok(cx, cy)) out.push(pack(cx, cy));
    return out;
  }
  const seen = new Set<number>();
  const stack: [number, number][] = [[x, y]];
  while (stack.length) {
    const [cx, cy] = stack.pop()!;
    const k = pack(cx, cy);
    if (seen.has(k)) continue;
    seen.add(k);
    if (!ok(cx, cy)) continue;
    out.push(k);
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
  return out;
}

/** Run an edit on every selected, non-empty tile. */
function editSelection(fn: (t: Tile) => void) {
  if (!hasSelection()) return;
  commitFloat();
  checkpoint();
  for (const k of state.sel) {
    const [x, y] = unpack(k);
    if (!inBounds(x, y)) continue;
    const t = getTile(state.project, x, y);
    if (t.color >= 0) fn(t);
  }
  renderAll();
}

function deleteSelection() {
  if (state.float) {
    // the lift already made an undo step, so dropping the floating tiles is enough
    const f = state.float;
    state.sel = new Set(f.whole ? [] : f.cells.map(([x, y]) => [x + f.dx, y + f.dy]).filter(([x, y]) => inBounds(x, y)).map(([x, y]) => pack(x, y)));
    state.float = null;
    renderAll();
    return;
  }
  if (!state.sel.size) return;
  checkpoint();
  for (const k of state.sel) {
    const [x, y] = unpack(k);
    if (inBounds(x, y)) state.project.tiles[tileIndex(state.project, x, y)] = emptyTile();
  }
  renderAll();
}

function copySelection(cut = false) {
  const cells = selCells();
  if (!cells.length) return;
  const p = composite();
  const items = cells.filter(([x, y]) => inBounds(x, y) && getTile(p, x, y).color >= 0).map(([x, y]) => ({ x, y, tile: { ...getTile(p, x, y) } }));
  state.clipboard = { cells, items };
  flash(`${cut ? 'Cut' : 'Copied'} ${items.length} tile${items.length === 1 ? '' : 's'}`);
  if (cut) deleteSelection();
}

function paste() {
  const clip = state.clipboard;
  if (!clip) return;
  commitFloat();
  checkpoint();
  state.sel.clear();
  state.float = {
    cells: clip.cells.map((c) => [...c] as [number, number]),
    items: clip.items.map((i) => ({ x: i.x, y: i.y, tile: { ...i.tile } })),
    dx: 0,
    dy: 0,
    whole: false,
  };
  setTool('move');
  flash('Pasted. Drag or use the arrow keys to place it, then press Enter.');
  renderAll();
}

// ---------- painting ----------

function paintTile(x: number, y: number, erase: boolean) {
  if (!canPaintAt(x, y)) return;
  const p = state.project;
  if (erase) {
    p.tiles[tileIndex(p, x, y)] = emptyTile();
    return;
  }
  const t = getTile(p, x, y);
  if (t.color < 0) {
    Object.assign(t, { shape: state.shape, angle: state.angle, color: state.color, depth: state.depth, colorBack: -1, depthBack: 0 });
    return;
  }
  if (state.apply.shape) Object.assign(t, { shape: state.shape, angle: state.angle });
  if (state.apply.color) t.color = state.color;
  if (state.apply.depth) t.depth = state.depth;
}

function depthTile(x: number, y: number, invert: boolean) {
  if (!canPaintAt(x, y)) return;
  const t = getTile(state.project, x, y);
  if (t.color < 0) return;
  let mode = state.depthMode;
  if (invert) mode = mode === 'raise' ? 'lower' : mode === 'lower' ? 'raise' : mode;
  const current = tileDepths(t.depth, 0)[0];
  if (mode === 'set') t.depth = state.depth;
  else t.depth = clampDepth(current + (mode === 'raise' ? 1 : -1));
}

function pick(x: number, y: number) {
  if (!inBounds(x, y)) return;
  const t = getTile(composite(), x, y);
  if (t.color < 0) return;
  Object.assign(state, { shape: t.shape, angle: t.angle, color: t.color, depth: clampDepth(tileDepths(t.depth, 0)[0]) });
  flash(`Picked ${SHAPES[t.shape]?.name ?? 'shape'}, ${state.project.colors[t.color]}, depth ${state.depth}`);
}

function sameTile(a: Tile, b: Tile) {
  if (a.color < 0 && b.color < 0) return true;
  return a.color === b.color && a.shape === b.shape && a.angle === b.angle;
}

function fill(x: number, y: number) {
  const start = { ...getTile(state.project, x, y) };
  for (const k of regionFrom(x, y, (t) => sameTile(t, start), state.fillContiguous, state.sel)) {
    const [cx, cy] = unpack(k);
    const t = getTile(state.project, cx, cy);
    Object.assign(t, { shape: state.shape, angle: state.angle, color: state.color, depth: state.depth });
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

const effectiveDepthView = (): DepthView => (state.tool === 'depth' && state.depthMapWithTool ? 'map' : state.depthView);

function outlinePath(cells: [number, number][]) {
  const set = new Set(cells.map(([x, y]) => pack(x, y)));
  let d = '';
  for (const [x, y] of cells) {
    const X = x * TILE;
    const Y = y * TILE;
    if (!set.has(pack(x, y - 1))) d += `M${X} ${Y}h${TILE}`;
    if (!set.has(pack(x + 1, y))) d += `M${X + TILE} ${Y}v${TILE}`;
    if (!set.has(pack(x, y + 1))) d += `M${X} ${Y + TILE}h${TILE}`;
    if (!set.has(pack(x - 1, y))) d += `M${X} ${Y}v${TILE}`;
  }
  return d;
}

let drag: any = null;

function renderCanvas() {
  const p = composite();
  const vw = p.size.x * TILE;
  const vh = p.size.y * TILE;
  const view = effectiveDepthView();
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${p.size.x * tilePx}" height="${p.size.y * tilePx}" viewBox="0 0 ${vw} ${vh}" overflow="visible">`;
  s += `<defs><pattern id="chk" width="64" height="64" patternUnits="userSpaceOnUse">
    <rect width="64" height="64" fill="var(--canvas)"/><rect width="32" height="32" fill="var(--canvas-alt)"/>
    <rect x="32" y="32" width="32" height="32" fill="var(--canvas-alt)"/></pattern>
    <clipPath id="clip"><rect width="${vw}" height="${vh}"/></clipPath></defs>`;
  s += `<rect width="${vw}" height="${vh}" fill="url(#chk)"/>`;

  let dmin = Infinity;
  let dmax = -Infinity;
  if (view === 'map') {
    for (const t of p.tiles) {
      if (t.color < 0) continue;
      const d = tileDepths(t.depth, 0)[0];
      dmin = Math.min(dmin, d);
      dmax = Math.max(dmax, d);
    }
  }
  const depthFill = (d: number) => {
    const k = dmax > dmin ? (d - dmin) / (dmax - dmin) : 0.5;
    return `hsl(212 ${18 + 30 * k}% ${22 + 62 * k}%)`;
  };

  let numbers = '';
  for (let x = 0; x < p.size.x; x++) {
    for (let y = 0; y < p.size.y; y++) {
      const t = getTile(p, x, y);
      if (t.color < 0) continue;
      const d = tileDepths(t.depth, 0)[0];
      s += `<path fill="${view === 'map' ? depthFill(d) : p.colors[t.color]}" d="${tilePath(x, y, t.shape, t.angle)}"/>`;
      if (view !== 'off' && tilePx >= 14)
        numbers += `<text x="${x * TILE + 16}" y="${y * TILE + 21}">${d}</text>`;
    }
  }
  if (settings.showGrid) {
    let grid = '';
    for (let x = 1; x < p.size.x; x++) grid += `M ${x * TILE} 0 V ${vh} `;
    for (let y = 1; y < p.size.y; y++) grid += `M 0 ${y * TILE} H ${vw} `;
    s += `<path d="${grid}" stroke="${settings.gridColor}" stroke-opacity="${settings.gridOpacity}" stroke-width="1" vector-effect="non-scaling-stroke" fill="none"/>`;
  }
  if (numbers) s += `<g class="depth-numbers">${numbers}</g>`;

  // floating tiles past the edge are drawn faintly so they're not lost from view
  const f = state.float;
  if (f) {
    for (const it of f.items) {
      const x = it.x + f.dx;
      const y = it.y + f.dy;
      if (!inBounds(x, y)) s += `<path fill="${p.colors[it.tile.color]}" fill-opacity="0.35" d="${tilePath(x, y, it.tile.shape, it.tile.angle)}"/>`;
    }
  }

  const sel = selCells();
  if (sel.length) {
    const d = outlinePath(sel);
    s += `<path d="${d}" class="ants-base" vector-effect="non-scaling-stroke"/><path d="${d}" class="ants" vector-effect="non-scaling-stroke"/>`;
  }
  if (drag?.kind === 'marquee') {
    const [x0, x1] = [Math.min(drag.x0, drag.x1), Math.max(drag.x0, drag.x1)];
    const [y0, y1] = [Math.min(drag.y0, drag.y1), Math.max(drag.y0, drag.y1)];
    s += `<rect x="${x0 * TILE}" y="${y0 * TILE}" width="${(x1 - x0 + 1) * TILE}" height="${(y1 - y0 + 1) * TILE}" class="marquee" vector-effect="non-scaling-stroke"/>`;
  }

  const h = state.hover;
  if (h && inBounds(h.x, h.y) && !drag?.kind?.match(/marquee|move/)) {
    const tool = state.tool;
    if ((tool === 'draw' || tool === 'fill') && canPaintAt(h.x, h.y)) {
      s += `<path fill="${p.colors[state.color]}" fill-opacity="0.55" d="${tilePath(h.x, h.y, state.shape, state.angle)}"/>`;
    }
    if (['draw', 'erase', 'fill', 'depth', 'pick', 'wand'].includes(tool)) {
      const color = tool === 'erase' ? '#e5484d' : 'var(--accent)';
      s += `<rect x="${h.x * TILE}" y="${h.y * TILE}" width="${TILE}" height="${TILE}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
    }
  }
  canvas.innerHTML = s + '</svg>';

  const legend = $('depth-legend');
  if (view === 'map' && isFinite(dmin)) {
    legend.classList.remove('hidden');
    legend.innerHTML = `<span>Thin ${dmin}</span><span class="ramp" style="background:linear-gradient(90deg, ${depthFill(dmin)}, ${depthFill(dmax)})"></span><span>${dmax} Thick</span>`;
  } else legend.classList.add('hidden');

  canvas.dataset.tool = state.tool;
}

function rawTile(e: PointerEvent) {
  const r = canvas.getBoundingClientRect();
  return {
    x: Math.floor(((e.clientX - r.left) / r.width) * state.project.size.x),
    y: Math.floor(((e.clientY - r.top) / r.height) * state.project.size.y),
  };
}
const clampTile = (t: { x: number; y: number }) => ({
  x: Math.max(0, Math.min(state.project.size.x - 1, t.x)),
  y: Math.max(0, Math.min(state.project.size.y - 1, t.y)),
});

function walkLine(from: { x: number; y: number } | null, to: { x: number; y: number }, fn: (x: number, y: number) => void) {
  // pointer events are sparse on fast drags, so walk the line from the previous tile
  const a = from ?? to;
  const steps = Math.max(Math.abs(to.x - a.x), Math.abs(to.y - a.y));
  for (let i = from ? 1 : 0; i <= steps; i++) {
    const k = steps ? i / steps : 0;
    fn(Math.round(a.x + (to.x - a.x) * k), Math.round(a.y + (to.y - a.y) * k));
  }
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  if (e.button === 1) return;
  const t = rawTile(e);
  canvas.setPointerCapture(e.pointerId);
  let tool = state.tool;
  if ((e.ctrlKey || e.metaKey) && hasSelection()) tool = 'move';
  else if (e.altKey && ['draw', 'erase', 'fill', 'depth'].includes(tool)) tool = 'pick';

  switch (tool) {
    case 'move': {
      if (!state.float && !lift(state.sel.size === 0)) return;
      drag = { kind: 'move', sx: t.x, sy: t.y, dx: state.float!.dx, dy: state.float!.dy };
      break;
    }
    case 'select': {
      commitFloat();
      const c = clampTile(t);
      drag = { kind: 'marquee', x0: c.x, y0: c.y, x1: c.x, y1: c.y, moved: false, mode: e.shiftKey ? 'add' : e.altKey ? 'subtract' : 'replace' };
      break;
    }
    case 'wand': {
      commitFloat();
      if (!inBounds(t.x, t.y)) return;
      const start = { ...getTile(state.project, t.x, t.y) };
      setSelection(regionFrom(t.x, t.y, (o) => wandMatches(o, start), state.wandContiguous), e.shiftKey ? 'add' : e.altKey ? 'subtract' : 'replace');
      renderAll();
      return;
    }
    case 'pick':
      pick(t.x, t.y);
      renderPanels();
      renderCanvas();
      return;
    case 'fill':
      commitFloat();
      if (!canPaintAt(t.x, t.y)) return;
      checkpoint();
      fill(t.x, t.y);
      renderAll();
      return;
    case 'depth': {
      commitFloat();
      if (!inBounds(t.x, t.y)) return;
      if (e.button === 2 && state.depthMode === 'set') {
        const tile = getTile(state.project, t.x, t.y);
        if (tile.color >= 0) {
          state.depth = clampDepth(tileDepths(tile.depth, 0)[0]);
          flash(`Depth set to ${state.depth}`);
          renderPanels();
        }
        return;
      }
      checkpoint();
      drag = { kind: 'depth', last: null, visited: new Set<number>(), invert: e.button === 2 };
      applyDrag(t);
      break;
    }
    default: {
      // draw / erase
      commitFloat();
      checkpoint();
      drag = { kind: 'paint', erase: tool === 'erase' || e.button === 2, last: null };
      applyDrag(t);
    }
  }
  renderCanvas();
});

function applyDrag(t: { x: number; y: number }) {
  if (!drag) return;
  if (drag.kind === 'paint') {
    if (drag.last && drag.last.x === t.x && drag.last.y === t.y) return;
    walkLine(drag.last, t, (x, y) => paintTile(x, y, drag.erase));
    drag.last = t;
  } else if (drag.kind === 'depth') {
    walkLine(drag.last, t, (x, y) => {
      const k = pack(x, y);
      if (drag.visited.has(k)) return; // raise/lower each tile once per stroke
      drag.visited.add(k);
      depthTile(x, y, drag.invert);
    });
    drag.last = t;
  } else if (drag.kind === 'move') {
    state.float!.dx = drag.dx + (t.x - drag.sx);
    state.float!.dy = drag.dy + (t.y - drag.sy);
  } else if (drag.kind === 'marquee') {
    const c = clampTile(t);
    drag.moved ||= c.x !== drag.x1 || c.y !== drag.y1;
    drag.x1 = c.x;
    drag.y1 = c.y;
  }
  renderCanvas();
  renderLive();
}

canvas.addEventListener('pointermove', (e) => {
  const t = rawTile(e);
  const changed = t.x !== state.hover?.x || t.y !== state.hover?.y;
  state.hover = t;
  if (drag) {
    if (changed) applyDrag(t);
  } else if (changed) renderCanvas();
});
canvas.addEventListener('pointerleave', () => {
  state.hover = null;
  if (!drag) renderCanvas();
});
const endDrag = () => {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (d.kind === 'marquee') {
    if (!d.moved && d.mode === 'replace' && d.x0 === d.x1 && d.y0 === d.y1 && state.sel.has(pack(d.x0, d.y0))) {
      state.sel.clear(); // a plain click inside the selection deselects, like Photoshop
    } else {
      const cells: number[] = [];
      for (let x = Math.min(d.x0, d.x1); x <= Math.max(d.x0, d.x1); x++)
        for (let y = Math.min(d.y0, d.y1); y <= Math.max(d.y0, d.y1); y++) cells.push(pack(x, y));
      setSelection(cells, d.mode);
    }
  }
  renderAll();
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// ---------- panels ----------

const TOOLS: { id: Tool; label: string; icon: string; key: string; help: string }[] = [
  { id: 'move', label: 'Move', icon: '✥', key: 'V', help: 'Drag or use the arrow keys (Shift = 4 tiles). Moves the whole drawing when nothing is selected. Enter drops.' },
  { id: 'select', label: 'Select', icon: '⬚', key: 'M', help: 'Drag a rectangle. Shift adds, Alt subtracts. Ctrl+A all, Ctrl+D none, Ctrl+Shift+I invert. Ctrl+drag moves.' },
  { id: 'wand', label: 'Wand', icon: '✦', key: 'W', help: 'Click to select matching tiles. Shift adds, Alt subtracts.' },
  { id: 'draw', label: 'Draw', icon: '✎', key: 'B', help: 'Left paints, right erases, Alt+click picks.' },
  { id: 'erase', label: 'Erase', icon: '⌫', key: 'E', help: 'Drag to erase tiles.' },
  { id: 'fill', label: 'Fill', icon: '▧', key: 'G', help: 'Fills matching tiles with the current shape, colour and depth. Stays inside the selection.' },
  { id: 'depth', label: 'Depth', icon: '⇕', key: 'D', help: 'Paint depth onto tiles without changing their shape or colour.' },
  { id: 'pick', label: 'Pick', icon: '⊙', key: 'I', help: 'Click a tile to copy its shape, colour and depth to the brush.' },
];

function setTool(t: Tool) {
  if (t !== 'move' && state.float && ['draw', 'erase', 'fill', 'depth'].includes(t)) commitFloat();
  state.tool = t;
  renderPanels();
  renderOptions();
  renderCanvas();
}

function stepperHtml(value: number | null) {
  return `<button data-step="-1" title="Decrease">−</button><input type="number" min="${DEPTH_MIN}" max="${DEPTH_MAX}" value="${value ?? ''}" placeholder="–" /><button data-step="1" title="Increase">+</button>`;
}

function makeStepper(el: HTMLElement, get: () => number | null, onStep: (delta: number) => void, onSet: (v: number) => void) {
  el.innerHTML = stepperHtml(get());
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-step]');
    if (b) onStep(+b.dataset.step!);
  });
  el.addEventListener('change', (e) => {
    const v = +(e.target as HTMLInputElement).value;
    if (v) onSet(clampDepth(v));
  });
  return () => {
    const input = el.querySelector('input')!;
    if (document.activeElement !== input) input.value = String(get() ?? '');
  };
}

const syncBrushDepth = makeStepper(
  $('brush-depth'),
  () => state.depth,
  (d) => {
    state.depth = clampDepth(state.depth + d);
    renderPanels();
  },
  (v) => {
    state.depth = v;
    renderPanels();
  },
);

function selectionDepth(): number | null {
  const p = composite();
  let v: number | null = null;
  for (const [x, y] of selCells()) {
    if (!inBounds(x, y)) continue;
    const t = getTile(p, x, y);
    if (t.color < 0) continue;
    const d = tileDepths(t.depth, 0)[0];
    if (v === null) v = d;
    else if (v !== d) return null;
  }
  return v;
}

const changeSelectionDepth = (delta: number) => editSelection((t) => (t.depth = clampDepth(tileDepths(t.depth, 0)[0] + delta)));
const syncSelDepth = makeStepper($('sel-depth'), selectionDepth, changeSelectionDepth, (v) => editSelection((t) => (t.depth = v)));

function shapeIcon(shape: number, angle: number) {
  return `<svg viewBox="-2 -2 36 36"><path d="${tilePath(0, 0, shape, angle)}"/></svg>`;
}

function renderPanels() {
  $('tools').innerHTML = TOOLS.map(
    (t) =>
      `<button data-tool="${t.id}" class="${state.tool === t.id ? 'active' : ''}" title="${t.label} (${t.key})"><span class="tool-icon">${t.icon}</span>${t.label}</button>`,
  ).join('');
  $('shapes').innerHTML = SHAPES.map(
    (s, i) => `<button data-shape="${i}" class="${state.shape === i ? 'active' : ''}" title="${s.name}">${shapeIcon(i, state.angle)}</button>`,
  ).join('');
  $('angle-label').textContent = `${state.angle * 90}°`;
  const colors = state.project.colors;
  $('palette').innerHTML = colors
    .map((c, i) => `<button class="swatch ${state.color === i ? 'active' : ''}" data-color="${i}" style="background:${c}" title="${c}"></button>`)
    .join('');
  $('palette-count').textContent = `${colors.length} colour${colors.length === 1 ? '' : 's'}`;
  $('current-swatch').style.background = colors[state.color] ?? '#000';
  $('current-hex').textContent = colors[state.color] ?? '';
  $<HTMLButtonElement>('btn-add-color').disabled = colors.length >= PALETTE_MAX;
  $<HTMLButtonElement>('btn-del-color').disabled = colors.length <= 1;
  syncBrushDepth();
  $<HTMLSelectElement>('depth-view').value = state.depthView;
  $<HTMLInputElement>('title').value = state.project.title;
  $<HTMLInputElement>('depth-mult').value = String(state.project.depthMultiplier);
  $('depth-mult-label').textContent = `${state.project.depthMultiplier}%`;
  $<HTMLButtonElement>('btn-undo').disabled = !state.undo.length;
  $<HTMLButtonElement>('btn-redo').disabled = !state.redo.length;

  const cells = selCells();
  $('selection-panel').classList.toggle('hidden', !cells.length);
  if (cells.length) {
    const p = composite();
    const filled = cells.filter(([x, y]) => inBounds(x, y) && getTile(p, x, y).color >= 0).length;
    $('sel-count').textContent = `${filled} tile${filled === 1 ? '' : 's'}${state.float ? ' · floating' : ''}`;
    syncSelDepth();
  }

  if (!toastActive) {
    const { x, y } = state.project.size;
    $('status').textContent = `${state.fileName || 'unsaved'}${state.dirty ? ' •' : ''} · ${x}×${y}`;
  }
}

function renderOptions() {
  const t = TOOLS.find((o) => o.id === state.tool)!;
  let opts = '';
  const seg = (name: string, value: string, items: [string, string][]) =>
    `<span class="seg">${items.map(([v, l]) => `<button data-opt="${name}" data-val="${v}" class="${value === v ? 'active' : ''}">${l}</button>`).join('')}</span>`;
  const chk = (name: string, on: boolean, label: string) => `<label class="opt-check"><input type="checkbox" data-opt="${name}" ${on ? 'checked' : ''}/> ${label}</label>`;
  if (state.tool === 'draw') {
    opts = `<span class="opt-label">Paints over tiles:</span>${chk('apply.shape', state.apply.shape, 'Shape')}${chk('apply.color', state.apply.color, 'Colour')}${chk('apply.depth', state.apply.depth, 'Depth')}<span class="opt-sep"></span><span class="hint">Empty tiles always get all three.</span>`;
  } else if (state.tool === 'depth') {
    opts = `<span class="opt-label">Mode</span>${seg('depthMode', state.depthMode, [
      ['set', 'Set to brush'],
      ['raise', 'Raise +1'],
      ['lower', 'Lower −1'],
    ])}<span class="opt-sep"></span>${chk('depthMapWithTool', state.depthMapWithTool, 'Show depth map')}<span class="opt-sep"></span><span class="hint">${
      state.depthMode === 'set' ? 'Right-click a tile to sample its depth.' : 'Right-click does the opposite.'
    } Each tile changes once per stroke.</span>`;
  } else if (state.tool === 'wand') {
    opts = `<span class="opt-label">Match</span>${seg('wandMatch', state.wandMatch, [
      ['color', 'Colour'],
      ['colorDepth', 'Colour + depth'],
      ['tile', 'Exact tile'],
    ])}${chk('wandContiguous', state.wandContiguous, 'Contiguous')}`;
  } else if (state.tool === 'fill') {
    opts = chk('fillContiguous', state.fillContiguous, 'Contiguous');
  }
  $('optionsbar').innerHTML = `<span class="opt-tool">${t.icon} ${t.label}</span>${opts}<span class="opt-help">${t.help}</span>`;
}

$('optionsbar').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-opt]');
  if (!b) return;
  (state as any)[b.dataset.opt!] = b.dataset.val;
  renderOptions();
  renderCanvas();
});
$('optionsbar').addEventListener('change', (e) => {
  const i = e.target as HTMLInputElement;
  const key = i.dataset.opt;
  if (!key) return;
  if (key.startsWith('apply.')) (state.apply as any)[key.slice(6)] = i.checked;
  else (state as any)[key] = i.checked;
  renderCanvas();
});

let previewTimer = 0;
let previewUrls: string[] = [];
function renderPreview() {
  clearTimeout(previewTimer);
  previewTimer = window.setTimeout(async () => {
    const size = pngSize();
    const crisp = $<HTMLInputElement>('png-crisp').checked;
    const p = composite();
    const [small, large] = await Promise.all([exportPng(p, size, size, { crisp }), exportPng(p, 256, 256)]);
    previewUrls.forEach(URL.revokeObjectURL);
    previewUrls = [URL.createObjectURL(small), URL.createObjectURL(large)];
    const img = $<HTMLImageElement>('preview-small');
    img.src = previewUrls[0];
    img.width = Math.min(size, 128);
    img.height = Math.min(size, 128);
    $<HTMLImageElement>('preview-large').src = previewUrls[1];
  }, 120);
}

/** Cheap updates while dragging. */
function renderLive() {
  schedule3d();
}

$('tools').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (b?.dataset.tool) setTool(b.dataset.tool as Tool);
});
$('shapes').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b?.dataset.shape) return;
  state.shape = +b.dataset.shape;
  if (!['draw', 'fill'].includes(state.tool)) setTool('draw');
  renderPanels();
});

const rotate = (d: number) => {
  state.angle = (state.angle + d + 4) % 4;
  renderPanels();
  renderCanvas();
};
$('rot-cw').addEventListener('click', () => rotate(1));
$('rot-ccw').addEventListener('click', () => rotate(-1));

// ---------- palette ----------

function editPaletteColor(index: number, anchor: HTMLElement) {
  const before = snapshot();
  openColorPicker(anchor, state.project.colors[index], {
    title: `Palette colour ${index + 1}`,
    onChange: (hex) => {
      state.project.colors[index] = hex;
      renderCanvas();
      renderPanels();
      schedule3d();
    },
    onClose: (initial, final) => {
      if (initial.toUpperCase() === final.toUpperCase()) return;
      state.undo.push(before);
      state.redo = [];
      state.dirty = true;
      renderAll();
    },
  });
}

$('palette').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('.swatch');
  if (!b) return;
  state.color = +b.dataset.color!;
  if (['erase', 'pick', 'select', 'wand', 'move'].includes(state.tool)) setTool('draw');
  renderPanels();
  renderCanvas();
});
$('palette').addEventListener('dblclick', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('.swatch');
  if (b) editPaletteColor(+b.dataset.color!, b);
});
$('current-swatch').addEventListener('click', () => editPaletteColor(state.color, $('current-swatch')));
$('btn-add-color').addEventListener('click', () => {
  checkpoint();
  state.project.colors.push(state.project.colors[state.color] ?? '#808080');
  state.color = state.project.colors.length - 1;
  renderPanels();
  const sw = $('palette').querySelector<HTMLElement>(`[data-color="${state.color}"]`)!;
  editPaletteColor(state.color, sw);
});
$('btn-del-color').addEventListener('click', () => {
  const p = state.project;
  if (p.colors.length <= 1) return;
  const i = state.color;
  const used = p.tiles.filter((t) => t.color === i || t.colorBack === i).length;
  const rgb = hexToRgb(p.colors[i]);
  let nearest = i === 0 ? 1 : 0;
  let best = Infinity;
  p.colors.forEach((c, j) => {
    if (j === i) return;
    const o = hexToRgb(c);
    const d = (o[0] - rgb[0]) ** 2 + (o[1] - rgb[1]) ** 2 + (o[2] - rgb[2]) ** 2;
    if (d < best) (best = d), (nearest = j);
  });
  if (used && !confirm(`${used} tile${used === 1 ? ' uses' : 's use'} ${p.colors[i]}. Switch ${used === 1 ? 'it' : 'them'} to the closest colour, ${p.colors[nearest]}?`)) return;
  commitFloat();
  checkpoint();
  const remap = (c: number) => {
    const v = c === i ? nearest : c;
    return v > i ? v - 1 : v; // indices after the removed swatch shift down by one
  };
  for (const t of p.tiles) {
    if (t.color >= 0) t.color = remap(t.color);
    if (t.colorBack >= 0) t.colorBack = remap(t.colorBack);
  }
  p.colors.splice(i, 1);
  state.color = Math.min(i, p.colors.length - 1);
  renderAll();
});

// ---------- depth controls ----------

$<HTMLSelectElement>('depth-view').addEventListener('change', (e) => {
  state.depthView = (e.target as HTMLSelectElement).value as DepthView;
  renderCanvas();
});

// ---------- selection panel ----------

$('sel-color').addEventListener('click', () => editSelection((t) => (t.color = state.color)));
$('sel-shape').addEventListener('click', () => editSelection((t) => Object.assign(t, { shape: state.shape, angle: state.angle })));
$('sel-rot-cw').addEventListener('click', () => transformSelection('rotCW'));
$('sel-rot-ccw').addEventListener('click', () => transformSelection('rotCCW'));
$('sel-flip-x').addEventListener('click', () => transformSelection('flipX'));
$('sel-flip-y').addEventListener('click', () => transformSelection('flipY'));
$('sel-delete').addEventListener('click', deleteSelection);
$('sel-none').addEventListener('click', deselect);

$<HTMLInputElement>('title').addEventListener('change', (e) => {
  checkpoint();
  state.project.title = (e.target as HTMLInputElement).value.trim() || 'Untitled';
  renderPanels();
});

// ---------- 3D ----------

type ViewMode = '2d' | 'split' | '3d';
const VIEWS: ViewMode[] = ['2d', 'split', '3d'];
const preview3d = new Preview3D($('view3d'));
let viewMode: ViewMode = 'split';
try {
  const saved = localStorage.getItem('3dpixel.view') as ViewMode | null;
  if (saved && VIEWS.includes(saved)) viewMode = saved;
} catch {}

function setView(v: ViewMode) {
  viewMode = v;
  $('workspace').className = `workspace view-${v}`;
  $('view-mode').querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  try {
    localStorage.setItem('3dpixel.view', v);
  } catch {}
  fitScale();
  renderCanvas();
  schedule3d();
}

let timer3d = 0;
function schedule3d() {
  clearTimeout(timer3d);
  timer3d = window.setTimeout(() => {
    if (viewMode !== '2d') preview3d.update(composite());
  }, 30);
}

function applySettings() {
  preview3d.setBackground(settings.bg3dMode === 'solid' ? settings.bg3d : null);
  preview3d.setFloorGrid(settings.floorGrid3d);
  fitScale();
  renderCanvas();
}
onSettingsChange(applySettings);

$('view-mode').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (b?.dataset.view) setView(b.dataset.view as ViewMode);
});
$('btn-reset-view').addEventListener('click', () => preview3d.resetView());
$('btn-settings').addEventListener('click', openSettings);

const depthMult = $<HTMLInputElement>('depth-mult');
const depthCheckpoint = () => {
  checkpoint();
  renderPanels();
};
depthMult.addEventListener('pointerdown', depthCheckpoint);
depthMult.addEventListener('keydown', depthCheckpoint);
depthMult.addEventListener('input', () => {
  state.project.depthMultiplier = +depthMult.value;
  $('depth-mult-label').textContent = `${depthMult.value}%`;
  schedule3d();
  renderStats();
});

const modelOpts = () => ({
  scale: $<HTMLSelectElement>('model-scale').value as ModelScale,
  pivot: $<HTMLSelectElement>('model-pivot').value as ModelPivot,
});

function renderStats() {
  const p = composite();
  const unit = $<HTMLSelectElement>('model-scale').value === 'fit' ? 1 / Math.max(p.size.x, p.size.y) : 1;
  let front = 0;
  let back = 0;
  for (const t of p.tiles) {
    if (t.color < 0) continue;
    const [f, b] = tileDepths(t.depth, t.depthBack);
    front = Math.max(front, f / 2);
    back = Math.max(back, b / 2);
  }
  const depth = (front + back) * (p.depthMultiplier / 100) * unit;
  $('model-stats').textContent = `Model: ${+(p.size.x * unit).toFixed(3)} × ${+(p.size.y * unit).toFixed(3)} × ${+depth.toFixed(3)} units (grid × depth).`;
}
$('model-scale').addEventListener('change', renderStats);

$('btn-export-model').addEventListener('click', async () => {
  commitFloat();
  try {
    const opts = modelOpts();
    if ($<HTMLSelectElement>('model-format').value === 'glb') {
      const res = await saveBlob(await exportGlb(state.project, opts), `${safeName()}.glb`, '.glb', 'glTF binary', 'model/gltf-binary');
      if (res) flash(`Exported ${res.name}`);
    } else {
      const { obj, mtl } = exportObj(state.project, `${safeName()}.mtl`, opts);
      // the .obj refers to the .mtl by name, so both go to the downloads folder side by side
      download(new Blob([obj], { type: 'text/plain' }), `${safeName()}.obj`);
      download(new Blob([mtl], { type: 'text/plain' }), `${safeName()}.mtl`);
      flash(`Downloaded ${safeName()}.obj and ${safeName()}.mtl`);
    }
  } catch (err: any) {
    flash(`3D export failed: ${err?.message ?? err}`, true);
  }
  renderAll();
});

function renderAll() {
  fitScale();
  renderCanvas();
  renderPanels();
  renderOptions();
  renderPreview();
  schedule3d();
  renderStats();
}

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
  commitFloat();
  const blob = await writeKenshape(state.project);
  const res = await saveBlob(blob, `${safeName()}.kenshape`, '.kenshape', 'Kenney Shape project', 'application/octet-stream', as ? undefined : state.fileHandle ?? undefined);
  if (!res) return;
  state.fileName = res.name;
  state.fileHandle = res.handle;
  state.dirty = false;
  flash(`Saved ${res.name}`);
  renderAll();
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
  commitFloat();
  const prev = snapshot();
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
  commitFloat();
  const grouping = $<HTMLSelectElement>('svg-grouping').value as SvgGrouping;
  const svg = exportSvg(state.project, { grouping, width: state.project.size.x * 16, height: state.project.size.y * 16 });
  const res = await saveBlob(new Blob([svg], { type: 'image/svg+xml' }), `${safeName()}.svg`, '.svg', 'SVG image', 'image/svg+xml');
  if (res) flash(`Exported ${res.name}`);
  renderAll();
});
$('btn-export-png').addEventListener('click', async () => {
  commitFloat();
  const size = pngSize();
  const blob = await exportPng(state.project, size, size, { crisp: $<HTMLInputElement>('png-crisp').checked });
  const res = await saveBlob(blob, `${safeName()}.png`, '.png', 'PNG image', 'image/png');
  if (res) flash(`Exported ${res.name} (${size}×${size})`);
  renderAll();
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
  if ((e.target as HTMLElement).matches('input:not([type=range]):not([type=checkbox]), select, textarea')) return;
  if (document.querySelector('dialog[open], .picker')) return;
  const k = e.key.toLowerCase();
  const mod = e.ctrlKey || e.metaKey;
  if (mod) {
    if (k === 'z' && !e.shiftKey) undo();
    else if (k === 'y' || (k === 'z' && e.shiftKey)) redo();
    else if (k === 's') save(e.shiftKey);
    else if (k === 'o') pickOpen('any');
    else if (k === 'a') selectAll();
    else if (k === 'd') deselect();
    else if (k === 'i' && e.shiftKey) invertSelection();
    else if (k === 'c') copySelection();
    else if (k === 'x') copySelection(true);
    else if (k === 'v') paste();
    else return;
    e.preventDefault();
    return;
  }
  const arrows: Record<string, [number, number]> = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
  if (arrows[k]) {
    if (state.tool !== 'move' && !hasSelection()) return;
    e.preventDefault();
    const n = e.shiftKey ? 4 : 1;
    nudge(arrows[k][0] * n, arrows[k][1] * n);
    return;
  }
  if (k === 'enter') {
    commitFloat();
    renderAll();
    return;
  }
  if (k === 'escape') {
    deselect();
    return;
  }
  if (k === 'delete' || k === 'backspace') {
    e.preventDefault();
    deleteSelection();
    return;
  }
  if (k === '[' || k === ']') {
    const d = k === ']' ? 1 : -1;
    if (hasSelection()) changeSelectionDepth(d);
    else {
      state.depth = clampDepth(state.depth + d);
      renderPanels();
    }
    return;
  }
  const tool = TOOLS.find((t) => t.key.toLowerCase() === k);
  if (tool) return setTool(tool.id);
  if (k === 'r') return rotate(e.shiftKey ? -1 : 1);
  if (k === '`') return setView(VIEWS[(VIEWS.indexOf(viewMode) + 1) % VIEWS.length]);
  if (k >= '1' && k <= '9') state.depth = +k;
  else if (k === '0') state.depth = 10;
  else return;
  renderPanels();
});

let toast = 0;
let toastActive = false;
function flash(msg: string, error = false) {
  const el = $('status');
  el.textContent = msg;
  el.style.color = error ? '#e5484d' : '';
  toastActive = true;
  clearTimeout(toast);
  toast = window.setTimeout(() => {
    toastActive = false;
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

$<HTMLSelectElement>('new-size').value = String(settings.newSize);
$<HTMLInputElement>('png-size').value = String(settings.pngSize);
onSettingsChange((s) => {
  $<HTMLSelectElement>('new-size').value = String(s.newSize);
  $<HTMLInputElement>('png-size').value = String(s.pngSize);
  renderPreview();
});

setView(viewMode);
applySettings();
renderAll();
