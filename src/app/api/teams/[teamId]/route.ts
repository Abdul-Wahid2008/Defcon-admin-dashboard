import { requireUser, assertSameOrigin } from '@/lib/server/auth';
import { sync } from '@/lib/server/services/sync';
import { getTeam, updateTeam } from '@/lib/server/services/teams';
import { errorResponse, newRequestId, AppError } from '@/lib/server/errors';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const PatchTeamBody = z.object({
  name: z.string().min(2).max(60).optional(),
  notes: z.string().max(500).optional(),
  accountStatus: z.enum(['active', 'suspended']).optional(),
});

export async function GET(
  req: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const requestId = newRequestId();
  try {
    const user = await requireUser(req);
    await sync();
    const { teamId } = await params;
    const team = await getTeam(user, teamId);
    return Response.json(team, { headers: { 'X-Request-Id': requestId } });
  } catch (e) {
    return errorResponse(e, requestId);
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const requestId = newRequestId();
  try {
    const user = await requireUser(req);
    assertSameOrigin(req);
    await sync();
    const { teamId } = await params;
    const body = await req.json().catch(() => null);
    const parsed = PatchTeamBody.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid request body', {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }
    const team = await updateTeam(user, teamId, parsed.data, { requestId });
    return Response.json(team, { headers: { 'X-Request-Id': requestId } });
  } catch (e) {
    return errorResponse(e, requestId);
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const requestId = newRequestId();
  try {
    const user = await requireUser(req);
    assertSameOrigin(req);
    await sync();
    const { teamId } = await params;
    const body = await req.json().catch(() => null);
    const confirmName: string | undefined = body?.confirmName;
    if (!confirmName) {
      throw new AppError('VALIDATION_ERROR', 'confirmName is required for delete');
    }
    const idempotencyKey = req.headers.get('Idempotency-Key');
    const result = await import('@/lib/server/services/teams').then(m =>
      m.deleteTeam(user, teamId, confirmName, { requestId, idempotencyKey }),
    );
    const headers: Record<string, string> = { 'X-Request-Id': requestId };
    if (result.replay) headers['Idempotent-Replay'] = 'true';
    return Response.json(result.body, { status: result.status, headers });
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
