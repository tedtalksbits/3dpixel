import './style.css';
import { Project, Tile, newProject, getTile, readKenshape, writeKenshape, cloneProject, emptyTile, tileIndex } from './kenshape';
import { SHAPES } from './shapes';
import { TILE, exportSvg, exportPng, tilePath, SvgGrouping } from './svgExport';
import { importSvg, PaletteMode } from './svgImport';
import { importPng, PngDepth, decodeImage, artOf, Art } from './pngImport';
import { Grid, backFromArt, simpleBack, depthFromSide } from './views';
import { generateImage, estimateSkeleton, rotateImage, ROTATE_SIZES, Usage, getBalance, balanceText, usageText, KEY_NAME, Model, View, Direction, Outline, Detail } from './pixellab';
import { autoRig } from './autoRig';
import { getSecret } from './secrets';
import { Preview3D } from './preview3d';
import { exportGlb, exportObj, ModelScale, ModelPivot } from './modelExport';
import { tileDepths } from './mesh';
import { transformShape, ShapeXf } from './transform';
import { openColorPicker, hexToRgb, rgbToHex } from './colorPicker';
import { settings, onSettingsChange, openSettings, KEY_EVENT } from './settings';
import * as platform from './platform';
import { FileRef, FileType } from './platform';
import {
  AutoExport, ExportTarget, TargetFormat, FORMATS, emptyAutoExport, takeAutoExport, withAutoExport, storePath, targetAbsPath, runAutoExport,
} from './autoExport';
import { Clip, Key, Track, Prop, Vec3, FPS, REST, newClip, evalClip, setKey, snapTime, keyTimes, keysAt, deleteKeysAt, findTrack } from './anim';
import { Ease } from './easing';
import { renderDopeSheet, bindDopeSheet, moveDopeHead, keyId, parseKeyId } from './dopesheet';
import { renderCurveEditor, bindCurveEditor } from './curveEditor';
import { FrameView, renderClips, canvasBlob } from './frames';
import { SheetLayout, sheetFiles, gifOf, frameName, clipSlug } from './animExport';
import { zip } from './zip';
import { PRESETS, PRESET_LIST, PresetDef, PresetId, PresetUse, PivotSpot, addPreset, applyPreset, removePreset, customisePreset, refreshPresets, presetsFor } from './presets';
import { RigTemplate, TemplateKind, Facing, TEMPLATES, rigCtx, guessRoles, roleLabel } from './templates';
import { Part, noTemplate, basePart, drawOrder, flattenTiles, takeRig, withRig, autoPivot, wouldCycle, treeOrder, emptyGrid, newPartId } from './rig';

type Tool = 'move' | 'select' | 'paintSel' | 'wand' | 'draw' | 'erase' | 'fill' | 'depth' | 'pick' | 'pivot';
type DepthMode = 'set' | 'raise' | 'lower';
type DepthView = 'off' | 'numbers' | 'map' | 'back';
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
  parts: Part[];
  active: number;
  clips: Clip[];
  clip: number;
  template: RigTemplate;
  sel: number[];
}

const pack = (x: number, y: number) => (x + 4096) * 8192 + (y + 4096);
const unpack = (k: number): [number, number] => [Math.floor(k / 8192) - 4096, (k % 8192) - 4096];
const clampDepth = (d: number) => Math.max(DEPTH_MIN, Math.min(DEPTH_MAX, Math.round(d)));

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const initialProject = newProject(settings.newSize);

const state = {
  project: initialProject,
  /** Rig parts (layers). The active part's tiles array is the same array as project.tiles, so every tool edits it. */
  parts: [basePart(initialProject)] as Part[],
  active: 0,
  dimOthers: true,
  clips: [] as Clip[],
  clip: -1, // index of the clip being edited, -1 = none
  time: 0, // playhead, seconds
  playing: false,
  keyEase: 'cubic.inOut' as Ease,
  template: noTemplate() as RigTemplate,
  keySel: new Set<string>(), // keys selected in the dope sheet, by keyId
  expanded: new Set<string>(), // parts opened up in the dope sheet
  onion: false,
  poseMode: false,
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
  selBrush: 1,
  fillContiguous: true,
  sel: new Set<number>(),
  float: null as Floating | null,
  clipboard: null as { cells: [number, number][]; items: FloatItem[] } | null,
  hover: null as { x: number; y: number } | null,
  undo: [] as Snapshot[],
  redo: [] as Snapshot[],
  file: null as FileRef | null,
  autoExport: emptyAutoExport() as AutoExport,
  dirty: false,
};

const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < state.project.size.x && y < state.project.size.y;

// ---------- history ----------

const snapshot = (): Snapshot => ({ project: cloneProject(state.project), parts: structuredClone(state.parts), active: state.active, clips: structuredClone(state.clips), clip: state.clip, template: { ...state.template }, sel: [...state.sel] });

function checkpoint() {
  state.undo.push(snapshot());
  if (state.undo.length > 200) state.undo.shift();
  state.redo = [];
  state.dirty = true;
}

