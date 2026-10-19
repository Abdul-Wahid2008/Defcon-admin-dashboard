import { requireUser, assertSameOrigin } from '@/lib/server/auth';
import { sync } from '@/lib/server/services/sync';
import { getAdapter } from '@/lib/server/adapters';
import { appendAudit } from '@/lib/server/audit';
import { errorResponse, newRequestId, AppError } from '@/lib/server/errors';
import { MockAdapter } from '@/lib/server/adapters/mock';
import { loadConfig } from '@/lib/config';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const FailNextBody = z.object({
  teamId: z.string(),
  action: z.enum(['start', 'stop', 'reset', 'delete', 'provision']),
});

export async function POST(req: Request) {
  const requestId = newRequestId();
  try {
    const user = await requireUser(req);
    assertSameOrigin(req);
    if (user.role !== 'organizer_admin') {
      throw new AppError('FORBIDDEN', 'Requires organizer_admin.');
    }
    const adapter = getAdapter();
    if (!loadConfig().demoControls || adapter.mode !== 'mock') {
      throw new AppError('NOT_FOUND', 'Demo controls not available.');
    }
    await sync();
    const body = await req.json().catch(() => null);
    const parsed = FailNextBody.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid body', {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }
    await (adapter as MockAdapter).setFailNext(parsed.data.teamId, parsed.data.action);
    appendAudit({
      actorId: user.id, actorName: user.displayName, actorRole: user.role,
      action: 'demo.fail_next', targetType: 'team', targetId: parsed.data.teamId, outcome: 'success',
      message: `Demo: fail-next set for ${parsed.data.teamId} action=${parsed.data.action}`,
      requestId,
    });
    return Response.json({ ok: true }, { headers: { 'X-Request-Id': requestId } });
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
