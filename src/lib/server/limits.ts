import 'server-only';

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