function restore(s: Snapshot) {
  state.project = s.project;
  state.parts = s.parts;
  state.active = s.active;
  state.project.tiles = s.parts[s.active].tiles;
  state.clips = s.clips;
  state.clip = Math.min(s.clip, s.clips.length - 1);
  state.template = s.template;
  state.keySel.clear();
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

function setProject(p: Project, file: FileRef | null = null) {
  state.autoExport = takeAutoExport(p);
  const rig = takeRig(p);
  state.parts = rig.parts;
  state.active = rig.active;
  p.tiles = rig.parts[rig.active].tiles;
  if (state.playing) stop();
  state.clips = rig.clips;
  state.clip = rig.clips.length ? 0 : -1;
  state.template = rig.template;
  state.keySel.clear();
  state.time = 0;
  state.project = p;
  state.undo = [];
  state.redo = [];
  state.sel.clear();
  state.float = null;
  state.file = file;
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

/** Every part as it currently looks; the active one includes floating tiles. */
function liveParts(): Part[] {
  const c = composite();
  return state.parts.map((pt, i) => (i === state.active ? { ...pt, tiles: c.tiles } : pt));
}

/** All parts flattened into one drawing, for 2D previews and exports. */
function flat(): Project {
  const c = composite();
  if (state.parts.length === 1) return c;
  return { ...c, tiles: flattenTiles(c, liveParts()) };
}

const activePart = () => state.parts[state.active];

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

/** The tiles a selection brush of the current size covers, centred on (x, y). */
function brushCells(x: number, y: number): number[] {
  const n = state.selBrush, o = Math.floor((n - 1) / 2);
  const out: number[] = [];
  for (let dx = 0; dx < n; dx++)
    for (let dy = 0; dy < n; dy++) {
      const cx = x - o + dx, cy = y - o + dy;
      // larger brushes are round
      if (n > 2 && (dx - (n - 1) / 2) ** 2 + (dy - (n - 1) / 2) ** 2 > (n / 2) ** 2) continue;
      if (inBounds(cx, cy)) out.push(pack(cx, cy));
    }
  return out;
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
  if (paintingBack()) {
    if (state.apply.color) t.colorBack = state.color;
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
  if (paintingBack()) {
    state.color = backColor(t);
    return flash(`Picked the back colour ${state.project.colors[state.color]}`);
  }
  Object.assign(state, { shape: t.shape, angle: t.angle, color: t.color, depth: clampDepth(tileDepths(t.depth, 0)[0]) });
  flash(`Picked ${SHAPES[t.shape]?.name ?? 'shape'}, ${state.project.colors[t.color]}, depth ${state.depth}`);
}

function sameTile(a: Tile, b: Tile) {
  if (a.color < 0 && b.color < 0) return true;
  return a.color === b.color && a.shape === b.shape && a.angle === b.angle;
}

/** "Canvas shows: back colours": the tools paint the back of tiles instead of the front. */
const paintingBack = () => effectiveDepthView() === 'back';
const backColor = (t: Tile) => (t.colorBack >= 0 ? t.colorBack : t.color);

function fill(x: number, y: number) {
  const start = { ...getTile(state.project, x, y) };
  if (paintingBack()) {
    if (start.color < 0) return;
    for (const k of regionFrom(x, y, (t) => t.color >= 0 && backColor(t) === backColor(start), state.fillContiguous, state.sel)) {
      const [cx, cy] = unpack(k);
      getTile(state.project, cx, cy).colorBack = state.color;
    }
    return;
  }
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
  const many = state.parts.length > 1;
  const activeId = activePart().id;
  for (const part of drawOrder(liveParts())) {
    const isActive = part.id === activeId;
    if (!isActive && !part.visible) continue;
    let layer = '';
    for (let x = 0; x < p.size.x; x++) {
      for (let y = 0; y < p.size.y; y++) {
        const t = part.tiles[tileIndex(p, x, y)];
        if (t.color < 0) continue;
        const c = p.colors[view === 'back' ? backColor(t) : t.color];
        if (!isActive) {
          layer += `<path fill="${c}" d="${tilePath(x, y, t.shape, t.angle)}"/>`;
          continue;
        }
        const d = tileDepths(t.depth, 0)[0];
        layer += `<path fill="${view === 'map' ? depthFill(d) : c}" d="${tilePath(x, y, t.shape, t.angle)}"/>`;
        if ((view === 'numbers' || view === 'map') && tilePx >= 14)
          numbers += `<text x="${x * TILE + 16}" y="${y * TILE + 21}">${d}</text>`;
      }
    }
    // other parts are faded so it's clear which one the tools edit
    s += many && !isActive && state.dimOthers ? `<g opacity="0.35">${layer}</g>` : layer;
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

  if (many || state.tool === 'pivot') s += pivotOverlay();

  const h = state.hover;
  if (h && inBounds(h.x, h.y) && !drag?.kind?.match(/marquee|move|pivot/)) {
    const tool = state.tool;
    if ((tool === 'draw' || tool === 'fill') && canPaintAt(h.x, h.y)) {
      s += `<path fill="${p.colors[state.color]}" fill-opacity="0.55" d="${tilePath(h.x, h.y, state.shape, state.angle)}"/>`;
    }
    if (tool === 'paintSel')
      for (const k of brushCells(h.x, h.y)) {
        const [x, y] = unpack(k);
        s += `<rect x="${x * TILE}" y="${y * TILE}" width="${TILE}" height="${TILE}" fill="var(--accent)" fill-opacity="0.2" stroke="var(--accent)" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
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

/** Pivots as dots; with the Pivot tool, lines from each pivot to its parent's show the hierarchy. */
function pivotOverlay() {
  const at = (pt: Part) => [pt.pivot[0] * TILE, pt.pivot[1] * TILE];
  const bones = state.tool === 'pivot';
  const active = activePart();
  let o = '';
  for (const pt of state.parts) {
    if (!pt.visible && pt !== active) continue;
    const [x, y] = at(pt);
    const parent = pt.parent ? state.parts.find((q) => q.id === pt.parent) : undefined;
    if (bones && parent) {
      const [px, py] = at(parent);
      o += `<line x1="${px}" y1="${py}" x2="${x}" y2="${y}" class="bone" vector-effect="non-scaling-stroke"/>`;
    }
    if (pt !== active && bones) o += `<circle cx="${x}" cy="${y}" r="5" class="pivot-dot" vector-effect="non-scaling-stroke"/>`;
  }
  const [x, y] = at(active);
  return o + `<g class="pivot-active"><circle cx="${x}" cy="${y}" r="9" vector-effect="non-scaling-stroke"/><path d="M${x - 15} ${y}h30M${x} ${y - 15}v30" vector-effect="non-scaling-stroke"/></g>`;
}

/** Place the active part's pivot under the pointer, snapped to half tiles. */
function setPivotAt(e: PointerEvent) {
  const r = canvas.getBoundingClientRect();
  const { x: w, y: h } = state.project.size;
  const snap = (v: number, max: number) => Math.max(0, Math.min(max, Math.round(v * 2) / 2));
  const px = snap(((e.clientX - r.left) / r.width) * w, w);
  const py = snap(((e.clientY - r.top) / r.height) * h, h);
  const part = activePart();
  if (part.pivot[0] === px && part.pivot[1] === py) return;
  part.pivot = [px, py];
  state.dirty = true;
  refreshAllPresets();
  renderCanvas();
  renderParts();
  schedule3d();
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
    case 'paintSel': {
      commitFloat();
      const subtract = e.altKey || e.button === 2;
      drag = { kind: 'paintSel', subtract, last: null };
      applyDrag(t);
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
    case 'pivot':
      commitFloat();
      checkpoint();
      drag = { kind: 'pivot' };
      setPivotAt(e);
      return;
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
  } else if (drag.kind === 'paintSel') {
    walkLine(drag.last, t, (x, y) => setSelection(brushCells(x, y), drag.subtract ? 'subtract' : 'add'));
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
  if (drag?.kind === 'pivot') setPivotAt(e);
  else if (drag) {
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
  { id: 'paintSel', label: 'Paint sel.', icon: '◌', key: 'L', help: 'Paint over tiles to add them to the selection. Alt or right-drag removes. Ctrl+D clears, Ctrl+drag moves.' },
  { id: 'wand', label: 'Wand', icon: '✦', key: 'W', help: 'Click to select matching tiles. Shift adds, Alt subtracts.' },
  { id: 'draw', label: 'Draw', icon: '✎', key: 'B', help: 'Left paints, right erases, Alt+click picks.' },
  { id: 'erase', label: 'Erase', icon: '⌫', key: 'E', help: 'Drag to erase tiles.' },
  { id: 'fill', label: 'Fill', icon: '▧', key: 'G', help: 'Fills matching tiles with the current shape, colour and depth. Stays inside the selection.' },
  { id: 'depth', label: 'Depth', icon: '⇕', key: 'D', help: 'Paint depth onto tiles without changing their shape or colour.' },
  { id: 'pick', label: 'Pick', icon: '⊙', key: 'I', help: 'Click a tile to copy its shape, colour and depth to the brush.' },
  { id: 'pivot', label: 'Pivot', icon: '⊕', key: 'P', help: "Click or drag to place the selected part's pivot, the point it rotates around. Snaps to half tiles. Lines show each part's parent." },
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

  const name = state.file?.name || 'unsaved';
  if (!toastActive) {
    const { x, y } = state.project.size;
    $('status').textContent = `${name}${state.dirty ? ' •' : ''} · ${x}×${y}`;
  }
  platform.setWindowTitle(`${name}${state.dirty ? ' •' : ''} — 3dpixel`);
  renderAutoExport();
  renderAnimExport();
  renderParts();
  renderPlaybar();
  renderPose();
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
  } else if (state.tool === 'paintSel') {
    opts = `<span class="opt-label">Brush</span>${seg('selBrush', String(state.selBrush), [
      ['1', '1'],
      ['2', '2'],
      ['3', '3'],
      ['5', '5'],
    ])}`;
  }
  $('optionsbar').innerHTML = `<span class="opt-tool">${t.icon} ${t.label}</span>${opts}<span class="opt-help">${t.help}</span>`;
}

$('optionsbar').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-opt]');
  if (!b) return;
  const opt = b.dataset.opt!;
  (state as any)[opt] = typeof (state as any)[opt] === 'number' ? +b.dataset.val! : b.dataset.val;
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
    const p = flat();
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
  if (['erase', 'pick', 'select', 'paintSel', 'wand', 'move'].includes(state.tool)) setTool('draw');
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
  const used = state.parts.reduce((n, pt) => n + pt.tiles.filter((t) => t.color === i || t.colorBack === i).length, 0);
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
  for (const pt of state.parts) {
    for (const t of pt.tiles) {
      if (t.color >= 0) t.color = remap(t.color);
      if (t.colorBack >= 0) t.colorBack = remap(t.colorBack);
    }
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

// ---------- parts (rig layers) ----------

function selectPart(i: number) {
  commitFloat();
  state.active = Math.max(0, Math.min(state.parts.length - 1, i));
  state.project.tiles = activePart().tiles;
  renderAll();
}

const tileCount = (pt: Part) => pt.tiles.reduce((n, t) => n + (t.color >= 0 ? 1 : 0), 0);
const partById = (id: string | null) => (id ? state.parts.find((o) => o.id === id) ?? null : null);

function nextPartName() {
  for (let n = state.parts.length; ; n++) if (!state.parts.some((o) => o.name === `Part ${n}`)) return `Part ${n}`;
}

function nearestColor(hex: string) {
  const rgb = hexToRgb(hex);
  let best = 0;
  let bestD = Infinity;
  state.project.colors.forEach((c, j) => {
    const o = hexToRgb(c);
    const d = (o[0] - rgb[0]) ** 2 + (o[1] - rgb[1]) ** 2 + (o[2] - rgb[2]) ** 2;
    if (d < bestD) (bestD = d), (best = j);
  });
  return best;
}

/** Ctrl+J: move the selected tiles of the current part into a new part, parented to it. */
function partFromSelection() {
  if (!hasSelection()) {
    flash('Select some tiles first, then press Ctrl+J to make them a part.');
    return;
  }
  commitFloat();
  const p = state.project;
  const src = activePart();
  const moved: number[] = [];
  for (const k of state.sel) {
    const [x, y] = unpack(k);
    if (inBounds(x, y) && src.tiles[tileIndex(p, x, y)].color >= 0) moved.push(tileIndex(p, x, y));
  }
  if (!moved.length) {
    flash(`The selection has no tiles in ${src.name}.`, true);
    return;
  }
  checkpoint();
  const tiles = emptyGrid(p);
  for (const i of moved) {
    tiles[i] = src.tiles[i];
    src.tiles[i] = emptyTile();
  }
  const part: Part = { id: newPartId(), name: nextPartName(), tiles, pivot: [0, 0], z: src.z, parent: src.id, visible: true };
  part.pivot = autoPivot(p, part, src);
  state.parts.splice(state.active + 1, 0, part);
  state.sel.clear();
  selectPart(state.active + 1);
  flash(`Made ${part.name} from ${moved.length} tile${moved.length === 1 ? '' : 's'}. Rename it and check its pivot.`);
}

function addEmptyPart() {
  commitFloat();
  checkpoint();
  const p = state.project;
  const root = state.parts.find((o) => !o.parent) ?? null;
  const part: Part = { id: newPartId(), name: nextPartName(), tiles: emptyGrid(p), pivot: [p.size.x / 2, p.size.y / 2], z: activePart().z, parent: root?.id ?? null, visible: true };
  state.parts.splice(state.active + 1, 0, part);
  selectPart(state.active + 1);
}

/** Copy the current part one step behind, with darker colours: the far arm or leg in a side view. */
function farCopy() {
  commitFloat();
  const src = activePart();
  if (!tileCount(src)) {
    flash(`${src.name} has no tiles to copy.`, true);
    return;
  }
  checkpoint();
  const colors = state.project.colors;
  const darker = new Map<number, number>();
  const darken = (c: number) => {
    if (c < 0) return c;
    if (!darker.has(c)) {
      const hex = rgbToHex(hexToRgb(colors[c]).map((v) => v * 0.72) as [number, number, number]);
      let j = colors.findIndex((o) => o.toUpperCase() === hex);
      if (j < 0 && colors.length < PALETTE_MAX) (j = colors.length), colors.push(hex);
      darker.set(c, j < 0 ? nearestColor(hex) : j);
    }
    return darker.get(c)!;
  };
  const tiles = src.tiles.map((t) => (t.color < 0 ? emptyTile() : { ...t, color: darken(t.color), colorBack: darken(t.colorBack) }));
  const part: Part = { id: newPartId(), name: `${src.name} (far)`, tiles, pivot: [...src.pivot], z: src.z - 1, parent: src.parent, visible: true };
  state.parts.splice(state.active, 0, part); // listed just before the original
  selectPart(state.active);
  flash(`Made ${part.name}: 1 step behind, colours darkened. Adjust Z if it sits inside the body.`);
}

function deletePart() {
  if (state.parts.length < 2) return;
  commitFloat();
  checkpoint();
  const gone = activePart();
  for (const pt of state.parts) if (pt.parent === gone.id) pt.parent = gone.parent;
  for (const c of state.clips) {
    c.tracks = c.tracks.filter((tr) => tr.part !== gone.id);
    c.presets = c.presets?.filter((u) => u.part !== gone.id);
  }
  state.parts.splice(state.active, 1);
  selectPart(Math.min(state.active, state.parts.length - 1));
}

function partDepth(pt: Part) {
  let d = 0;
  for (let cur = partById(pt.parent); cur && d < state.parts.length; cur = partById(cur.parent)) d++;
  return d;
}

function testJoint() {
  if (viewMode === '2d') setView('split');
  clearTimeout(timer3d);
  preview3d.update(composite(), liveParts(), activePart().id);
  preview3d.wiggle(activePart().id);
}

function renderParts() {
  const active = activePart();
  $('parts').innerHTML = treeOrder(state.parts)
    .map((pt) => {
      const i = state.parts.indexOf(pt);
      const n = tileCount(pt);
      return `<div class="part-row${i === state.active ? ' active' : ''}" data-part="${i}" style="padding-left:${4 + partDepth(pt) * 14}px">
        <button class="eye${pt.visible ? '' : ' off'}" data-eye="${i}" title="${pt.visible ? 'Hide' : 'Show'} in the editor (still exported)">${pt.visible ? '◉' : '○'}</button>
        <span class="part-name">${escapeHtml(pt.name)}</span>
        <span class="hint">${n} tile${n === 1 ? '' : 's'}${pt.z ? ` · z ${pt.z > 0 ? '+' : ''}${pt.z}` : ''}</span>
      </div>`;
    })
    .join('');
  $<HTMLButtonElement>('part-from-sel').disabled = !hasSelection();
  $<HTMLButtonElement>('part-delete').disabled = state.parts.length < 2;
  $<HTMLInputElement>('parts-dim').checked = state.dimOthers;
  renderTemplate();

  const props = $('part-props');
  if (props.contains(document.activeElement) && document.activeElement?.matches('input')) return;
  const parents = state.parts.filter((o) => o !== active && !wouldCycle(state.parts, active.id, o.id));
  props.innerHTML = `
    <label>Name <input id="part-name" value="${escapeHtml(active.name)}" spellcheck="false" /></label>
    <label>Parent <select id="part-parent"><option value="">None (root)</option>${parents
      .map((o) => `<option value="${o.id}"${o.id === active.parent ? ' selected' : ''}>${escapeHtml(o.name)}</option>`)
      .join('')}</select></label>
    <div class="row"><span class="label" title="Distance in front of (+) or behind (−) the body, in tiles">Z</span>
      <div class="stepper"><button data-z="-0.5" title="Further back">−</button><input id="part-z" type="number" step="0.5" value="${active.z}" /><button data-z="0.5" title="Further forward">+</button></div></div>
    <div class="row"><span class="label">Pivot</span><span class="mono">${active.pivot[0]}, ${active.pivot[1]}</span></div>
    <div class="btn-grid">
      <button id="part-pivot-tool" class="${state.tool === 'pivot' ? 'active' : ''}" title="Click or drag on the canvas to place the pivot (P)">Place pivot</button>
      <button id="part-pivot-auto" title="Put the pivot where this part touches its parent">Auto pivot</button>
    </div>
    <button id="part-wiggle" class="wide" title="Swing this part about its pivot in the 3D view">Test joint</button>`;
}

/** Give parts the roles guessed from their names and positions, and set the facing. */
function applyGuess(kind: TemplateKind) {
  const { roles, facing } = guessRoles(kind, state.parts);
  for (const pt of state.parts) delete pt.role;
  for (const [id, role] of roles) partById(id)!.role = role;
  // names and pivots can't tell a front view apart, so keep that choice
  if (!(state.template.facing === 'front' && kind === 'biped')) state.template.facing = facing;
  return roles.size;
}

function renderTemplate() {
  const host = $('rig-template');
  const tpl = state.template;
  const kinds = (Object.keys(TEMPLATES) as TemplateKind[])
    .map((k) => `<option value="${k}"${k === tpl.kind ? ' selected' : ''}>${TEMPLATES[k].name}</option>`)
    .join('');
  let html = `<h3>Rig template</h3>
    <label>Kind <select id="tpl-kind"><option value="">None: single-part presets only</option>${kinds}</select></label>
    <button id="tpl-autorig" class="wide" title="PixelLab finds the character's joints (0.1 generations); the drawing is split into body, head, arms and legs with pivots on the joints">Auto-rig a two-legged character</button>`;
  if (tpl.kind) {
    const t = TEMPLATES[tpl.kind];
    const facings: Facing[] = tpl.kind === 'biped' ? ['right', 'left', 'front'] : ['right', 'left'];
    const facing = facings.map((f) => `<option value="${f}"${f === tpl.facing ? ' selected' : ''}>${{ right: 'Right →', left: '← Left', front: 'Front: towards you' }[f]}</option>`).join('');
    const rows = t.roles
      .map(([role, label]) => {
        const opts = state.parts.map((pt) => `<option value="${pt.id}"${pt.role === role ? ' selected' : ''}>${escapeHtml(pt.name)}</option>`).join('');
        const set = state.parts.some((pt) => pt.role === role);
        return `<label class="role-row${set ? '' : ' unset'}"><span>${label}</span><select data-role="${role}"><option value="">—</option>${opts}</select></label>`;
      })
      .join('');
    html += `<label>Faces <select id="tpl-facing">${facing}</select></label>
      <p class="hint">${t.help} Give each part its role; presets skip roles with no part.</p>
      <div class="roles">${rows}</div>
      <button id="tpl-guess" class="wide" title="Guess roles from part names (head, arm, leg, far...), Z and pivot positions">Guess roles</button>`;
  }
  host.innerHTML = html;
}

const partsPanel = $('parts-panel');
partsPanel.addEventListener('click', (e) => {
  const el = e.target as HTMLElement;
  const eye = el.closest<HTMLElement>('[data-eye]');
  if (eye) {
    const pt = state.parts[+eye.dataset.eye!];
    pt.visible = !pt.visible;
    state.dirty = true;
    renderAll();
    return;
  }
  const row = el.closest<HTMLElement>('[data-part]');
  if (row) return selectPart(+row.dataset.part!);
  const zb = el.closest<HTMLElement>('[data-z]');
  if (zb) {
    checkpoint();
    activePart().z += +zb.dataset.z!;
    return renderAll();
  }
  switch (el.closest('button')?.id) {
    case 'part-from-sel':
      return partFromSelection();
    case 'part-new':
      return addEmptyPart();
    case 'part-far':
      return farCopy();
    case 'part-delete':
      return deletePart();
    case 'part-pivot-tool':
      return setTool('pivot');
    case 'part-pivot-auto': {
      checkpoint();
      const pt = activePart();
      pt.pivot = autoPivot(state.project, pt, partById(pt.parent));
      return renderAll();
    }
    case 'part-wiggle':
      return testJoint();
    case 'tpl-autorig':
      return autoRigClicked();
    case 'tpl-guess': {
      if (!state.template.kind) return;
      checkpoint();
      const n = applyGuess(state.template.kind);
      flash(`Guessed ${n} role${n === 1 ? '' : 's'}. Fix any that are wrong with the menus.`);
      return renderAll();
    }
  }
});
partsPanel.addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement;
  const pt = activePart();
  if (el.id === 'tpl-kind') {
    checkpoint();
    const kind = (el.value || null) as TemplateKind | null;
    state.template.kind = kind;
    // roles from another template (or none yet): start from a guess
    if (kind && !state.parts.some((o) => o.role && TEMPLATES[kind].roles.some(([r]) => r === o.role))) {
      const n = applyGuess(kind);
      flash(`Guessed ${n} role${n === 1 ? '' : 's'} from part names and positions. Check them below.`);
    }
    return renderAll();
  }
  if (el.id === 'tpl-facing') {
    checkpoint();
    state.template.facing = el.value as Facing;
    return renderAll();
  }
  if (el.dataset.role) {
    checkpoint();
    const role = el.dataset.role;
    for (const o of state.parts) if (o.role === role) delete o.role;
    const target = partById(el.value || null);
    if (target) target.role = role; // a part has one role, so this replaces any other
    return renderAll();
  }
  if (el.id === 'parts-dim') {
    state.dimOthers = el.checked;
    return renderCanvas();
  }
  if (el.id === 'part-name') {
    checkpoint();
    pt.name = el.value.trim() || pt.name;
  } else if (el.id === 'part-parent') {
    checkpoint();
    pt.parent = el.value || null;
  } else if (el.id === 'part-z') {
    checkpoint();
    pt.z = Math.round((+el.value || 0) * 2) / 2;
  } else return;
  el.blur();
  renderAll();
});

// ---------- animation ----------

const activeClip = (): Clip | null => state.clips[state.clip] ?? null;
const currentPose = () => {
  const c = activeClip();
  return c ? evalClip(c, state.time) : null;
};
const keyTime = () => snapTime(state.time);
const fmtTime = (t: number) => `${t.toFixed(2)} s`;
const round = (n: number, d = 2) => +n.toFixed(d);

/** Onion skin: the pose a few frames before and after the playhead (none while playing). */
const ONION_FRAMES = 3;
function onionPoses() {
  const c = activeClip();
  if (!state.onion || state.playing || !c) return null;
  const d = ONION_FRAMES / FPS;
  const clamp = (t: number) => (c.loop ? t : Math.max(0, Math.min(c.duration, t)));
  return [evalClip(c, clamp(state.time - d)), evalClip(c, clamp(state.time + d))];
}

function syncPreview() {
  preview3d.setPose(currentPose());
  preview3d.setOnion(onionPoses());
}

function setTime(t: number) {
  const c = activeClip();
  state.time = c ? Math.max(0, Math.min(c.duration, t)) : 0;
  syncPreview();
  renderPlaybar();
  renderPose();
}

let playFrame = 0;
let lastTick = 0;

function play() {
  const c = activeClip();
  if (!c) return;
  if (viewMode === '2d') setView('split');
  if (!c.loop && state.time >= c.duration) state.time = 0;
  state.playing = true;
  preview3d.setOnion(null);
  lastTick = performance.now();
  const tick = (now: number) => {
    if (!state.playing) return;
    const clip = activeClip();
    if (!clip) return stop();
    state.time += (now - lastTick) / 1000;
    lastTick = now;
    if (clip.loop) state.time %= clip.duration;
    else if (state.time >= clip.duration) {
      state.time = clip.duration;
      stop();
    }
    preview3d.setPose(currentPose());
    renderPlaybar();
    refreshPoseFields();
    if (state.playing) playFrame = requestAnimationFrame(tick);
  };
  playFrame = requestAnimationFrame(tick);
  renderPlaybar();
}

function stop() {
  state.playing = false;
  cancelAnimationFrame(playFrame);
  // land on a frame, so editing keys there lines up
  setTime(snapTime(state.time));
}

const togglePlay = () => (state.playing ? stop() : play());

function stepFrame(d: number) {
  if (state.playing) stop();
  setTime(snapTime(state.time + d / FPS));
}

function addClip() {
  checkpoint();
  const n = state.clips.length + 1;
  let name = n === 1 ? 'idle' : `clip${n}`;
  for (let i = 2; state.clips.some((c) => c.name === name); i++) name = `clip${n}_${i}`;
  state.clips.push(newClip(name));
  state.clip = state.clips.length - 1;
  state.time = 0;
  renderAll();
}

function deleteClip() {
  if (!activeClip()) return;
  stop();
  checkpoint();
  state.clips.splice(state.clip, 1);
  state.clip = Math.min(state.clip, state.clips.length - 1);
  state.time = 0;
  renderAll();
}

/** Key one component of the active part's pose at the playhead. */
function keyValue(prop: Prop, axis: 0 | 1 | 2, value: number) {
  const c = activeClip();
  if (!c) return;
  if (state.playing) stop();
  checkpoint();
  releasePresets(c, activePart().id, [prop]);
  setKey(c, activePart().id, prop, keyTime(), axis, value, state.keyEase);
  syncPreview();
  renderPlaybar();
  renderPose();
}

/** Key all three properties of the active part as they are now, so a pose holds from here. */
function keyWholePose() {
  const c = activeClip();
  if (!c) return;
  checkpoint();
  releasePresets(c, activePart().id);
  const pose = currentPose()?.get(activePart().id);
  for (const prop of ['rotation', 'position', 'scale'] as Prop[]) {
    const v = pose?.[prop] ?? REST[prop];
    for (const axis of [0, 1, 2] as const) setKey(c, activePart().id, prop, keyTime(), axis, v[axis], state.keyEase);
  }
  renderAll();
}

function deleteKeysHere() {
  const c = activeClip();
  if (!c) return;
  checkpoint();
  releasePresets(c, activePart().id);
  deleteKeysAt(c, activePart().id, keyTime());
  renderAll();
}

function jumpKey(dir: 1 | -1) {
  const c = activeClip();
  if (!c) return;
  const times = keyTimes(c, activePart().id);
  const t = keyTime();
  const next = dir > 0 ? times.find((k) => k > t + 1e-6) : [...times].reverse().find((k) => k < t - 1e-6);
  if (next !== undefined) setTime(next);
}

// ticks sit in the track inset by PB_PAD on each side; the head and scrubbing use the same span
const PB_PAD = 8;
const headAt = (f: number) => `calc(${PB_PAD}px + (100% - ${PB_PAD * 2}px) * ${f})`;

function renderPlaybar() {
  const bar = $('playbar');
  const c = activeClip();
  if (!bar.dataset.built) {
    bar.dataset.built = '1';
    bar.innerHTML = `
      <button id="pb-play" class="icon" title="Play / pause (Space)"></button>
      <select id="pb-clip" title="Clip"></select>
      <div class="pb-track" id="pb-track"><div class="pb-ticks" id="pb-ticks"></div><div class="pb-head" id="pb-head"></div></div>
      <span class="pb-time mono" id="pb-time"></span>
      <button id="pb-onion" class="pb-toggle" title="Onion skin: show the pose ${ONION_FRAMES} frames before (red) and after (blue) the playhead">Onion</button>
      <button id="pb-keys" class="pb-toggle" title="Show the dope sheet: every part's keys over time">Keys ▴</button>`;
  }
  $('pb-onion').classList.toggle('active', state.onion);
  $('pb-keys').classList.toggle('active', dopeOpen);
  $('pb-keys').textContent = dopeOpen ? 'Keys ▾' : 'Keys ▴';
  renderDope();
  $('pb-play').textContent = state.playing ? '❚❚' : '▶';
  $<HTMLButtonElement>('pb-play').disabled = !c;
  const sel = $<HTMLSelectElement>('pb-clip');
  const opts =
    (state.clips.length ? '' : `<option value="" disabled>No clips</option>`) +
    state.clips.map((o, i) => `<option value="${i}"${i === state.clip ? ' selected' : ''}>${escapeHtml(o.name)}${o.loop ? ' ⟳' : ''}</option>`).join('') +
    `<option value="new">+ New clip</option>`;
  if (sel.innerHTML !== opts) sel.innerHTML = opts;
  sel.value = c ? String(state.clip) : '';
  const track = $('pb-track');
  track.classList.toggle('disabled', !c);
  if (!c) {
    $('pb-ticks').innerHTML = '';
    $('pb-head').style.left = headAt(0);
    $('pb-time').textContent = 'No clip';
    return;
  }
  const mine = new Set(keyTimes(c, activePart().id));
  const ticks = keyTimes(c)
    .map((t) => `<span class="pb-tick${mine.has(t) ? ' mine' : ''}" style="left:${(t / c.duration) * 100}%" data-t="${t}" title="${fmtTime(t)}"></span>`)
    .join('');
  if ($('pb-ticks').innerHTML !== ticks) $('pb-ticks').innerHTML = ticks;
  $('pb-head').style.left = headAt(state.time / c.duration);
  $('pb-time').textContent = `${fmtTime(state.time)} / ${fmtTime(c.duration)} · f${Math.round(state.time * FPS)}`;
}

/** Hand-editing a preset's keys turns that preset into plain keys first. */
function releasePresets(c: Clip, part: string, props?: Prop[]) {
  const ids = new Set(c.tracks.filter((tr) => tr.part === part && tr.preset && (!props || props.includes(tr.prop))).map((tr) => tr.preset!));
  for (const id of ids) {
    const use = c.presets?.find((u) => u.id === id);
    customisePreset(c, id);
    if (use) flash(`${PRESETS[use.preset].name} is now plain keys, so you can edit them.`);
  }
}

/** Where a pivot spot falls on a part: the middle or an edge of its tiles. */
function pivotSpot(pt: Part, spot: PivotSpot): [number, number] {
  const { x: w, y: h } = state.project.size;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let x = 0; x < w; x++)
    for (let y = 0; y < h; y++)
      if (pt.tiles[x * h + y].color >= 0) (minX = Math.min(minX, x)), (minY = Math.min(minY, y)), (maxX = Math.max(maxX, x + 1)), (maxY = Math.max(maxY, y + 1));
  if (minX === Infinity) return [w / 2, h / 2];
  const snap = (v: number) => Math.round(v * 2) / 2;
  const cx = snap((minX + maxX) / 2);
  const cy = snap((minY + maxY) / 2);
  return { centre: [cx, cy], top: [cx, minY], bottom: [cx, maxY], left: [minX, cy], right: [maxX, cy] }[spot] as [number, number];
}

function uniqueClipName(base: string) {
  let name = base;
  for (let i = 2; state.clips.some((c) => c.name === name); i++) name = `${base}${i}`;
  return name;
}

/** Add a preset to the active part, in the current clip or a new one, and play it. */
function addPresetToClip(id: PresetId) {
  const def = PRESETS[id];
  stop();
  checkpoint();
  let c = activeClip();
  const base = def.name.toLowerCase(); // "walk", "spin", ...
  if (!c) {
    state.clips.push((c = newClip(uniqueClipName(base))));
    state.clip = state.clips.length - 1;
  }
  const fresh = !c.tracks.length;
  if (fresh) {
    c.duration = def.length;
    // an untouched default name takes the preset's name
    if (/^(idle|clip\d+(_\d+)?)$/.test(c.name)) c.name = uniqueClipName(base);
  }
  const rig = ctx();
  // creature presets belong to the whole rig and hang off its body (or root) part
  const part = def.template ? partById(rig.part('body') ?? null) ?? state.parts.find((o) => !o.parent) ?? activePart() : activePart();
  const use = addPreset(c, id, part.id, rig);
  if (fresh || c.presets!.length === 1) c.loop = def.loops(use.params);
  state.time = 0;
  renderAll();
  play();
  if (def.template) {
    const missing = (def.roles ?? []).filter((r) => !rig.part(r)).map((r) => roleLabel(def.template!, r).toLowerCase());
    flash(`${TEMPLATES[def.template].name.replace(/ \(.*/, '')} ${def.name.toLowerCase()} added.${missing.length ? ` No part for: ${missing.join(', ')} (set roles in Parts).` : ''}`);
    return;
  }
  const at = pivotSpot(part, def.pivot);
  const off = part.pivot[0] !== at[0] || part.pivot[1] !== at[1];
  flash(`${def.name} added to ${part.name}.${off ? ` Its pivot usually goes at the ${def.pivotHint}: use the pivot buttons on the card.` : ''}`);
}

/** A slider's value with its unit, singular for exactly 1 ("1 tile"). */
const paramText = (v: number | string, unit = '') => `${v}${+v === 1 ? unit.replace(/s$/, '') : unit}`;

function presetCard(c: Clip, use: PresetUse) {
  const def = PRESETS[use.preset];
  const pt = partById(use.part);
  const spots: [PivotSpot, string, string][] = [
    ['centre', '·', 'Centre'],
    ['top', '↑', 'Top edge'],
    ['bottom', '↓', 'Bottom edge'],
    ['left', '←', 'Left edge'],
    ['right', '→', 'Right edge'],
  ];
  const at = (spot: PivotSpot) => (pt ? pivotSpot(pt, spot) : [0, 0]);
  const here = (spot: PivotSpot) => pt && at(spot)[0] === pt.pivot[0] && at(spot)[1] === pt.pivot[1];
  const params = def.params
    .map((p) => {
      const v = use.params[p.key];
      if (p.kind === 'select')
        return `<label>${p.label} <select data-use="${use.id}" data-param="${p.key}">${p.options!
          .map(([o, l]) => `<option value="${o}"${o === v ? ' selected' : ''}>${l}</option>`)
          .join('')}</select></label>`;
      return `<label class="slider">${p.label} <span class="mono" data-val="${use.id}-${p.key}">${paramText(v, p.unit)}</span>
        <input type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${v}" data-use="${use.id}" data-param="${p.key}" /></label>`;
    })
    .join('');
  if (def.template) {
    const rig = ctx();
    const used = (def.roles ?? []).filter((r) => rig.part(r));
    const missing = (def.roles ?? []).filter((r) => !rig.part(r));
    const names = (roles: string[]) => roles.map((r) => escapeHtml(roleLabel(def.template!, r))).join(', ');
    return `<div class="preset-card">
    <div class="preset-head"><span class="preset-icon">${def.icon}</span><b>${def.name}</b><span class="hint">${escapeHtml(TEMPLATES[def.template].name.replace(/ \(.*/, ''))}</span>
      <button class="small" data-use-custom="${use.id}" title="Turn into plain keys you can edit by hand">Customise</button>
      <button class="icon small" data-use-remove="${use.id}" title="Remove this preset and its keys">×</button></div>
    ${params}
    <p class="hint">Moves ${names(used) || 'nothing yet'}.${missing.length ? ` No part for ${names(missing)}.` : ''} Check each joint's pivot with the Pivot tool.</p>
  </div>`;
  }
  return `<div class="preset-card">
    <div class="preset-head"><span class="preset-icon">${def.icon}</span><b>${def.name}</b><span class="hint">${escapeHtml(pt?.name ?? '?')}</span>
      <button class="small" data-use-custom="${use.id}" title="Turn into plain keys you can edit by hand">Customise</button>
      <button class="icon small" data-use-remove="${use.id}" title="Remove this preset and its keys">×</button></div>
    ${params}
    <div class="pivot-row" title="Pivot: the point the part ${use.preset === 'bob' ? 'moves with' : 'turns or grows around'}. Usually the ${def.pivotHint}.">
      <span class="label">Pivot</span>${spots
        .map(([s, icon, label]) => `<button class="small${s === def.pivot ? ' suggested' : ''}${here(s) ? ' active' : ''}" data-use-pivot="${use.id}" data-spot="${s}" title="${label}${s === def.pivot ? ' (suggested)' : ''}">${icon}</button>`)
        .join('')}
    </div>
  </div>`;
}

const presetGrid = (list: PresetDef[]) =>
  `<div class="preset-grid">${list.map((d) => `<button data-preset-add="${d.id}" title="${escapeHtml(d.help)}"><span class="preset-icon">${d.icon}</span>${d.name}</button>`).join('')}</div>`;

/** Creature presets for the rig's template, then the single-part presets. */
function presetButtons() {
  const kind = state.template.kind;
  const creature = kind
    ? `<h3>${escapeHtml(TEMPLATES[kind].name.replace(/ \(.*/, ''))} <span class="hint">whole rig</span></h3>${presetGrid(presetsFor(kind))}`
    : `<p class="hint">For walk, run and other creature motions, pick a rig template in Parts.</p>`;
  return `${creature}<h3>${escapeHtml(activePart().name)} <span class="hint">this part</span></h3>${presetGrid(PRESET_LIST)}`;
}

/** While playing, update only the numbers: rebuilding the panel every frame would swallow clicks. */
function refreshPoseFields() {
  const host = $('anim');
  const pose = currentPose()?.get(activePart().id);
  host.querySelectorAll<HTMLInputElement>('input[data-prop]').forEach((i) => {
    if (i === document.activeElement) return;
    i.value = String(round((pose?.[i.dataset.prop as Prop] ?? REST[i.dataset.prop as Prop])[+i.dataset.axis!]));
  });
  const title = host.querySelector('#pose-title');
  if (title) title.textContent = `${activePart().name} at ${fmtTime(keyTime())}`;
}

function poseInputs(prop: Prop, label: string, v: Vec3, keyed: boolean, step: number, title: string) {
  const axes = ['X', 'Y', 'Z'];
  return `<div class="pose-row${keyed ? ' keyed' : ''}" title="${title}"><span class="label">${label}</span>${v
    .map((n, i) => `<label class="pose-axis"><span>${axes[i]}</span><input type="number" step="${step}" data-prop="${prop}" data-axis="${i}" value="${round(n)}" /></label>`)
    .join('')}</div>`;
}

function renderPose() {
  const host = $('anim');
  if (host.contains(document.activeElement) && document.activeElement?.matches('input:not([type=checkbox])')) return;
  const c = activeClip();
  if (!c) {
    host.innerHTML = `<p class="hint">A clip is one animation, like walk or spin. Start from a preset for ${escapeHtml(activePart().name)}, or make an empty clip and key poses yourself. Clips export inside the GLB.</p>
      ${presetButtons()}
      <button id="anim-new" class="wide">+ Empty clip</button>`;
    return;
  }
  const part = activePart();
  const pose = currentPose()?.get(part.id);
  const at = keyTime();
  const keys = keysAt(c, part.id, at);
  const keyedProp = (prop: Prop) => !!findTrack(c, part.id, prop)?.keys.some((k) => Math.abs(k.t - at) < 1e-6);
  host.innerHTML = `
    <div class="row tight"><input id="clip-name" class="grow" value="${escapeHtml(c.name)}" spellcheck="false" title="Clip name" />
      <button id="clip-delete" class="icon small" title="Delete this clip">×</button></div>
    <div class="row">
      <label class="inline">Length <input id="clip-duration" type="number" min="0.05" step="0.05" value="${round(c.duration, 3)}" /> s</label>
      <label class="check inline" title="Loops play seamlessly: after the last key the pose eases back into the first"><input id="clip-loop" type="checkbox"${c.loop ? ' checked' : ''} /> Loop</label>
    </div>
    ${presetButtons()}
    ${(c.presets ?? []).map((u) => presetCard(c, u)).join('')}
    <h3><span id="pose-title">${escapeHtml(part.name)} at ${fmtTime(at)}</span>${keys.length ? ' <span class="badge">key</span>' : ''}</h3>
    ${poseInputs('rotation', 'Rotate°', pose?.rotation ?? REST.rotation, keyedProp('rotation'), 5, 'Degrees about each axis. Z swings a part in a side view.')}
    ${poseInputs('position', 'Move', pose?.position ?? REST.position, keyedProp('position'), 0.25, 'Offset in tiles. +Y is up.')}
    ${poseInputs('scale', 'Scale', pose?.scale ?? REST.scale, keyedProp('scale'), 0.1, '1 is normal size.')}
    <div id="curve-editor" class="curve-editor"></div>
    <div class="btn-grid">
      <button id="key-prev" title="Previous key of this part">◀ Key</button>
      <button id="key-next" title="Next key of this part">Key ▶</button>
      <button id="key-pose" title="Key rotation, position and scale as they are now">Key pose</button>
      <button id="key-delete"${keys.length ? '' : ' disabled'} title="Delete this part's keys at the playhead">Delete key</button>
    </div>`;
  renderCurve();
}

$('playbar').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (b?.id === 'pb-play') togglePlay();
  else if (b?.id === 'pb-onion') {
    state.onion = !state.onion;
    syncPreview();
    renderPlaybar();
  } else if (b?.id === 'pb-keys') {
    dopeOpen = !dopeOpen;
    try {
      localStorage.setItem('3dpixel.dopesheet', dopeOpen ? '1' : '');
    } catch {}
    renderPlaybar();
    fitScale();
    renderCanvas();
  }
});
$('playbar').addEventListener('change', (e) => {
  const sel = e.target as HTMLSelectElement;
  if (sel.id !== 'pb-clip') return;
  const value = sel.value; // read first: stopping redraws the bar
  stop();
  if (value === 'new') return addClip();
  state.clip = +value;
  state.time = 0;
  state.keySel.clear();
  renderAll();
});
$('playbar').addEventListener('pointerdown', (e) => {
  const track = (e.target as HTMLElement).closest<HTMLElement>('#pb-track');
  const c = activeClip();
  if (!track || !c) return;
  if (state.playing) stop();
  const tick = (e.target as HTMLElement).closest<HTMLElement>('.pb-tick');
  if (tick) return setTime(+tick.dataset.t!);
  const seek = (ev: PointerEvent) => {
    const r = track.getBoundingClientRect();
    setTime(snapTime(((ev.clientX - r.left - PB_PAD) / (r.width - PB_PAD * 2)) * c.duration));
  };
  track.setPointerCapture(e.pointerId);
  seek(e);
  const move = (ev: PointerEvent) => seek(ev);
  const up = () => {
    track.removeEventListener('pointermove', move);
    track.removeEventListener('pointerup', up);
  };
  track.addEventListener('pointermove', move);
  track.addEventListener('pointerup', up);
});

const animHost = $('anim');
animHost.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('button');
  const c = activeClip();
  if (b?.dataset.presetAdd) return addPresetToClip(b.dataset.presetAdd as PresetId);
  if (c && b?.dataset.useCustom) {
    checkpoint();
    customisePreset(c, b.dataset.useCustom);
    flash('The preset is now plain keys. Edit them in the pose fields below.');
    return renderAll();
  }
  if (c && b?.dataset.useRemove) {
    checkpoint();
    removePreset(c, b.dataset.useRemove);
    setTime(state.time);
    return renderAll();
  }
  if (c && b?.dataset.usePivot) {
    const pt = partById(c.presets?.find((u) => u.id === b.dataset.usePivot)?.part ?? null);
    if (!pt) return;
    checkpoint();
    pt.pivot = pivotSpot(pt, b.dataset.spot as PivotSpot);
    return renderAll();
  }
  switch (b?.id) {
    case 'anim-new':
      return addClip();
    case 'clip-delete':
      return deleteClip();
    case 'key-prev':
      return jumpKey(-1);
    case 'key-next':
      return jumpKey(1);
    case 'key-pose':
      return keyWholePose();
    case 'key-delete':
      return deleteKeysHere();
  }
});
/** Slider drags make one undo step: checkpoint on the first input, reset on change. */
let presetDrag = false;
function setPresetParam(el: HTMLInputElement | HTMLSelectElement, live: boolean) {
  const c = activeClip();
  const use = c?.presets?.find((u) => u.id === el.dataset.use);
  if (!c || !use) return;
  if (!presetDrag) checkpoint();
  presetDrag = live;
  const def = PRESETS[use.preset];
  const p = def.params.find((o) => o.key === el.dataset.param)!;
  use.params[p.key] = p.kind === 'range' ? +el.value : el.value;
  applyPreset(c, use, ctx());
  if (c.presets!.length === 1) c.loop = def.loops(use.params);
  const label = animHost.querySelector(`[data-val="${use.id}-${p.key}"]`);
  if (label) label.textContent = paramText(use.params[p.key], p.unit);
  if (!state.playing) play();
  preview3d.setPose(currentPose());
  renderPlaybar();
}
animHost.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.dataset.use && el.type === 'range') setPresetParam(el, true);
});

