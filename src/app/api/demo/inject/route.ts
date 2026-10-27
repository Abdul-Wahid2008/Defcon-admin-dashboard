import { readJson } from '@/lib/server/limits';
import { assertNotFrozen } from '@/lib/server/freeze';
import { requireUser, assertSameOrigin } from '@/lib/server/auth';
import { sync } from '@/lib/server/services/sync';
import { getAdapter } from '@/lib/server/adapters';
import { appendAudit } from '@/lib/server/audit';
import { errorResponse, newRequestId, AppError } from '@/lib/server/errors';
import { MockAdapter } from '@/lib/server/adapters/mock';
import { loadConfig } from '@/lib/config';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const InjectBody = z.object({
  teamId: z.string(),
  serviceKey: z.string(),
  checkType: z.enum(['reachability', 'functional']),
  mode: z.enum(['fail', 'clear']),
  detail: z.string().optional(),
});

function demoGuard() {
  const adapter = getAdapter();
  if (!loadConfig().demoControls || adapter.mode !== 'mock') {
    throw new AppError('NOT_FOUND', 'Demo controls not available.');
  }
  return adapter as MockAdapter;
}

export async function POST(req: Request) {
  const requestId = newRequestId();
  try {
    const user = await requireUser(req);
    assertSameOrigin(req);
    if (user.role !== 'organizer_admin') {
      throw new AppError('FORBIDDEN', 'Requires organizer_admin.');
    }
    const adapter = demoGuard();
    assertNotFrozen(user, { action: 'demo.inject', targetType: 'system', requestId });
    await sync();
    const body = await readJson(req, null);
    const parsed = InjectBody.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid inject body', {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }
    await adapter.injectFault(parsed.data.teamId, parsed.data.serviceKey, parsed.data.checkType, parsed.data.mode, parsed.data.detail);
    appendAudit({
      actorId: user.id, actorName: user.displayName, actorRole: user.role,
      action: 'demo.inject', targetType: 'team', targetId: parsed.data.teamId, outcome: 'success',
      message: `Demo: ${parsed.data.mode} fault on ${parsed.data.teamId}/${parsed.data.serviceKey}/${parsed.data.checkType}`,
      requestId,
    });
    return Response.json({ ok: true }, { headers: { 'X-Request-Id': requestId } });
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
