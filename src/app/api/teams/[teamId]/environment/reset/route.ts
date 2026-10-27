import { idempotencyKeyFrom, readJson } from '@/lib/server/limits';
import { requireUser, assertSameOrigin } from '@/lib/server/auth';
import { sync } from '@/lib/server/services/sync';
import { requestLifecycleAction } from '@/lib/server/services/teams';
import { errorResponse, newRequestId } from '@/lib/server/errors';

export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const requestId = newRequestId();
  try {
    const user = await requireUser(req);
    assertSameOrigin(req);
    await sync();
    const { teamId } = await params;
    const idempotencyKey = idempotencyKeyFrom(req);
    const body = (await readJson(req, null)) as { reason?: unknown; confirmTeamId?: unknown } | null;
    const result = await requestLifecycleAction(user, teamId, 'reset', {
      requestId,
      idempotencyKey,
      reason: typeof body?.reason === 'string' ? body.reason.slice(0, 500) : undefined,
      confirmTeamId: typeof body?.confirmTeamId === 'string' ? body.confirmTeamId : undefined,
    });
    const headers: Record<string, string> = { 'X-Request-Id': requestId };
    if (result.replay) headers['Idempotent-Replay'] = 'true';
    return Response.json(result.body, { status: result.status, headers });
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