animHost.addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement;
  const c = activeClip();
  if (!c || el.matches('.ce-select')) return; // the curve editor handles its own menu
  if (el.dataset.use) {
    setPresetParam(el, false);
    el.blur();
    return renderAll();
  }
  if (el.dataset.prop) {
    el.blur();
    return keyValue(el.dataset.prop as Prop, +el.dataset.axis! as 0 | 1 | 2, +el.value || 0);
  }
  checkpoint();
  if (el.id === 'clip-name') c.name = el.value.trim().replace(/\s+/g, '_') || c.name;
  else if (el.id === 'clip-duration') {
    c.duration = Math.max(1 / FPS, round(+el.value || c.duration, 3));
    refreshPresets(c, ctx()); // presets stretch to the new length
  }
  else if (el.id === 'clip-loop') c.loop = el.checked;
  el.blur();
  setTime(state.time);
  renderAll();
});

// ---------- dope sheet, curve editor, posing in 3D ----------

let dopeOpen = false;
try {
  dopeOpen = localStorage.getItem('3dpixel.dopesheet') === '1';
} catch {}

function renderDope() {
  const host = $('dopesheet');
  host.classList.toggle('hidden', !dopeOpen);
  if (!dopeOpen) return;
  if (state.playing) return moveDopeHead(host, activeClip(), state.time);
  renderDopeSheet(host, {
    clip: activeClip(),
    rows: treeOrder(state.parts).map((part) => ({ part, depth: partDepth(part) })),
    active: activePart().id,
    time: state.time,
    selected: state.keySel,
    expanded: state.expanded,
  });
}

