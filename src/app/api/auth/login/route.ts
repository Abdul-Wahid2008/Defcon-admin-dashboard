import { login, checkLoginRateLimit, recordLoginFailure, clearLoginAttempts, setSessionCookie, getClientIp } from '@/lib/server/auth';
import { appendAudit } from '@/lib/server/audit';
import { errorResponse, newRequestId, AppError } from '@/lib/server/errors';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const LoginBody = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  const requestId = newRequestId();
  const ip = getClientIp(req);
  let username = '';
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = LoginBody.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        new AppError('VALIDATION_ERROR', 'username and password required'),
        requestId,
      );
    }
    username = parsed.data.username;

    checkLoginRateLimit(ip, username);

    const { user, token } = await login(username, parsed.data.password);
    clearLoginAttempts(ip, username);

    appendAudit({
      actorId: user.id, actorName: user.displayName, actorRole: user.role,
      action: 'auth.login', targetType: 'session', outcome: 'success',
      message: `${user.username} logged in`,
      requestId,
    });

    const res = Response.json({ user }, {
      status: 200,
      headers: { 'X-Request-Id': requestId },
    });
    return setSessionCookie(res, token, req);
  } catch (e: any) {
    if (e?.code !== 'RATE_LIMITED') {
      recordLoginFailure(ip, username || 'unknown');
      appendAudit({
        actorId: null, actorName: username || 'unknown', actorRole: 'anonymous',
        action: 'auth.login_failed', targetType: 'session', outcome: 'failure',
        message: `Failed login attempt for ${username || 'unknown'}`,
        requestId,
      });
    }
    return errorResponse(e, requestId);
  }
}
