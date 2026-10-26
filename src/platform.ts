// File access and window integration. In the browser this uses the File System Access API (or
// plain downloads); in the Tauri desktop app it uses native dialogs and real file paths, which is
// what makes export-on-save possible.

import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open as openDialog, save as saveDialog, ask } from '@tauri-apps/plugin-dialog';

export const isDesktop = '__TAURI_INTERNALS__' in window;

/** A file the user opened or saved: a path on desktop, a File System Access handle in the browser. */
export interface FileRef {
  name: string;
  path?: string;
  handle?: any;
}

export interface FileType {
  description: string;
  ext: string; // without the dot
  mime: string;
}

const w = window as any;

// ---------- paths (desktop) ----------

const isAbsolute = (p: string) => /^([a-zA-Z]:)?[\\/]/.test(p);
const sepOf = (p: string) => (p.includes('\\') ? '\\' : '/');
const parts = (p: string) => p.split(/[\\/]+/).filter((s) => s && s !== '.');

export const basename = (p: string) => p.replace(/[\\/]+$/, '').replace(/^.*[\\/]/, '');
export const dirname = (p: string) => {
  const s = p.replace(/[\\/]+$/, '');
  return /[\\/]/.test(s) ? s.replace(/[\\/][^\\/]*$/, '') : '';
};
export const stripExt = (p: string) => p.replace(/\.[^.\\/]*$/, '');

/** `to` relative to the directory `fromDir`, with forward slashes; absolute if on another drive. */
export function relativePath(fromDir: string, to: string): string {
  const a = parts(fromDir);
  const b = parts(to);
  const same = (x: string, y: string) => (sepOf(to) === '\\' ? x.toLowerCase() === y.toLowerCase() : x === y);
  if (!a.length || !b.length || !same(a[0], b[0])) return to;
  let i = 0;
  while (i < a.length && i < b.length && same(a[i], b[i])) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
}

/** Resolve `p` (absolute, or relative to `baseDir`) to an absolute path using baseDir's separator. */
export function resolvePath(baseDir: string, p: string): string {
  if (isAbsolute(p)) return p;
  const sep = sepOf(baseDir);
  const out = parts(baseDir);
  for (const s of parts(p)) {
    if (s === '..') out.pop();
    else out.push(s);
  }
  const lead = baseDir.startsWith('\\\\') ? '\\\\' : baseDir.startsWith('/') ? '/' : '';
  return lead + out.join(sep);
}

// ---------- desktop file IO ----------

export async function readPath(path: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>('read_file', { path });
}

export async function writePath(path: string, data: Blob | string): Promise<void> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(await data.arrayBuffer());
  await invoke('write_file', bytes, { headers: { path: encodeURIComponent(path) } });
}

const filters = (types: FileType[]) => types.map((t) => ({ name: t.description, extensions: [t.ext] }));

/** Native save dialog; returns the chosen path. `near` is a file whose folder to start in. */
export async function pickSavePath(suggested: string, type: FileType, near?: string): Promise<string | null> {
  const defaultPath = near ? resolvePath(dirname(near), suggested) : suggested;
  return saveDialog({ defaultPath, filters: filters([type]) });
}

async function fileFromPath(path: string): Promise<{ ref: FileRef; file: File }> {
  const name = basename(path);
  return { ref: { name, path }, file: new File([await readPath(path)], name) };
}

// ---------- shared API ----------

/** Write `blob`, to `existing` if given, otherwise wherever the user picks. null if cancelled. */
export async function saveFile(blob: Blob, suggested: string, type: FileType, existing?: FileRef | null): Promise<FileRef | null> {
  if (isDesktop) {
    const path = existing?.path ?? (await pickSavePath(suggested, type));
    if (!path) return null;
    await writePath(path, blob);
    return { name: basename(path), path };
  }
  if (typeof w.showSaveFilePicker !== 'function') {
    download(blob, suggested);
    return { name: suggested };
  }
  try {
    const h =
      existing?.handle ??
      (await w.showSaveFilePicker({
        suggestedName: suggested,
        types: [{ description: type.description, accept: { [type.mime]: ['.' + type.ext] } }],
      }));
    const ws = await h.createWritable();
    await ws.write(blob);
    await ws.close();
    return { name: h.name as string, handle: h };
  } catch (err: any) {
    if (err?.name === 'AbortError') return null;
    throw err;
  }
}

/** True when pickFile can show a picker; otherwise use an <input type=file>. */
export const canPickFile = isDesktop || typeof w.showOpenFilePicker === 'function';

export async function pickFile(types: FileType[]): Promise<{ ref: FileRef; file: File } | null> {
  if (isDesktop) {
    const all = { name: types.map((t) => t.description).join(' or '), extensions: types.map((t) => t.ext) };
    const path = await openDialog({ multiple: false, directory: false, filters: types.length > 1 ? [all, ...filters(types)] : filters(types) });
    return path ? fileFromPath(path) : null;
  }
  try {
    const accept: Record<string, string[]> = {};
    for (const t of types) (accept[t.mime] ??= []).push('.' + t.ext);
    const [h] = await w.showOpenFilePicker({ types: [{ description: types.map((t) => t.description).join(' or '), accept }] });
    return { ref: { name: h.name, handle: h }, file: await h.getFile() };
  } catch (err: any) {
    if (err?.name === 'AbortError') return null;
    throw err;
  }
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function confirmDiscard(message = 'Discard unsaved changes?'): Promise<boolean> {
  if (isDesktop) return ask(message, { title: '3dpixel', kind: 'warning', okLabel: 'Discard', cancelLabel: 'Cancel' });
  return confirm(message);
}

let lastTitle = '';
export function setWindowTitle(title: string) {
  if (title === lastTitle) return;
  lastTitle = title;
  document.title = title;
  if (isDesktop) getCurrentWindow().setTitle(title).catch(() => {});
}

/** Ask before the window closes. `allow` resolves false to keep it open. */
export function guardClose(allow: () => Promise<boolean>) {
  if (isDesktop) {
    getCurrentWindow().onCloseRequested(async (e) => {
      if (!(await allow())) e.preventDefault();
    });
  }
}

/** Desktop: the file the app was launched with (double-clicking a .kenshape). */
export async function launchFile(): Promise<{ ref: FileRef; file: File } | null> {
  if (!isDesktop) return null;
  const path = await invoke<string | null>('launch_file');
  return path ? fileFromPath(path) : null;
}

/** Desktop: files dropped on the window, with their paths so Save writes back to them. */
export function onFileDrop(drop: (f: { ref: FileRef; file: File }) => void, hover: (on: boolean) => void) {
  if (!isDesktop) return;
  getCurrentWebview().onDragDropEvent(async (e) => {
    const p = e.payload;
    if (p.type === 'enter' || p.type === 'over') hover(true);
    else if (p.type === 'leave') hover(false);
    else if (p.type === 'drop') {
      hover(false);
      if (p.paths[0]) drop(await fileFromPath(p.paths[0]));
    }
  });
}