/** Keys the curve editor and Delete act on: the dope sheet selection, else the active part's keys at the playhead. */
function targetKeys(): { part: string; prop: Prop; key: Key }[] {
  const c = activeClip();
  if (!c) return [];
  const want = state.keySel.size
    ? [...state.keySel].map(parseKeyId)
    : c.tracks.filter((tr) => tr.part === activePart().id).map((tr) => ({ part: tr.part, prop: tr.prop, t: keyTime() }));
  return want.flatMap(({ part, prop, t }) => {
    const key = findTrack(c, part, prop)?.keys.find((k) => Math.abs(k.t - t) < 1e-4);
    return key ? [{ part, prop, key }] : [];
  });
}

function curveTarget(): { ease: Ease | null; title: string } {
  const keys = targetKeys();
  if (!keys.length) return { ease: state.keyEase, title: 'Ease for new keys' };
  const first = keys[0].key.ease;
  const same = keys.every((k) => k.key.ease === first);
  const title = state.keySel.size
    ? `Ease from ${keys.length} selected key${keys.length === 1 ? '' : 's'}`
    : `Ease from this key to the next`;
  return { ease: same ? first : null, title };
}

function renderCurve() {
  const host = document.getElementById('curve-editor');
  if (!host) return;
  const { ease, title } = curveTarget();
  renderCurveEditor(host, ease, title);
}

