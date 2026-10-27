import crypto from 'node:crypto';
import { z } from 'zod';
import { loadConfig } from '@/lib/config';
import { appendAudit } from '@/lib/server/audit';
import { applyHealthBatch } from '@/lib/server/health/apply';
import { allow, readCapped } from '@/lib/server/limits';
import { adoptRealSource, recordIngestOk } from '@/lib/server/health/source';
import { machineCan } from '@/lib/server/permissions';
import { newRequestId } from '@/lib/server/errors';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 256 * 1024;
const MAX_ROWS = 200;

const Body = z.object({
  results: z.array(z.object({
    teamId: z.string().min(1).max(64),
    serviceKey: z.string().min(1).max(64),
    flagstore: z.string().min(1).max(16),
    verdict: z.string().min(1).max(32),
    message: z.string().max(500).nullish(),
    round: z.number().int().nonnegative().nullish(),
    checkedAt: z.string().datetime({ offset: true }).nullish(),
  }).strict().refine(r => r.round != null || r.checkedAt != null, { message: 'round or checkedAt is required' })).min(1).max(MAX_ROWS),
}).strict();

const sha = (v: string) => crypto.createHash('sha256').update(v).digest();

function reply(status: number, body: unknown, requestId: string, extra: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { 'X-Request-Id': requestId, 'Cache-Control': 'no-store', ...extra } });
}

function reject(reason: string, requestId: string, details?: Record<string, unknown>) {
  appendAudit({
    actorName: 'ingest', actorRole: 'anonymous', action: 'ingest.rejected', targetType: 'system',
    outcome: 'denied', message: `Ingest request rejected: ${reason}`, requestId, details: details ?? null,
  });
}

export async function POST(req: Request) {
  const requestId = newRequestId();
  const cfg = loadConfig();
  // No token configured, or another health source selected → the route does not exist.
  if (!cfg.ingestToken || cfg.healthSource !== 'ingest') return reply(404, { error: { code: 'NOT_FOUND', message: 'Not found.', requestId } }, requestId);

  // Cookies are never accepted: a machine caller authenticates with the bearer token only.
  const header = req.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const ok = presented.length > 0 && crypto.timingSafeEqual(sha(presented), sha(cfg.ingestToken)) && machineCan('ingest', 'ingest.write');
  if (!ok) {
    if (allow('ingest:badauth', 10, 60_000)) reject('bad_token', requestId);
    return reply(401, { error: { code: 'UNAUTHENTICATED', message: 'Invalid token.', requestId } }, requestId);
  }

  // Only authenticated calls are rate limited, so a flood of bad tokens cannot lock the real checker out.
  if (!allow('ingest:ok', 120, 60_000)) {
    return reply(429, { error: { code: 'RATE_LIMITED', message: 'Too many requests.', requestId } }, requestId, { 'Retry-After': '60' });
  }

  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    reject('body_too_large', requestId);
    return reply(413, { error: { code: 'VALIDATION_ERROR', message: 'Body exceeds 256 KB.', requestId } }, requestId);
  }
  let text: string;
  try {
    text = await readCapped(req.body, MAX_BODY_BYTES);
  } catch {
    reject('body_too_large', requestId);
    return reply(413, { error: { code: 'VALIDATION_ERROR', message: 'Body exceeds 256 KB.', requestId } }, requestId);
  }

  let json: unknown;
  try { json = JSON.parse(text); } catch {
    reject('invalid_json', requestId);
    return reply(400, { error: { code: 'VALIDATION_ERROR', message: 'Body is not valid JSON.', requestId } }, requestId);
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    reject('invalid_body', requestId, { issues: parsed.error.issues.slice(0, 5).map(i => `${i.path.join('.')}: ${i.message}`) });
    return reply(400, { error: { code: 'VALIDATION_ERROR', message: 'Body does not match the ingest schema (max 200 rows, no extra fields).', requestId } }, requestId);
  }

  const rows = parsed.data.results;
  adoptRealSource('ingest', new Date().toISOString());
  const result = applyHealthBatch(rows.map(r => ({
    externalTeamId: r.teamId, serviceKey: r.serviceKey, flagstore: r.flagstore, verdict: r.verdict,
    message: r.message ?? null, round: r.round ?? null, checkedAt: r.checkedAt ?? null,
  })), 'ingest');
  const rounds = rows.map(r => r.round).filter((n): n is number => typeof n === 'number');
  recordIngestOk(result, rounds.length ? Math.max(...rounds) : null);

  if (result.rejected.length > 0) {
    reject('rows_rejected', requestId, { count: result.rejected.length, sample: result.rejected.slice(0, 20) });
  }
  return reply(200, { accepted: result.accepted + result.unchanged, rejected: result.rejected }, requestId);
}

export function GET() {
  return Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST.' } }, { status: 405, headers: { Allow: 'POST' } });
}
