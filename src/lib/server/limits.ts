import 'server-only';
import { AppError } from './errors';

/** Reads a web ReadableStream into text, aborting once `max` bytes are exceeded. */
export async function readCapped(body: ReadableStream<Uint8Array> | null, max: number): Promise<string> {
  if (!body) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new Error('TOO_LARGE');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const buckets = new Map<string, { count: number; resetAt: number }>();

/** Fixed-window in-memory limiter. Returns true when the call is allowed. */
export function allow(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  b.count++;
  return b.count <= max;
}

export function resetLimits(): void {
  buckets.clear();
}

/** Default cap for JSON bodies on organizer routes (the largest legitimate body is a team with 8 participants). */
export const MAX_JSON_BYTES = 64 * 1024;

/**
 * Reads a JSON body without ever buffering more than `max` bytes. Unparseable or empty bodies return `fallback`
 * (callers validate with zod); an oversized body is a 413 before any parsing.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- same loose type as Request.json(); every caller validates with zod
export async function readJson(req: Request, fallback: unknown, max = MAX_JSON_BYTES): Promise<any> {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > max) throw new AppError('VALIDATION_ERROR', `Request body exceeds ${Math.round(max / 1024)} KB.`, undefined, 413);
  let text: string;
  try {
    text = await readCapped(req.body, max);
  } catch (e) {
    if ((e as Error).message === 'TOO_LARGE') throw new AppError('VALIDATION_ERROR', `Request body exceeds ${Math.round(max / 1024)} KB.`, undefined, 413);
    return fallback;
  }
  try { return JSON.parse(text); } catch { return fallback; }
}

/** Integer query parameter clamped to [min, max]; missing or non-numeric values fall back to `def`. */
export function intParam(raw: string | null, def: number, min: number, max: number): number {
  const n = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

/** Idempotency-Key header: absent is fine; present must be 1-128 printable ASCII characters. */
export function idempotencyKeyFrom(req: Request): string | null {
  const key = req.headers.get('Idempotency-Key');
  if (key === null) return null;
  if (!/^[\x21-\x7e]{1,128}$/.test(key)) throw new AppError('VALIDATION_ERROR', 'Idempotency-Key must be 1-128 printable ASCII characters.');
  return key;
}
