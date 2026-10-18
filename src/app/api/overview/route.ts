import { requireUser } from '@/lib/server/auth';
import { sync } from '@/lib/server/services/sync';
import { getOverview } from '@/lib/server/services/overview';
import { errorResponse, newRequestId } from '@/lib/server/errors';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const requestId = newRequestId();
  try {
    const user = await requireUser(req);
    await sync();
    const data = await getOverview(user);
    return Response.json(data, { headers: { 'X-Request-Id': requestId } });
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