let curveDrag = false;
bindCurveEditor(animHost, () => curveTarget().ease, {
  change(e, live) {
    const c = activeClip();
    const keys = targetKeys();
    state.keyEase = e;
    if (c && keys.length) {
      if (!curveDrag) {
        checkpoint();
        for (const k of keys) releasePresets(c, k.part, [k.prop]);
      }
      curveDrag = live;
      // releasing presets rebuilt nothing, but find the keys again in case tracks were replaced
      for (const k of targetKeys()) k.key.ease = e;
      syncPreview();
    }
    renderCurve();
    if (!live) renderDope();
  },
});

function selectKeys(ids: string[], add: boolean) {
  if (!add) state.keySel = new Set(ids);
  else if (ids.every((id) => state.keySel.has(id))) ids.forEach((id) => state.keySel.delete(id));
  else ids.forEach((id) => state.keySel.add(id));
  renderDope();
  renderCurve();
}

/** Move the selected keys in time; a moved key replaces any key already at its new time. */
function moveSelectedKeys(dt: number) {
  const c = activeClip();
  if (!c || !state.keySel.size) return;
  checkpoint();
  const moving = [...state.keySel].map(parseKeyId);
  for (const m of moving) releasePresets(c, m.part, [m.prop]);
  const picked: { tr: Track; key: Key }[] = [];
  for (const m of moving) {
    const tr = findTrack(c, m.part, m.prop);
    const key = tr?.keys.find((k) => Math.abs(k.t - m.t) < 1e-4);
    if (tr && key) picked.push({ tr, key });
  }
  for (const { tr, key } of picked) tr.keys = tr.keys.filter((k) => k !== key);
  state.keySel.clear();
  for (const { tr, key } of picked) {
    key.t = Math.max(0, Math.min(c.duration, snapTime(key.t + dt)));
    tr.keys = tr.keys.filter((k) => Math.abs(k.t - key.t) >= 1e-4 || picked.some((p) => p.key === k));
    tr.keys.push(key);
    tr.keys.sort((a, b) => a.t - b.t);
    state.keySel.add(keyId(tr.part, tr.prop, key.t));
  }
  setTime(state.time + dt);
  renderAll();
}

function deleteSelectedKeys() {
  const c = activeClip();
  if (!c || !state.keySel.size) return;
  checkpoint();
  for (const m of [...state.keySel].map(parseKeyId)) {
    releasePresets(c, m.part, [m.prop]);
    const tr = findTrack(c, m.part, m.prop);
    if (tr) tr.keys = tr.keys.filter((k) => Math.abs(k.t - m.t) >= 1e-4);
  }
  c.tracks = c.tracks.filter((tr) => tr.keys.length);
  const n = state.keySel.size;
  state.keySel.clear();
  flash(`Deleted ${n} key${n === 1 ? '' : 's'}`);
  renderAll();
}

const selectPartById = (id: string) => {
  const i = state.parts.findIndex((o) => o.id === id);
  if (i >= 0 && i !== state.active) selectPart(i);
};

bindDopeSheet($('dopesheet'), activeClip, {
  seek: (t) => {
    if (state.playing) stop();
    setTime(t);
  },
  selectPart: selectPartById,
  select: selectKeys,
  move: moveSelectedKeys,
  keyPose: (part, t) => {
    selectPartById(part);
    setTime(t);
    keyWholePose();
  },
  toggle: (part) => {
    if (!state.expanded.delete(part)) state.expanded.add(part);
    renderDope();
  },
});

// pose mode: drag a part in the 3D view to rotate it about its pivot, Shift-drag to move it
let poseStart: { part: string; rot: number; pos: [number, number] } | null = null;
function setPoseMode(on: boolean) {
  state.poseMode = on;
  preview3d.poseMode = on;
  $('btn-pose').classList.toggle('active', on);
  if (on) flash('Pose mode: drag a part to rotate it, Shift-drag to move it. Each drag keys the pose at the playhead.');
}
$('btn-pose').addEventListener('click', () => setPoseMode(!state.poseMode));
function bindPosing() {
  preview3d.onPick = selectPartById;
  preview3d.onPoseDrag = (d) => {
    if (d.phase === 'start') {
      if (state.playing) stop();
      checkpoint();
      if (!activeClip()) {
        state.clips.push(newClip(uniqueClipName('pose')));
        state.clip = state.clips.length - 1;
      }
      selectPartById(d.partId);
      const pose = currentPose()?.get(d.partId);
      poseStart = { part: d.partId, rot: pose?.rotation[2] ?? 0, pos: [pose?.position[0] ?? 0, pose?.position[1] ?? 0] };
      releasePresets(activeClip()!, d.partId, [d.kind === 'rotate' ? 'rotation' : 'position']);
      return;
    }
    const c = activeClip();
    if (!c || !poseStart) return;
    if (d.phase === 'move') {
      if (d.kind === 'rotate') setKey(c, poseStart.part, 'rotation', keyTime(), 2, Math.round((poseStart.rot + d.angle) * 2) / 2, state.keyEase);
      else {
        const snap = (v: number) => Math.round(v * 8) / 8;
        setKey(c, poseStart.part, 'position', keyTime(), 0, snap(poseStart.pos[0] + d.delta[0]), state.keyEase);
        setKey(c, poseStart.part, 'position', keyTime(), 1, snap(poseStart.pos[1] + d.delta[1]), state.keyEase);
      }
      syncPreview();
      refreshPoseFields();
      renderPlaybar();
      return;
    }
    poseStart = null;
    renderAll();
  };
}

