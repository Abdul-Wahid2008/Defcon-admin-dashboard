import { idempotencyKeyFrom, intParam, readJson } from '@/lib/server/limits';
import { requireUser, assertSameOrigin } from '@/lib/server/auth';
import { sync } from '@/lib/server/services/sync';
import { listTeams, createTeam } from '@/lib/server/services/teams';
import { errorResponse, newRequestId, AppError } from '@/lib/server/errors';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const CreateTeamBody = z.object({
  name: z.string().min(2).max(60),
  notes: z.string().max(500).optional(),
  participantNames: z.array(z.string().min(1)).min(0).max(8).optional(),
  autoProvision: z.boolean().optional(),
  externalTeamId: z.string().trim().min(1).max(64).optional(),
});

export async function GET(req: Request) {
  const requestId = newRequestId();
  try {
    const user = await requireUser(req);
    await sync();
    const url = new URL(req.url);
    const query = {
      q: url.searchParams.get('q') ?? undefined,
      state: url.searchParams.get('state')?.split(',').filter(Boolean) ?? undefined,
      health: url.searchParams.get('health')?.split(',').filter(Boolean) ?? undefined,
      account: url.searchParams.get('account') ?? undefined,
      includeDeleted: url.searchParams.get('includeDeleted') === '1',
      sort: url.searchParams.get('sort') ?? undefined,
      page: intParam(url.searchParams.get('page'), 1, 1, 100000),
      pageSize: intParam(url.searchParams.get('pageSize'), 25, 1, 100),
    };
    const result = await listTeams(user, query);
    return Response.json(result, { headers: { 'X-Request-Id': requestId } });
  } catch (e) {
    return errorResponse(e, requestId);
  }
}

export async function POST(req: Request) {
  const requestId = newRequestId();
  try {
    const user = await requireUser(req);
    assertSameOrigin(req);
    await sync();
    const body = await readJson(req, null);
    const parsed = CreateTeamBody.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid request body', {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }
    const idempotencyKey = idempotencyKeyFrom(req);
    const result = await createTeam(user, parsed.data, { requestId, idempotencyKey });

    const headers: Record<string, string> = { 'X-Request-Id': requestId };
    if (result.replay) headers['Idempotent-Replay'] = 'true';
    if ((result as any).softCapExceeded) headers['X-Soft-Cap-Exceeded'] = 'true';

    return Response.json(result.body, { status: result.status, headers });
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
