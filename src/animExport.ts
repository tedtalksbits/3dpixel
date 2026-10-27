// Turning rendered clip frames into files: a sprite sheet with Aseprite-style JSON (Phaser loads it
// directly, and Godot and other engines have importers), a PNG per frame, or an animated GIF.

import { ClipFrames, canvasBlob } from './frames';
import { encodeGif } from './gif';

export type SheetLayout = 'rows' | 'grid';

/** Clip names as used in file names and frame tags. */
export const clipSlug = (name: string) => name.trim().replace(/\s+/g, '_').replace(/[^\w\-]/g, '') || 'clip';

/** One row per clip (easy to read in an engine), or everything packed into a square-ish grid. */
export function buildSheet(clips: ClipFrames[], layout: SheetLayout, imageName: string) {
  const size = clips[0]?.frames[0]?.width ?? 64;
  const all = clips.flatMap((c) => c.frames.map((frame, i) => ({ c, frame, i })));
  const cols = layout === 'rows' ? Math.max(...clips.map((c) => c.frames.length)) : Math.ceil(Math.sqrt(all.length));
  const rows = layout === 'rows' ? clips.length : Math.ceil(all.length / cols);
  const canvas = document.createElement('canvas');
  canvas.width = cols * size;
  canvas.height = rows * size;
  const g = canvas.getContext('2d')!;
  const frames: object[] = [];
  const tags: object[] = [];
  let n = 0;
  clips.forEach((c, row) => {
    const from = n;
    c.frames.forEach((f, i) => {
      const [x, y] = layout === 'rows' ? [i * size, row * size] : [(n % cols) * size, Math.floor(n / cols) * size];
      g.drawImage(f, x, y);
      frames.push({
        filename: `${clipSlug(c.clip.name)} ${i}`,
        frame: { x, y, w: size, h: size },
        rotated: false,
        trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: size, h: size },
        sourceSize: { w: size, h: size },
        duration: c.durations[i],
      });
      n++;
    });
    tags.push({ name: clipSlug(c.clip.name), from, to: n - 1, direction: 'forward', ...(c.clip.loop ? {} : { repeat: '1' }) });
  });
  const json = {
    frames,
    meta: {
      app: '3dpixel',
      version: '1',
      image: imageName,
      format: 'RGBA8888',
      size: { w: canvas.width, h: canvas.height },
      scale: '1',
      frameTags: tags,
    },
  };
  return { canvas, json: JSON.stringify(json, null, 1) };
}

export async function sheetFiles(clips: ClipFrames[], layout: SheetLayout, base: string) {
  const { canvas, json } = buildSheet(clips, layout, `${base}.png`);
  return { png: await canvasBlob(canvas), json };
}

/** Animated GIF of one clip. Frame delays are rounded to GIF's centiseconds without drifting. */
export function gifOf(c: ClipFrames): Uint8Array {
  const data = c.frames.map((f) => f.getContext('2d')!.getImageData(0, 0, f.width, f.height));
  let acc = 0;
  const delays = c.durations.map((ms) => {
    const before = Math.round(acc / 10);
    acc += ms;
    return Math.round(acc / 10) - before;
  });
  return encodeGif(data, delays);
}

/** File name of frame i of a clip, e.g. "knight_walk_003.png". */
export const frameName = (base: string, c: ClipFrames, i: number) =>
  `${base}_${clipSlug(c.clip.name)}_${String(i).padStart(3, '0')}.png`;
