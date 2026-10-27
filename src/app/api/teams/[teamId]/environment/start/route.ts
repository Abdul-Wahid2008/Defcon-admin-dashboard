import { idempotencyKeyFrom } from '@/lib/server/limits';
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
    const result = await requestLifecycleAction(user, teamId, 'start', { requestId, idempotencyKey });
    const headers: Record<string, string> = { 'X-Request-Id': requestId };
    if (result.replay) headers['Idempotent-Replay'] = 'true';
    return Response.json(result.body, { status: result.status, headers });
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
