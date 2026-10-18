import { requireUser, assertSameOrigin } from '@/lib/server/auth';
import { sync } from '@/lib/server/services/sync';
import { requestLifecycleAction } from '@/lib/server/services/teams';
import { errorResponse, newRequestId, AppError } from '@/lib/server/errors';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const BulkBody = z.object({
  action: z.enum(['start', 'stop']),
  teamIds: z.array(z.string()).min(1).max(40),
  confirm: z.string().optional(),
});

export async function POST(req: Request) {
  const requestId = newRequestId();
  try {
    const user = await requireUser(req);
    assertSameOrigin(req);
    await sync();
    const body = await req.json().catch(() => null);
    const parsed = BulkBody.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid bulk request', {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }

    const { action, teamIds, confirm } = parsed.data;

    if (teamIds.length >= 5) {
      const expected = action === 'start' ? 'START ALL' : 'STOP ALL';
      if (confirm !== expected) {
        throw new AppError('CONFIRMATION_MISMATCH', `Type "${expected}" to confirm bulk ${action}`);
      }
    }

    const results = await Promise.all(
      teamIds.map(async (teamId) => {
        try {
          const result = await requestLifecycleAction(user, teamId, action, { requestId });
          const isNoop = (result.body as any)?.noop;
          return {
            teamId,
            status: isNoop ? 'noop' as const : 'accepted' as const,
            correlationId: (result.body as any)?.correlationId,
          };
        } catch (err: any) {
          return {
            teamId,
            status: 'rejected' as const,
            code: err?.code ?? 'INTERNAL',
          };
        }
      }),
    );

    return Response.json({ results }, { headers: { 'X-Request-Id': requestId } });
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