// ---------- animation export: sprite sheets, PNG frames, GIFs ----------

interface AnimOut {
  which: 'this' | 'all';
  view: FrameView;
  size: number;
  fps: number;
  smooth: boolean;
  transparent: boolean;
  layout: SheetLayout;
}
const animOut: AnimOut = { which: 'all', view: 'front', size: 128, fps: 12, smooth: true, transparent: true, layout: 'rows' };
try {
  Object.assign(animOut, JSON.parse(localStorage.getItem('3dpixel.animExport') ?? '{}'));
} catch {}

function renderAnimExport() {
  const host = $('anim-export');
  if (host.contains(document.activeElement) && document.activeElement?.matches('input[type=number]')) return;
  const animated = state.clips.filter((c) => c.tracks.length);
  if (!animated.length) {
    host.innerHTML = `<p class="hint">Make an animation clip first. Then export it as a sprite sheet, PNG frames or a GIF.</p>`;
    return;
  }
  const sel = (key: keyof AnimOut, items: [string, string][]) =>
    `<select data-ao="${key}">${items.map(([v, l]) => `<option value="${v}"${String(animOut[key]) === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  const c = activeClip();
  host.innerHTML = `
    <label>Clips ${sel('which', [['this', `This clip${c ? ` (${escapeHtml(c.name)})` : ''}`], ['all', `All ${animated.length} clips`]])}</label>
    <label>View ${sel('view', [['front', 'Flat front: exact colours'], ['angle', 'Three-quarter, lit'], ['camera', 'Current 3D view']])}</label>
    <div class="row tight-top">
      <label class="inline">Frame <input type="number" min="8" max="2048" data-ao="size" value="${animOut.size}" /> px</label>
      <label class="inline">${sel('fps', [['8', '8'], ['12', '12'], ['15', '15'], ['24', '24'], ['30', '30']])} fps</label>
    </div>
    <label class="check"><input type="checkbox" data-ao="smooth"${animOut.smooth ? ' checked' : ''} /> Smooth edges</label>
    <label class="check"><input type="checkbox" data-ao="transparent"${animOut.transparent ? ' checked' : ''} /> Transparent background</label>
    <label>Sheet layout ${sel('layout', [['rows', 'One row per clip'], ['grid', 'Packed grid']])}</label>
    <div class="btn-grid three">
      <button id="ao-sheet" title="One PNG with every frame, plus a JSON of frame positions, durations and clip tags (Aseprite format)">Sheet</button>
      <button id="ao-frames" title="A PNG per frame (a ZIP in the browser)">PNG frames</button>
      <button id="ao-gif" title="An animated GIF per clip">GIF</button>
    </div>
    <p class="hint" id="ao-note"></p>`;
}

function renderFrames() {
  const animated = state.clips.filter((c) => c.tracks.length);
  const clips = animOut.which === 'this' && activeClip()?.tracks.length ? [activeClip()!] : animated;
  if (!clips.length) throw new Error('no animation clips');
  return renderClips(state.project, state.parts, clips, {
    size: animOut.size,
    fps: animOut.fps,
    view: animOut.view,
    smooth: animOut.smooth,
    background: animOut.transparent ? null : settings.bg3d,
    camera: preview3d.cameraInfo(),
  });
}

const PNG: FileType = FORMATS.png;
const JSON_TYPE: FileType = { description: 'JSON', ext: 'json', mime: 'application/json' };

async function exportAnim(kind: 'sheet' | 'frames' | 'gif') {
  commitFloat();
  if (state.playing) stop();
  const note = document.getElementById('ao-note');
  if (note) note.textContent = 'Rendering…';
  await new Promise((r) => setTimeout(r, 20)); // let the note paint
  try {
    const frames = renderFrames();
    const count = frames.reduce((n, f) => n + f.frames.length, 0);
    const base = safeName();
    if (kind === 'sheet') {
      if (platform.isDesktop) {
        const path = await platform.pickSavePath(`${base}-sheet.png`, PNG, state.file?.path);
        if (!path) return;
        const { png, json } = await sheetFiles(frames, animOut.layout, platform.stripExt(platform.basename(path)));
        await platform.writePath(path, png);
        await platform.writePath(platform.stripExt(path) + '.json', json);
        flash(`Exported ${platform.basename(path)} and its .json: ${count} frames`);
      } else {
        const { png, json } = await sheetFiles(frames, animOut.layout, `${base}-sheet`);
        const res = await platform.saveFile(png, `${base}-sheet.png`, PNG);
        if (!res) return;
        const jsonName = res.name.replace(/\.png$/i, '') + '.json';
        await platform.saveFile(new Blob([json], { type: 'application/json' }), jsonName, JSON_TYPE);
        flash(`Exported ${res.name} and ${jsonName}: ${count} frames`);
      }
    } else if (kind === 'frames') {
      const all = frames.flatMap((f) => f.frames.map((c, i) => ({ c, name: frameName(base, f, i) })));
      if (platform.isDesktop) {
        // pick where the first frame goes; the rest go beside it
        const path = await platform.pickSavePath(all[0].name, PNG, state.file?.path);
        if (!path) return;
        const dir = platform.dirname(path);
        const suffix = `_${clipSlug(frames[0].clip.name)}_000`;
        const picked = platform.stripExt(platform.basename(path));
        const chosen = (picked.endsWith(suffix) ? picked.slice(0, -suffix.length) : picked) || base;
        for (const f of frames) for (let i = 0; i < f.frames.length; i++) await platform.writePath(platform.resolvePath(dir, frameName(chosen, f, i)), await canvasBlob(f.frames[i]));
        flash(`Exported ${count} frames to ${platform.basename(dir)}`);
      } else {
        const files = await Promise.all(all.map(async ({ c, name }) => ({ name, data: new Uint8Array(await (await canvasBlob(c)).arrayBuffer()) })));
        await platform.saveFile(zip(files), `${base}-frames.zip`, { description: 'ZIP archive', ext: 'zip', mime: 'application/zip' });
        flash(`Exported ${count} frames as ${base}-frames.zip`);
      }
    } else {
      const gifs = frames.map((f) => ({ name: frames.length === 1 ? `${base}.gif` : `${base}-${clipSlug(f.clip.name)}.gif`, blob: new Blob([gifOf(f) as Uint8Array<ArrayBuffer>], { type: 'image/gif' }) }));
      if (platform.isDesktop) {
        const path = await platform.pickSavePath(gifs[0].name, FORMATS.gif, state.file?.path);
        if (!path) return;
        const dir = platform.dirname(path);
        const picked = platform.stripExt(platform.basename(path));
        const suffix = `-${clipSlug(frames[0].clip.name)}`;
        const stem = gifs.length > 1 && picked.endsWith(suffix) ? picked.slice(0, -suffix.length) : picked;
        if (gifs.length === 1) await platform.writePath(path, gifs[0].blob);
        else for (const [i, g] of gifs.entries()) await platform.writePath(platform.resolvePath(dir, `${stem}-${clipSlug(frames[i].clip.name)}.gif`), g.blob);
        flash(`Exported ${gifs.length} GIF${gifs.length === 1 ? '' : 's'}`);
      } else {
        for (const g of gifs) platform.download(g.blob, g.name);
        flash(`Downloaded ${gifs.map((g) => g.name).join(', ')}`);
      }
    }
  } catch (err: any) {
    flash(`Animation export failed: ${err?.message ?? err}`, true);
  } finally {
    renderAnimExport();
  }
}

const aoHost = $('anim-export');
aoHost.addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement;
  const key = el.dataset.ao as keyof AnimOut | undefined;
  if (!key) return;
  const v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Math.max(8, Math.min(2048, Math.round(+el.value || 128))) : key === 'fps' ? +el.value : el.value;
  (animOut as any)[key] = v;
  try {
    localStorage.setItem('3dpixel.animExport', JSON.stringify(animOut));
  } catch {}
  el.blur();
  renderAnimExport();
});
aoHost.addEventListener('click', (e) => {
  const id = (e.target as HTMLElement).closest('button')?.id;
  if (id === 'ao-sheet') exportAnim('sheet');
  else if (id === 'ao-frames') exportAnim('frames');
  else if (id === 'ao-gif') exportAnim('gif');
});

// ---------- 3D ----------

type ViewMode = '2d' | 'split' | '3d';
const VIEWS: ViewMode[] = ['2d', 'split', '3d'];
const preview3d = new Preview3D($('view3d'));
bindPosing();
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
    if (viewMode === '2d') return;
    preview3d.update(composite(), liveParts(), state.parts.length > 1 ? activePart().id : undefined);
    syncPreview();
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
  const p = flat();
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
      const res = await platform.saveFile(await exportGlb(state.project, opts, state.parts, state.clips), `${safeName()}.glb`, FORMATS.glb);
      if (res) flash(`Exported ${res.name}`);
    } else if (platform.isDesktop) {
      const path = await platform.pickSavePath(`${safeName()}.obj`, FORMATS.obj, state.file?.path);
      if (path) {
        const mtlPath = platform.stripExt(path) + '.mtl';
        const { obj, mtl } = exportObj(state.project, platform.basename(mtlPath), opts, state.parts);
        await platform.writePath(path, obj);
        await platform.writePath(mtlPath, mtl);
        flash(`Exported ${platform.basename(path)} and ${platform.basename(mtlPath)}`);
      }
    } else {
      const { obj, mtl } = exportObj(state.project, `${safeName()}.mtl`, opts, state.parts);
      // the .obj refers to the .mtl by name, so both go to the downloads folder side by side
      platform.download(new Blob([obj], { type: 'text/plain' }), `${safeName()}.obj`);
      platform.download(new Blob([mtl], { type: 'text/plain' }), `${safeName()}.mtl`);
      flash(`Downloaded ${safeName()}.obj and ${safeName()}.mtl`);
    }
  } catch (err: any) {
    flash(`3D export failed: ${err?.message ?? err}`, true);
  }
  renderAll();
});

const ctx = () => rigCtx(state.parts, state.template);

/** Live presets depend on roles, facing and pivots, so rebuild them whenever those may have changed. */
function refreshAllPresets() {
  const c = ctx();
  for (const clip of state.clips) refreshPresets(clip, c);
}

function renderAll() {
  refreshAllPresets();
  fitScale();
  renderCanvas();
  renderPanels();
  renderOptions();
  renderPreview();
  schedule3d();
  renderStats();
}

// ---------- files ----------

const KENSHAPE: FileType = { description: 'Kenney Shape project', ext: 'kenshape', mime: 'application/octet-stream' };
const SVG: FileType = { description: 'SVG image', ext: 'svg', mime: 'image/svg+xml' };
const IMAGE: FileType = { description: 'PNG image', ext: 'png', mime: 'image/png' };

const safeName = () => state.project.title.replace(/[^\w\- ]+/g, '').trim() || 'shape';

