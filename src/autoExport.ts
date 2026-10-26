// Export on save (desktop app): a project can list export targets, and every save rewrites them.
// The list is stored in the .kenshape under `autoExport`, with paths relative to the .kenshape so
// a project folder can move (or be committed) together with its game assets. Kenney Shape ignores
// the extra key, but drops it if it saves the file.

import { Project } from './kenshape';
import { exportSvg, exportPng, SvgGrouping } from './svgExport';
import { exportGlb, exportObj, ModelScale, ModelPivot } from './modelExport';
import { FileType, basename, dirname, relativePath, resolvePath, stripExt, writePath } from './platform';

export type TargetFormat = 'glb' | 'obj' | 'png' | 'svg';

export interface ExportTarget {
  format: TargetFormat;
  /** Relative to the .kenshape's folder (forward slashes), or absolute. */
  path: string;
  size?: number; // png
  crisp?: boolean; // png
  grouping?: SvgGrouping; // svg
  scale?: ModelScale; // glb, obj
  pivot?: ModelPivot; // glb, obj
}

export interface AutoExport {
  enabled: boolean;
  targets: ExportTarget[];
}

export const AUTO_EXPORT_KEY = 'autoExport';

export const FORMATS: Record<TargetFormat, FileType & { label: string }> = {
  glb: { label: 'GLB', description: 'glTF binary', ext: 'glb', mime: 'model/gltf-binary' },
  obj: { label: 'OBJ', description: 'Wavefront OBJ', ext: 'obj', mime: 'text/plain' },
  png: { label: 'PNG', description: 'PNG image', ext: 'png', mime: 'image/png' },
  svg: { label: 'SVG', description: 'SVG image', ext: 'svg', mime: 'image/svg+xml' },
};

export const emptyAutoExport = (): AutoExport => ({ enabled: true, targets: [] });

/** Take the export list out of a loaded project, so undo snapshots and exports don't carry it. */
export function takeAutoExport(p: Project): AutoExport {
  const raw = p[AUTO_EXPORT_KEY] as Partial<AutoExport> | undefined;
  delete p[AUTO_EXPORT_KEY];
  const known = Object.keys(FORMATS);
  const targets = Array.isArray(raw?.targets)
    ? raw!.targets.filter((t): t is ExportTarget => !!t && known.includes(t.format) && typeof t.path === 'string' && !!t.path)
    : [];
  return { enabled: raw?.enabled ?? true, targets };
}

/** The project as written to disk, with the export list put back (omitted when empty). */
export const withAutoExport = (p: Project, cfg: AutoExport): Project =>
  cfg.targets.length ? { ...p, [AUTO_EXPORT_KEY]: cfg } : p;

/** How a chosen absolute path is stored: relative to the project file when there is one. */
export const storePath = (projectPath: string | undefined, abs: string) =>
  projectPath ? relativePath(dirname(projectPath), abs) : abs;

export const targetAbsPath = (projectPath: string, t: ExportTarget) => resolvePath(dirname(projectPath), t.path);

async function render(p: Project, t: ExportTarget, abs: string): Promise<[string, Blob | string][]> {
  const model = { scale: t.scale ?? 'tile', pivot: t.pivot ?? 'center' };
  switch (t.format) {
    case 'glb':
      return [[abs, await exportGlb(p, model)]];
    case 'obj': {
      // the .mtl sits beside the .obj and is referenced by file name
      const mtlPath = stripExt(abs) + '.mtl';
      const { obj, mtl } = exportObj(p, basename(mtlPath), model);
      return [[abs, obj], [mtlPath, mtl]];
    }
    case 'png': {
      const size = t.size ?? 64;
      return [[abs, await exportPng(p, size, size, { crisp: !!t.crisp })]];
    }
    case 'svg':
      return [[abs, exportSvg(p, { grouping: t.grouping ?? 'shape', width: p.size.x * 16, height: p.size.y * 16 })]];
  }
}

export interface ExportResult {
  written: string[];
  errors: string[];
}

export async function runAutoExport(p: Project, projectPath: string, cfg: AutoExport): Promise<ExportResult> {
  const res: ExportResult = { written: [], errors: [] };
  for (const t of cfg.targets) {
    const abs = targetAbsPath(projectPath, t);
    try {
      for (const [path, data] of await render(p, t, abs)) {
        await writePath(path, data);
        res.written.push(path);
      }
    } catch (err: any) {
      res.errors.push(`${basename(abs)}: ${err?.message ?? err}`);
    }
  }
  return res;
}
