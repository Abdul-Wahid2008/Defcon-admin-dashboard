import { z } from 'zod';
import { requireUser, assertSameOrigin } from '@/lib/server/auth';
import { sync } from '@/lib/server/services/sync';
import { requestServiceAction } from '@/lib/server/services/service-actions';
import { errorResponse, newRequestId, AppError } from '@/lib/server/errors';

export const dynamic = 'force-dynamic';

// Loose on purpose: a missing or short reason / wrong team id must surface as CONFIRMATION_MISMATCH (422), not a 400.
const Body = z.object({ reason: z.string().max(500).optional(), confirmTeamId: z.string().max(64).optional() }).strict();

export async function POST(
  req: Request,
  { params }: { params: Promise<{ teamId: string; key: string }> },
) {
  const requestId = newRequestId();
  try {
    const user = await requireUser(req);
    assertSameOrigin(req);
    await sync();
    const { teamId, key } = await params;
    const raw = await req.json().catch(() => ({}));
    const parsed = Body.safeParse(raw ?? {});
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid service action body');
    const idempotencyKey = req.headers.get('Idempotency-Key');
    const result = await requestServiceAction(user, teamId, key, 'reset', parsed.data, { requestId, idempotencyKey });
    const headers: Record<string, string> = { 'X-Request-Id': requestId };
    if (result.replay) headers['Idempotent-Replay'] = 'true';
    return Response.json(result.body, { status: result.status, headers });
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