async function save(as = false) {
  commitFloat();
  try {
    const blob = await writeKenshape(withRig(withAutoExport(state.project, state.autoExport), state.parts, state.active, state.clips, state.template));
    const prevPath = state.file?.path;
    const res = await platform.saveFile(blob, `${safeName()}.kenshape`, KENSHAPE, as ? null : state.file);
    if (!res) return;
    // export paths are stored relative to the project file, so keep them pointing at the same
    // files when Save as moves the project to another folder
    if (prevPath && res.path && prevPath !== res.path && state.autoExport.targets.length) {
      for (const t of state.autoExport.targets) t.path = storePath(res.path, targetAbsPath(prevPath, t));
      await platform.writePath(res.path, await writeKenshape(withRig(withAutoExport(state.project, state.autoExport), state.parts, state.active, state.clips, state.template)));
    }
    state.file = res;
    state.dirty = false;
    const exported = await exportOnSave();
    flash(`Saved ${res.name}${exported}`, exported.includes('failed'));
  } catch (err: any) {
    flash(`Save failed: ${err?.message ?? err}`, true);
  }
  renderAll();
}

/** Runs the project's export targets; returns a note for the status line. */
async function exportOnSave(force = false): Promise<string> {
  const cfg = state.autoExport;
  const path = state.file?.path;
  if (!platform.isDesktop || !path || !cfg.targets.length || (!cfg.enabled && !force)) return '';
  const res = await runAutoExport(state.project, state.parts, state.clips, path, cfg);
  if (res.errors.length) return ` · export failed: ${res.errors.join('; ')}`;
  return ` · exported ${res.written.length} file${res.written.length === 1 ? '' : 's'}`;
}

async function openFile(file: File, ref: FileRef | null = null) {
  try {
    if (file.name.toLowerCase().endsWith('.svg')) {
      await doImportSvg(await file.text(), file.name);
    } else if (isImage(file.name)) {
      await doImportPng(file, file.name);
    } else {
      setProject(await readKenshape(await file.arrayBuffer()), ref ?? { name: file.name });
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
  showImported(res.project, res.notes);
}

const isImage = (name: string) => /\.(png|gif|webp|bmp)$/i.test(name);

async function doImportPng(blob: Blob, name: string, quiet = false) {
  const colors = $<HTMLSelectElement>('png-colors').value;
  const size = $<HTMLSelectElement>('png-size').value;
  const res = await importPng(blob, {
    size: size === 'pixel' ? 'pixel' : +size,
    trim: $<HTMLInputElement>('png-trim').checked,
    paletteMode: colors === 'project' ? 'project' : 'image',
    palette: state.project.colors,
    maxColors: colors === 'project' ? PALETTE_MAX : +colors,
    depth: $<HTMLSelectElement>('png-depth').value as PngDepth,
    thickness: $<HTMLInputElement>('png-thickness').value.trim() ? clampDepth(+$<HTMLInputElement>('png-thickness').value || 1) : 'auto',
  });
  res.project.title = name.replace(/\.[^.]+$/, '');
  showImported(res.project, quiet ? [] : res.notes);
  return res;
}

// ---------- back and side views ----------

const viewsStatus = (msg: string, error = false) => {
  const el = $('views-status');
  el.textContent = msg;
  el.classList.toggle('error', error);
};

function flatGrid(): Grid {
  commitFloat();
  const p = state.project;
  return { W: p.size.x, H: p.size.y, tiles: flattenTiles(p, state.parts) };
}

/** Change the tiles at these indices in every part that has one there. */
function editTiles(indices: Iterable<number>, fn: (t: Tile, i: number) => void) {
  for (const i of indices) for (const part of state.parts) if (part.tiles[i].color >= 0) fn(part.tiles[i], i);
}

/** Set the back colours, or with null make the back mirror the front again. */
function setBack(colorBack: Map<number, number> | null, colors = state.project.colors) {
  checkpoint();
  state.project.colors = colors;
  if (colorBack) editTiles(colorBack.keys(), (t, i) => (t.colorBack = colorBack.get(i)!));
  else for (const part of state.parts) for (const t of part.tiles) t.colorBack = -1;
  renderAll();
}

function applyBackArt(art: Art): string[] {
  const res = backFromArt(flatGrid(), state.project.colors, art, PALETTE_MAX);
  setBack(res.colorBack, res.colors);
  return ['Gave the back its own colours.', ...res.notes];
}

function applySideArt(art: Art, faces: 'right' | 'left'): string[] {
  const res = depthFromSide(flatGrid(), art, faces);
  checkpoint();
  editTiles(res.depth.keys(), (t, i) => ([t.depth, t.depthBack] = res.depth.get(i)!));
  state.project.depthMultiplier = res.multiplier;
  renderAll();
  return res.notes;
}

async function pickImage(): Promise<Blob | null> {
  if (platform.canPickFile) return (await platform.pickFile([IMAGE]))?.file ?? null;
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.png,.gif,.webp,.bmp';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

/**
 * PixelLab turns the drawing to face `to` (1 generation). The drawing should face the viewer; it's
 * sent cropped to its outline and centred on the smallest square the rotate model takes.
 */
async function turnDrawing(to: Direction): Promise<{ art: Art; usage?: Usage }> {
  const g = flatGrid();
  let x0 = g.W, y0 = g.H, x1 = -1, y1 = -1;
  for (let x = 0; x < g.W; x++)
    for (let y = 0; y < g.H; y++)
      if (g.tiles[x * g.H + y].color >= 0) (x0 = Math.min(x0, x)), (y0 = Math.min(y0, y)), (x1 = Math.max(x1, x)), (y1 = Math.max(y1, y));
  if (x1 < 0) throw new Error('Draw or import something first.');
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const size = ROTATE_SIZES.find((n) => n >= Math.max(w, h));
  if (!size) throw new Error(`PixelLab turns sprites up to ${ROTATE_SIZES.at(-1)}×${ROTATE_SIZES.at(-1)}; this one is ${w}×${h}.`);
  const sq = newProject(size, size);
  sq.colors = state.project.colors;
  const ox = Math.floor((size - w) / 2), oy = Math.floor((size - h) / 2);
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) sq.tiles[(ox + x) * size + oy + y] = g.tiles[(x0 + x) * g.H + y0 + y];
  const { image, usage } = await rotateImage(await exportPng(sq, size, size, { crisp: true }), size, 'south', to);
  return { art: artOf(await decodeImage(image)), usage };
}

/** Run a back or side action with its button disabled, reporting under the buttons. */
async function viewAction(btn: HTMLButtonElement, busy: string, run: () => Promise<string[] | null>) {
  btn.disabled = true;
  viewsStatus(busy);
  try {
    const notes = await run();
    viewsStatus(notes ? notes.join(' ') : '');
  } catch (err: any) {
    viewsStatus(err?.message ?? String(err), true);
  } finally {
    btn.disabled = false;
    refreshPixelLab();
  }
}

$('views-panel').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
  if (!btn) return;
  switch (btn.id) {
    case 'back-generate':
      return viewAction(btn, 'Turning the drawing around… (about 10–30 seconds)', async () => {
        const { art, usage } = await turnDrawing('north');
        return [...applyBackArt(art), `Used ${usageText(usage)}.`];
      });
    case 'back-image':
      return viewAction(btn, '', async () => {
        const blob = await pickImage();
        return blob ? applyBackArt(artOf(await decodeImage(blob))) : null;
      });
    case 'back-simple':
      return viewAction(btn, '', async () => (setBack(simpleBack(flatGrid())), ['Simplified the back: small details like faces and logos are gone.']));
    case 'back-same':
      return viewAction(btn, '', async () => (setBack(null), ['The back mirrors the front again.']));
    case 'side-generate':
      return viewAction(btn, 'Turning the drawing to the side… (about 10–30 seconds)', async () => {
        const { art, usage } = await turnDrawing('east');
        return [...applySideArt(art, 'right'), `Used ${usageText(usage)}.`];
      });
    case 'side-image':
      return viewAction(btn, '', async () => {
        const blob = await pickImage();
        return blob ? applySideArt(artOf(await decodeImage(blob)), $<HTMLSelectElement>('side-faces').value as 'right' | 'left') : null;
      });
  }
});

// ---------- PixelLab: generate and auto-rig ----------

const genStatus = (msg: string, error = false) => {
  const el = $('gen-status');
  el.textContent = msg;
  el.classList.toggle('error', error);
};

/** Show the balance, or how to add a key, under the Generate button. */
async function refreshPixelLab() {
  const key = await getSecret(KEY_NAME).catch(() => null);
  for (const id of ['btn-generate', 'back-generate', 'side-generate']) $<HTMLButtonElement>(id).disabled = !key;
  if (!key) {
    $('gen-status').innerHTML = `Add your PixelLab API key in <button class="link" id="gen-settings">Settings</button> to generate sprites.`;
    return;
  }
  genStatus('');
  getBalance().then((b) => genStatus(balanceText(b)), (err) => genStatus(err.message, true));
}

/** "stone golem with glowing blue crystals" -> "stone-golem-glowing" */
const promptName = (prompt: string) =>
  prompt.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w && !['a', 'an', 'the', 'with', 'and', 'of'].includes(w)).slice(0, 3).join('-') || 'generated';

async function generate() {
  const prompt = $<HTMLTextAreaElement>('gen-prompt').value.trim();
  if (!prompt) return genStatus('Describe what to generate first.', true);
  if (!(await discardOk())) return;
  const btn = $<HTMLButtonElement>('btn-generate');
  const model = $<HTMLSelectElement>('gen-model').value as Model;
  const size = +$<HTMLSelectElement>('gen-size').value;
  btn.disabled = true;
  genStatus('Generating… (about 10–30 seconds)');
  try {
    const usePalette = model === 'pixflux' && $<HTMLInputElement>('gen-palette').checked;
    const { image, usage } = await generateImage({
      model,
      description: prompt,
      width: size,
      height: size,
      view: $<HTMLSelectElement>('gen-view').value as View,
      direction: $<HTMLSelectElement>('gen-direction').value as Direction,
      outline: $<HTMLSelectElement>('gen-outline').value as Outline,
      detail: $<HTMLSelectElement>('gen-detail').value as Detail,
      palette: usePalette ? paletteImage(state.project.colors) : undefined,
    });
    const imported = await doImportPng(image, promptName(prompt), true);
    const notes = [`Generated for ${usageText(usage)}.`, ...imported.notes];
    if ($<HTMLInputElement>('gen-views').checked) {
      genStatus('Turning it around for the back…');
      notes.push(...applyBackArt((await turnDrawing('north')).art));
      genStatus('Turning it to the side for the depth…');
      notes.push(...applySideArt((await turnDrawing('east')).art, 'right'));
    }
    if ($<HTMLInputElement>('gen-rig').checked) {
      genStatus('Finding the skeleton…');
      notes.push(...(await rigFromSkeleton()));
    }
    flash(notes.join(' '));
    genStatus(notes[0]);
    getBalance().then((b) => genStatus(`${notes[0]} ${balanceText(b)}.`), () => {});
  } catch (err: any) {
    genStatus(err?.message ?? String(err), true);
    flash(`Generate failed: ${err?.message ?? err}`, true);
  } finally {
    btn.disabled = false;
  }
}

/** A strip of the palette's colours, as Pixflux's colour reference. */
function paletteImage(colors: string[]): Blob {
  const c = document.createElement('canvas');
  c.width = colors.length;
  c.height = 1;
  const g = c.getContext('2d')!;
  colors.forEach((hex, i) => ((g.fillStyle = hex), g.fillRect(i, 0, 1, 1)));
  const raw = atob(c.toDataURL('image/png').split(',')[1]);
  return new Blob([Uint8Array.from(raw, (ch) => ch.charCodeAt(0))], { type: 'image/png' });
}

/**
 * Ask PixelLab for the drawing's skeleton and split it into biped parts. The whole drawing is
 * sent (every part flattened), so it also re-rigs a model that already has parts.
 */
