import { requireUser } from '@/lib/server/auth';
import { sync } from '@/lib/server/services/sync';
import { listAlerts } from '@/lib/server/services/overview';
import { errorResponse, newRequestId } from '@/lib/server/errors';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const requestId = newRequestId();
  try {
    const user = await requireUser(req);
    await sync();
    const url = new URL(req.url);
    const status = url.searchParams.get('status') as 'open' | 'resolved' | undefined;
    const limit = parseInt(url.searchParams.get('limit') ?? '20', 10);
    const alerts = await listAlerts(user, { status, limit });
    return Response.json(alerts, { headers: { 'X-Request-Id': requestId } });
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
