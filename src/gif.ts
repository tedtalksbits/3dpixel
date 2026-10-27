// Animated GIF encoder (GIF89a) with one global palette, transparency and looping. If the frames
// use 255 colours or fewer (the flat front view usually does) the palette is exact; otherwise it is
// built by median cut. Index 255 is transparent, for pixels under half opacity.

export type RGB = [number, number, number];

const TRANSPARENT = 255;

/** Median cut over a colour histogram, down to `max` colours. */
export function medianCut(hist: Map<number, number>, max: number): RGB[] {
  type BoxT = { cols: [RGB, number][] };
  const boxes: BoxT[] = [{ cols: [...hist].map(([k, n]) => [[(k >> 16) & 255, (k >> 8) & 255, k & 255], n]) }];
  const range = (b: BoxT, ch: number) => {
    let lo = 255, hi = 0;
    for (const [c] of b.cols) (lo = Math.min(lo, c[ch])), (hi = Math.max(hi, c[ch]));
    return hi - lo;
  };
  while (boxes.length < max) {
    // split the box with the widest channel spread that still has more than one colour
    let best = -1, bestCh = 0, bestR = -1;
    boxes.forEach((b, i) => {
      if (b.cols.length < 2) return;
      for (let ch = 0; ch < 3; ch++) {
        const r = range(b, ch);
        if (r > bestR) (bestR = r), (best = i), (bestCh = ch);
      }
    });
    if (best < 0) break;
    const b = boxes[best];
    b.cols.sort((x, y) => x[0][bestCh] - y[0][bestCh]);
    // split at the weighted median, so busy colours keep more of the palette
    const total = b.cols.reduce((s, [, n]) => s + n, 0);
    let acc = 0, cut = 1;
    for (let i = 0; i < b.cols.length - 1; i++) {
      acc += b.cols[i][1];
      if (acc >= total / 2) {
        cut = i + 1;
        break;
      }
    }
    boxes.splice(best, 1, { cols: b.cols.slice(0, cut) }, { cols: b.cols.slice(cut) });
  }
  return boxes.map((b) => {
    let r = 0, g = 0, bl = 0, n = 0;
    for (const [c, w] of b.cols) (r += c[0] * w), (g += c[1] * w), (bl += c[2] * w), (n += w);
    return [Math.round(r / n), Math.round(g / n), Math.round(bl / n)] as RGB;
  });
}

function buildPalette(frames: ImageData[]): RGB[] {
  const hist = new Map<number, number>();
  for (const f of frames) {
    const d = f.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      hist.set(k, (hist.get(k) ?? 0) + 1);
    }
  }
  if (hist.size <= 255) return [...hist.keys()].map((k) => [(k >> 16) & 255, (k >> 8) & 255, k & 255]);
  return medianCut(hist, 255);
}

function indexer(palette: RGB[]) {
  const cache = new Map<number, number>();
  return (r: number, g: number, b: number) => {
    const k = (r << 16) | (g << 8) | b;
    let i = cache.get(k);
    if (i === undefined) {
      let best = Infinity;
      i = 0;
      for (let j = 0; j < palette.length; j++) {
        const p = palette[j];
        const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
        if (d < best) (best = d), (i = j);
      }
      cache.set(k, i);
    }
    return i;
  };
}

/** GIF's LZW, with 8-bit minimum code size, packed into 255-byte sub-blocks. */
function lzw(indices: Uint8Array): number[] {
  const MIN = 8;
  const CLEAR = 1 << MIN;
  const END = CLEAR + 1;
  const out: number[] = [];
  let bits = 0, acc = 0, size = MIN + 1;
  const emit = (code: number) => {
    acc |= code << bits;
    bits += size;
    while (bits >= 8) {
      out.push(acc & 255);
      acc >>= 8;
      bits -= 8;
    }
  };
  let dict = new Map<number, number>();
  let next = END + 1;
  emit(CLEAR);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const c = indices[i];
    const key = (prefix << 8) | c;
    const found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > 1 << size && size < 12) size++;
    } else {
      // table full: start again
      emit(CLEAR);
      dict = new Map();
      next = END + 1;
      size = MIN + 1;
    }
    prefix = c;
  }
  emit(prefix);
  emit(END);
  if (bits > 0) out.push(acc & 255);
  const blocks: number[] = [MIN];
  for (let i = 0; i < out.length; i += 255) {
    const chunk = out.slice(i, i + 255);
    blocks.push(chunk.length, ...chunk);
  }
  blocks.push(0);
  return blocks;
}

/** Encode frames (all the same size) with per-frame delays in centiseconds. Loops forever. */
export function encodeGif(frames: ImageData[], delays: number[]): Uint8Array {
  const w = frames[0].width;
  const h = frames[0].height;
  const palette = buildPalette(frames);
  const index = indexer(palette);
  const bytes: number[] = [];
  const u16 = (n: number) => bytes.push(n & 255, (n >> 8) & 255);
  const str = (s: string) => bytes.push(...[...s].map((c) => c.charCodeAt(0)));
  str('GIF89a');
  u16(w);
  u16(h);
  bytes.push(0xf7, 0, 0); // global colour table of 256 entries
  for (let i = 0; i < 256; i++) bytes.push(...(palette[i] ?? [0, 0, 0]));
  // NETSCAPE2.0: loop forever
  bytes.push(0x21, 0xff, 11);
  str('NETSCAPE2.0');
  bytes.push(3, 1, 0, 0, 0);
  frames.forEach((f, n) => {
    // graphic control: restore to background after each frame, so transparent sprites don't smear
    bytes.push(0x21, 0xf9, 4, (2 << 2) | 1);
    u16(Math.max(2, Math.round(delays[n] ?? 4)));
    bytes.push(TRANSPARENT, 0);
    bytes.push(0x2c);
    u16(0);
    u16(0);
    u16(w);
    u16(h);
    bytes.push(0);
    const d = f.data;
    const idx = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) idx[p] = d[i + 3] < 128 ? TRANSPARENT : index(d[i], d[i + 1], d[i + 2]);
    bytes.push(...lzw(idx));
  });
  bytes.push(0x3b);
  return new Uint8Array(bytes);
}