async function rigFromSkeleton(): Promise<string[]> {
  commitFloat();
  const p = state.project;
  const flat = flattenTiles(p, state.parts);
  if (!flat.some((t) => t.color >= 0)) throw new Error('Draw or import a character first.');
  // the skeleton model takes up to 256×256; keypoints come back as fractions of what we send
  const side = Math.max(p.size.x, p.size.y);
  const scale = side > 256 ? 256 / side : Math.floor(256 / side);
  const png = await exportPng({ ...p, tiles: flat }, Math.max(1, Math.round(p.size.x * scale)), Math.max(1, Math.round(p.size.y * scale)));
  const { keypoints, usage } = await estimateSkeleton(png);
  const res = autoRig(p, flat, keypoints);
  checkpoint();
  if (state.playing) stop();
  state.parts = res.parts;
  state.active = Math.max(0, res.parts.findIndex((pt) => pt.id === 'body'));
  p.tiles = state.parts[state.active].tiles;
  state.template = res.template;
  state.sel.clear();
  renderAll();
  return [...res.notes, `Skeleton: ${usageText(usage)}. Pick Walk, Run or Idle under Animation.`];
}

async function autoRigClicked() {
  const btn = document.getElementById('tpl-autorig') as HTMLButtonElement | null;
  if (btn) btn.disabled = true;
  flash('Finding the skeleton with PixelLab…');
  try {
    flash((await rigFromSkeleton()).join(' '));
  } catch (err: any) {
    flash(`Auto-rig failed: ${err?.message ?? err}`, true);
    renderAll();
  }
}

$('btn-generate').addEventListener('click', generate);
$('gen-prompt').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) generate();
});
$('gen-status').addEventListener('click', (e) => {
  if ((e.target as HTMLElement).id === 'gen-settings') openSettings();
});
const syncGenPalette = () => ($<HTMLInputElement>('gen-palette').disabled = $<HTMLSelectElement>('gen-model').value !== 'pixflux');
$('gen-model').addEventListener('change', syncGenPalette);
syncGenPalette();
window.addEventListener(KEY_EVENT, refreshPixelLab);
refreshPixelLab();

/** Replace the project with an imported one, keeping the old one a step back in undo. */
function showImported(p: Project, notes: string[]) {
  commitFloat();
  const prev = snapshot();
  setProject(p);
  state.undo = [prev];
  state.dirty = true;
  renderAll();
  flash(notes.join(' '));
}

async function pickOpen(accept: 'any' | 'svg' | 'png') {
  if (platform.canPickFile) {
    try {
      const picked = await platform.pickFile(accept === 'svg' ? [SVG] : accept === 'png' ? [IMAGE] : [KENSHAPE, SVG, IMAGE]);
      if (picked) await openFile(picked.file, picked.ref);
    } catch (err: any) {
      flash(String(err?.message ?? err), true);
    }
    return;
  }
  const input = $<HTMLInputElement>('file-input');
  input.accept = accept === 'svg' ? '.svg' : accept === 'png' ? '.png,.gif,.webp,.bmp' : '.kenshape,.svg,.png,.gif,.webp,.bmp';
  input.click();
}

$<HTMLInputElement>('file-input').addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  if (f) openFile(f);
  input.value = '';
});

const discardOk = async () => !state.dirty || platform.confirmDiscard();

$('btn-new').addEventListener('click', async () => {
  if (!(await discardOk())) return;
  const n = +$<HTMLSelectElement>('new-size').value;
  const p = newProject(n);
  p.colors = [...state.project.colors];
  setProject(p);
});
$('btn-open').addEventListener('click', async () => {
  if (await discardOk()) pickOpen('any');
});
$('btn-save').addEventListener('click', () => save());
$('btn-save-as').addEventListener('click', () => save(true));
$('btn-undo').addEventListener('click', undo);
$('btn-redo').addEventListener('click', redo);
$('btn-import-svg').addEventListener('click', () => pickOpen('svg'));
$('btn-import-png').addEventListener('click', () => pickOpen('png'));

// ---------- export on save ----------

const autoExportChanged = () => {
  state.dirty = true;
  renderPanels();
};

function targetOptions(t: ExportTarget, i: number) {
  const sel = (key: string, value: string, items: [string, string][]) =>
    `<select data-target="${i}" data-key="${key}">${items.map(([v, l]) => `<option value="${v}"${v === value ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  switch (t.format) {
    case 'png':
      return `<input type="number" min="1" max="4096" data-target="${i}" data-key="size" value="${t.size ?? 64}" title="Size in pixels" />
        <label class="check" title="No anti-aliasing"><input type="checkbox" data-target="${i}" data-key="crisp"${t.crisp ? ' checked' : ''} /> Crisp</label>`;
    case 'svg':
      return sel('grouping', t.grouping ?? 'shape', [['shape', 'Per tile'], ['color', 'Per colour']]);
    case 'sheet':
    case 'gif':
      return `<input type="number" min="8" max="2048" data-target="${i}" data-key="size" value="${t.size ?? 128}" title="Frame size in pixels" />` +
        sel('fps', String(t.fps ?? 12), [['8', '8 fps'], ['12', '12 fps'], ['15', '15 fps'], ['24', '24 fps'], ['30', '30 fps']]) +
        sel('view', t.view ?? 'front', [['front', 'Flat'], ['angle', '3/4']]);
    default:
      return (
        sel('scale', t.scale ?? 'tile', [['tile', '1 tile = 1'], ['fit', 'Fit in 1']]) +
        sel('pivot', t.pivot ?? 'center', [['center', 'Centre'], ['bottom', 'Bottom']])
      );
  }
}

function renderAutoExport() {
  const host = $('auto-export');
  if (!platform.isDesktop) {
    host.innerHTML = `<p class="hint">In the desktop app, saving can also write GLB, OBJ, PNG, SVG, sprite sheet and GIF files straight into your game's asset folders.</p>`;
    return;
  }
  // skip re-rendering while the user is typing in one of the target fields
  if (host.contains(document.activeElement) && document.activeElement?.matches('input[type=number]')) return;
  const cfg = state.autoExport;
  const path = state.file?.path;
  const rows = cfg.targets
    .map((t, i) => {
      const full = path ? targetAbsPath(path, t) : t.path;
      return `<div class="target">
        <div class="target-head">
          <span class="badge">${FORMATS[t.format].label}</span>
          <span class="target-path" title="${escapeHtml(full)}"><span class="target-file">${escapeHtml(platform.basename(t.path))}</span><span class="target-dir mono">${escapeHtml(platform.dirname(t.path) || '.')}</span></span>
          <button class="icon small" data-target-remove="${i}" title="Remove this target">×</button>
        </div>
        <div class="target-opts">${targetOptions(t, i)}</div>
      </div>`;
    })
    .join('');
  host.innerHTML = `
    <label class="check"><input type="checkbox" id="auto-export-on"${cfg.enabled ? ' checked' : ''} /> Export when saving</label>
    ${rows || `<p class="hint">No targets yet. Add one to write that file every time you save.</p>`}
    <div class="row">
      <select id="auto-export-add" title="Add an export target">
        <option value="">+ Add target</option>
        ${Object.entries(FORMATS).map(([k, f]) => `<option value="${k}">${f.label} · ${f.description}</option>`).join('')}
      </select>
      <button id="auto-export-run"${cfg.targets.length && path ? '' : ' disabled'} title="Write all targets now">Export now</button>
    </div>
    ${path ? '' : `<p class="hint">Save the project first. Target paths are stored relative to the .kenshape file.</p>`}`;
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

async function addTarget(format: TargetFormat) {
  const path = state.file?.path;
  const abs = await platform.pickSavePath(`${safeName()}.${FORMATS[format].ext}`, FORMATS[format], path);
  if (!abs) return;
  // new targets start from the current Export / 3D model panel settings
  const t: ExportTarget = { format, path: storePath(path, abs).replace(/\\/g, '/') };
  if (format === 'png') Object.assign(t, { size: pngSize(), crisp: $<HTMLInputElement>('png-crisp').checked });
  if (format === 'svg') t.grouping = $<HTMLSelectElement>('svg-grouping').value as SvgGrouping;
  if (format === 'glb' || format === 'obj') Object.assign(t, modelOpts());
  if (format === 'sheet' || format === 'gif') Object.assign(t, { size: animOut.size, fps: animOut.fps, view: animOut.view === 'camera' ? 'angle' : animOut.view, layout: animOut.layout });
  state.autoExport.targets.push(t);
  autoExportChanged();
}

const autoHost = $('auto-export');
autoHost.addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement | HTMLSelectElement;
  if (el.id === 'auto-export-on') {
    state.autoExport.enabled = (el as HTMLInputElement).checked;
    return autoExportChanged();
  }
  if (el.id === 'auto-export-add') {
    const format = el.value as TargetFormat;
    el.value = '';
    if (format) addTarget(format);
    return;
  }
  const t = state.autoExport.targets[+(el.dataset.target ?? -1)];
  if (!t) return;
  const key = el.dataset.key!;
  if (key === 'size') t.size = Math.max(1, Math.min(4096, Math.round(+el.value || 64)));
  else if (key === 'fps') t.fps = +el.value || 12;
  else if (key === 'crisp') t.crisp = (el as HTMLInputElement).checked;
  else (t as any)[key] = el.value;
  autoExportChanged();
});
autoHost.addEventListener('click', async (e) => {
  const el = (e.target as HTMLElement).closest('button');
  if (!el) return;
  if (el.dataset.targetRemove) {
    state.autoExport.targets.splice(+el.dataset.targetRemove, 1);
    autoExportChanged();
  } else if (el.id === 'auto-export-run') {
    commitFloat();
    const note = await exportOnSave(true);
    flash(note.replace(/^ · /, '').replace(/^e/, 'E'), note.includes('failed'));
  }
});

const pngSize = () => Math.max(1, Math.min(4096, Math.round(+$<HTMLInputElement>('png-size').value || 64)));
$('png-size').addEventListener('input', renderPreview);
$('png-crisp').addEventListener('change', renderPreview);

$('btn-export-svg').addEventListener('click', async () => {
  commitFloat();
  const grouping = $<HTMLSelectElement>('svg-grouping').value as SvgGrouping;
  const svg = exportSvg(flat(), { grouping, width: state.project.size.x * 16, height: state.project.size.y * 16 });
  const res = await platform.saveFile(new Blob([svg], { type: 'image/svg+xml' }), `${safeName()}.svg`, SVG);
  if (res) flash(`Exported ${res.name}`);
  renderAll();
});
$('btn-export-png').addEventListener('click', async () => {
  commitFloat();
  const size = pngSize();
  const blob = await exportPng(flat(), size, size, { crisp: $<HTMLInputElement>('png-crisp').checked });
  const res = await platform.saveFile(blob, `${safeName()}.png`, FORMATS.png);
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
// the desktop app gets drops from the OS instead, with paths, so Save writes back to the file
platform.onFileDrop(
  async ({ ref, file }) => {
    if (file.name.toLowerCase().endsWith('.svg') || isImage(file.name) || (await discardOk())) openFile(file, ref);
  },
  (on) => wrap.classList.toggle('dragging', on),
);

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
    else if (k === 'o') discardOk().then((ok) => void (ok && pickOpen('any')));
    else if (k === 'a') selectAll();
    else if (k === 'd') deselect();
    else if (k === 'i' && e.shiftKey) invertSelection();
    else if (k === 'c') copySelection();
    else if (k === 'x') copySelection(true);
    else if (k === 'v') paste();
    else if (k === 'j') partFromSelection();
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
    // keys picked in the dope sheet go first; otherwise it's the tile selection
    if (state.keySel.size && dopeOpen) deleteSelectedKeys();
    else deleteSelection();
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
  if (k === ' ') {
    e.preventDefault();
    return togglePlay();
  }
  if (k === ',' || k === '.') return stepFrame(k === '.' ? 1 : -1);
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
  if (state.dirty && !platform.isDesktop) e.preventDefault();
});
platform.guardClose(discardOk);
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
platform.launchFile().then((f) => f && openFile(f.file, f.ref));
