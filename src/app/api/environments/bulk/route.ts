import { requireUser, assertSameOrigin } from '@/lib/server/auth';
import { sync } from '@/lib/server/services/sync';
import { requestLifecycleAction, validateBulkConfirmation } from '@/lib/server/services/teams';
import { errorResponse, newRequestId, AppError } from '@/lib/server/errors';
import { BulkEnvActionRequestSchema } from '@/lib/schemas';
import { normalizeError } from '@/lib/server/errors';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const requestId = newRequestId();
  try {
    const user = await requireUser(req);
    assertSameOrigin(req);
    await sync();
    const body = await req.json().catch(() => null);
    const parsed = BulkEnvActionRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid bulk request', {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }

    const { action, teamIds, confirm } = parsed.data;

    validateBulkConfirmation(action, teamIds, confirm);

    const results: Array<{
      teamId: string;
      status: 'accepted' | 'noop' | 'rejected';
      code?: string;
      correlationId?: string;
    }> = [];
    for (const teamId of teamIds) {
      try {
        const result = await requestLifecycleAction(user, teamId, action, { requestId });
        if (result.status === 200) {
          results.push({ teamId, status: 'noop' });
        } else {
          const body = result.body as { correlationId?: string };
          results.push({ teamId, status: 'accepted', correlationId: body.correlationId });
        }
      } catch (err) {
        results.push({ teamId, status: 'rejected', code: normalizeError(err).code });
      }
    }

    return Response.json({ results }, { headers: { 'X-Request-Id': requestId } });
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
