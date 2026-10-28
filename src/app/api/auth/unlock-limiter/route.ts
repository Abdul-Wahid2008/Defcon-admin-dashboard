import { appendAudit } from '@/lib/server/audit';
import { resetLoginLimiter, unlockToken } from '@/lib/server/auth';
import { allow } from '@/lib/server/limits';
import { newRequestId } from '@/lib/server/errors';
import crypto from 'node:crypto';

export const dynamic = 'force-dynamic';

const sha = (v: string) => crypto.createHash('sha256').update(v).digest();

/**
 * Machine route for `npm run unlock`: clears the in-memory login limiter without a restart. The bearer token is derived
 * from SESSION_SECRET, so only someone who can read the server's .env can compute it; cookies never authenticate it.
 */
export async function POST(req: Request) {
  const requestId = newRequestId();
  const reply = (status: number, code: string, message: string) =>
    Response.json({ error: { code, message, requestId } }, { status, headers: { 'X-Request-Id': requestId, 'Cache-Control': 'no-store' } });

  // Fail closed: with no usable secret the token would be a public constant.
  if ((process.env.SESSION_SECRET ?? '').length < 32) return reply(503, 'UNAVAILABLE', 'Unlock is unavailable: SESSION_SECRET is not configured.');
  const header = req.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!presented || !crypto.timingSafeEqual(sha(presented), sha(unlockToken()))) {
    // Only bad tokens are counted, so an attacker cannot use up the budget the operator needs.
    if (!allow('unlock:badtoken', 10, 60_000)) return reply(429, 'RATE_LIMITED', 'Too many requests.');
    return reply(401, 'UNAUTHENTICATED', 'Invalid token.');
  }

  resetLoginLimiter();
  appendAudit({
    actorName: 'operator-console', actorRole: 'system', action: 'auth.limiter_reset', targetType: 'system',
    outcome: 'success', message: 'Login limiter cleared with npm run unlock', requestId,
  });
  return Response.json({ ok: true }, { headers: { 'X-Request-Id': requestId, 'Cache-Control': 'no-store' } });
}
