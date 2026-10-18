import { requireUser, clearSessionCookie } from '@/lib/server/auth';
import { appendAudit } from '@/lib/server/audit';
import { newRequestId } from '@/lib/server/errors';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const requestId = newRequestId();
  try {
    const user = await requireUser(req).catch(() => null);
    if (user) {
      appendAudit({
        actorId: user.id, actorName: user.displayName, actorRole: user.role,
        action: 'auth.logout', targetType: 'session', outcome: 'success',
        message: `${user.username} logged out`,
        requestId,
      });
    }
  } catch { /* ignore */ }

  return new Response(null, {
    status: 204,
    headers: {
      'Set-Cookie': clearSessionCookie(),
      'X-Request-Id': requestId,
    },
  });
}
