import { requireUser } from '@/lib/server/auth';
import { exportAuditCsv } from '@/lib/server/services/audit';
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
    };
    const csv = exportAuditCsv(user, query);
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"`,
        'X-Request-Id': requestId,
      },
    });
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
