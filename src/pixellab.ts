// PixelLab API v2 client (https://api.pixellab.ai/v2/docs): pixel art generation and skeleton
// estimation. The API allows browser origins (CORS), so the web and desktop builds call it the
// same way. The API key is stored by secrets.ts: the OS keychain on desktop, localStorage on the web.

import { getSecret } from './secrets';

const BASE = 'https://api.pixellab.ai/v2';
export const KEY_NAME = 'pixellab';
export const KEY_URL = 'https://www.pixellab.ai/account';

export type View = 'side' | 'low top-down' | 'high top-down';
export type Direction = 'north' | 'north-east' | 'east' | 'south-east' | 'south' | 'south-west' | 'west' | 'north-west';
export type Outline = 'single color black outline' | 'single color outline' | 'selective outline' | 'lineless';
export type Detail = 'low detail' | 'medium detail' | 'highly detailed';

export const SKELETON_LABELS = [
  'NOSE', 'NECK',
  'RIGHT SHOULDER', 'RIGHT ELBOW', 'RIGHT ARM',
  'LEFT SHOULDER', 'LEFT ELBOW', 'LEFT ARM',
  'RIGHT HIP', 'RIGHT KNEE', 'RIGHT LEG',
  'LEFT HIP', 'LEFT KNEE', 'LEFT LEG',
  'RIGHT EYE', 'LEFT EYE', 'RIGHT EAR', 'LEFT EAR',
] as const;
export type SkeletonLabel = (typeof SKELETON_LABELS)[number];

/** x and y are fractions (0-1) of the image sent; higher z_index draws on top. */
export interface Keypoint {
  x: number;
  y: number;
  label: SkeletonLabel;
  z_index: number;
}

export interface Usage {
  type: 'usd' | 'generations';
  usd?: number;
  generations?: number;
}

export class PixelLabError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const STATUS: Record<number, string> = {
  401: 'PixelLab rejected the API key. Check it in Settings.',
  402: 'Your PixelLab account is out of credits.',
  429: 'Too many PixelLab requests at once. Try again in a moment.',
  529: 'PixelLab is busy right now. Try again in a moment.',
};

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const key = await getSecret(KEY_NAME);
  if (!key) throw new PixelLabError('Add your PixelLab API key in Settings first.', 401);
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new PixelLabError('Could not reach PixelLab. Check your internet connection.', 0);
  }
  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json();
      detail = typeof j.detail === 'string' ? j.detail : Array.isArray(j.detail) ? j.detail.map((d: any) => d.msg).join('; ') : '';
    } catch {}
    throw new PixelLabError(STATUS[res.status] ?? `PixelLab error ${res.status}${detail ? `: ${detail}` : ''}`, res.status);
  }
  return res.json();
}

const toBase64 = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromBase64 = (b64: string, format = 'png') => {
  const raw = atob(b64.replace(/^data:[^,]*,/, ''));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new Blob([bytes], { type: `image/${format}` });
};
const image = async (blob: Blob) => ({ type: 'base64', base64: await toBase64(blob), format: 'png' });

export interface Balance {
  credits?: { type: string; usd: number };
  subscription?: { type: string; status: string; plan: string; generations: number; total: number };
}

export const getBalance = () => call<Balance>('GET', '/balance');

/** "12 of 2000 generations · $0.00 credit", or as much of it as the account has. */
export function balanceText(b: Balance): string {
  const out: string[] = [];
  if (b.subscription?.total) out.push(`${b.subscription.generations} of ${b.subscription.total} generations left`);
  if (b.credits && b.credits.usd > 0) out.push(`$${b.credits.usd.toFixed(2)} credit`);
  return out.join(' · ') || 'No credits';
}

export const usageText = (u?: Usage) =>
  !u ? '' : u.type === 'usd' ? `$${(u.usd ?? 0).toFixed(3)}` : `${+(u.generations ?? 0).toFixed(2)} generation${u.generations === 1 ? '' : 's'}`;

export type Model = 'pixen' | 'pixflux';

export interface GenerateOptions {
  model: Model;
  description: string;
  width: number;
  height: number;
  view: View;
  direction: Direction;
  outline: Outline;
  detail: Detail;
  /** Pixflux only: an image whose colours the result should use. */
  palette?: Blob;
  seed?: number;
}

/** Sizes each model accepts: Pixen wants multiples of 4 (square below 32), Pixflux up to 400. */
export function fitSize(model: Model, w: number, h: number): [number, number] {
  if (model === 'pixflux') return [Math.max(16, Math.min(400, w)), Math.max(16, Math.min(400, h))];
  const r4 = (v: number) => Math.max(16, Math.round(v / 4) * 4);
  let [a, b] = [r4(w), r4(h)];
  if (a < 32 || b < 32) a = b = Math.max(a, b);
  const area = 512 * 512;
  if (a * b > area) {
    const f = Math.sqrt(area / (a * b));
    [a, b] = [Math.floor((a * f) / 4) * 4, Math.floor((b * f) / 4) * 4];
  }
  return [a, b];
}

/** Text to sprite, on a transparent background. Both models answer straight away (no job). */
export async function generateImage(o: GenerateOptions): Promise<{ image: Blob; usage?: Usage }> {
  const [width, height] = fitSize(o.model, o.width, o.height);
  const common = {
    description: o.description,
    image_size: { width, height },
    view: o.view,
    direction: o.direction,
    outline: o.outline,
    detail: o.detail,
    no_background: true,
    ...(o.seed ? { seed: o.seed } : {}),
  };
  const body = o.model === 'pixflux' ? { ...common, ...(o.palette ? { color_image: await image(o.palette) } : {}) } : common;
  const r = await call<{ image: { base64: string; format?: string }; usage?: Usage }>('POST', o.model === 'pixflux' ? '/create-image-pixflux' : '/create-image-pixen', body);
  return { image: fromBase64(r.image.base64, r.image.format), usage: r.usage };
}

/** Sizes the rotate model takes. */
export const ROTATE_SIZES = [16, 32, 64, 128];

/**
 * The same subject turned to face another way (1 generation). `sprite` must be square, one of
 * ROTATE_SIZES; the result is the same size.
 */
export async function rotateImage(sprite: Blob, size: number, from: Direction, to: Direction, view: View = 'side'): Promise<{ image: Blob; usage?: Usage }> {
  const r = await call<{ image: { base64: string; format?: string }; usage?: Usage }>('POST', '/rotate', {
    image_size: { width: size, height: size },
    from_image: await image(sprite),
    from_direction: from,
    to_direction: to,
    from_view: view,
    to_view: view,
  });
  return { image: fromBase64(r.image.base64, r.image.format), usage: r.usage };
}

/** The 18 joints of a character (0.1 generations). Images up to 256×256. */
export async function estimateSkeleton(sprite: Blob): Promise<{ keypoints: Keypoint[]; usage?: Usage }> {
  return call('POST', '/estimate-skeleton', { image: await image(sprite) });
}
