// .kenshape files are gzipped JSON (Unity JsonUtility). See docs/kenshape-format.md.

export const DEFAULT_PALETTE = [
  '#D47D53', '#F7BB8D', '#914D35', '#3A232F',
  '#DD871E', '#FFE051', '#04746B', '#27C67B',
  '#920C38', '#E92A55', '#173D8C', '#2C6DC1',
  '#475C72', '#A1B8D1', '#292D31', '#DDE5EE',
];

export interface Tile {
  shape: number;
  angle: number;
  color: number; // index into colors, -1 = empty
  depth: number;
  colorBack: number;
  depthBack: number;
  [extra: string]: unknown; // unknown keys are kept for round-tripping
}

export interface Project {
  title: string;
  author: string;
  version: string;
  size: { x: number; y: number };
  depthMultiplier: number;
  alignment: number; // 0 front, 1 middle, 2 back
  tiles: Tile[]; // column-major: tiles[x * size.y + y], y = 0 is the top row
  colors: string[];
  [extra: string]: unknown;
}

export const FORMAT_VERSION = '1.5.0';

export function emptyTile(): Tile {
  return { shape: 0, angle: 0, color: -1, depth: 1, colorBack: -1, depthBack: 0 };
}

export function newProject(w = 16, h = w, title = 'Untitled'): Project {
  return {
    title,
    author: '',
    version: FORMAT_VERSION,
    size: { x: w, y: h },
    depthMultiplier: 100,
    alignment: 1,
    tiles: Array.from({ length: w * h }, emptyTile),
    colors: [...DEFAULT_PALETTE],
  };
}

export function tileIndex(p: Project, x: number, y: number): number {
  return x * p.size.y + y;
}

export function getTile(p: Project, x: number, y: number): Tile {
  return p.tiles[tileIndex(p, x, y)];
}

/** Fill in fields that older files (or other tools) may omit. */
export function normalize(raw: Partial<Project>): Project {
  const size = raw.size ?? { x: 16, y: 16 };
  const count = size.x * size.y;
  const tiles = (raw.tiles ?? []).slice(0, count).map((t) => ({ ...emptyTile(), ...t }));
  while (tiles.length < count) tiles.push(emptyTile());
  return {
    ...raw,
    title: raw.title ?? 'Untitled',
    author: raw.author ?? '',
    version: raw.version ?? FORMAT_VERSION,
    size,
    depthMultiplier: raw.depthMultiplier ?? 100,
    alignment: raw.alignment ?? 1,
    tiles,
    colors: raw.colors?.length ? raw.colors : [...DEFAULT_PALETTE],
  };
}

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<ArrayBuffer> {
  const out = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream);
  return new Response(out).arrayBuffer();
}

export async function readKenshape(bytes: ArrayBuffer): Promise<Project> {
  const u8 = new Uint8Array(bytes);
  const isGzip = u8[0] === 0x1f && u8[1] === 0x8b;
  const json = isGzip
    ? new TextDecoder().decode(await pipe(u8, new DecompressionStream('gzip')))
    : new TextDecoder().decode(u8);
  return normalize(JSON.parse(json));
}

export async function writeKenshape(p: Project): Promise<Blob> {
  const json = JSON.stringify({ ...p, version: p.version || FORMAT_VERSION });
  const gz = await pipe(new TextEncoder().encode(json), new CompressionStream('gzip'));
  return new Blob([gz], { type: 'application/octet-stream' });
}

export function cloneProject(p: Project): Project {
  return structuredClone(p);
}
