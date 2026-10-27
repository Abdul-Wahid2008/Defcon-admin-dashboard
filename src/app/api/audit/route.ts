import { intParam } from '@/lib/server/limits';
import { requireUser } from '@/lib/server/auth';
import { queryAudit } from '@/lib/server/services/audit';
import { errorResponse, newRequestId } from '@/lib/server/errors';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const requestId = newRequestId();
  try {
    const user = await requireUser(req);
    const url = new URL(req.url);
    const query = {
      actor: url.searchParams.get('actor') ?? undefined,
      action: url.searchParams.get('action')?.split(',').filter(Boolean),
      team: url.searchParams.get('team') ?? undefined,
      outcome: url.searchParams.get('outcome')?.split(',').filter(Boolean),
      from: url.searchParams.get('from') ?? undefined,
      to: url.searchParams.get('to') ?? undefined,
      q: url.searchParams.get('q') ?? undefined,
      page: intParam(url.searchParams.get('page'), 1, 1, 100000),
      pageSize: intParam(url.searchParams.get('pageSize'), 50, 1, 100),
    };
    const result = queryAudit(user, query);
    return Response.json(result, { headers: { 'X-Request-Id': requestId } });
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
