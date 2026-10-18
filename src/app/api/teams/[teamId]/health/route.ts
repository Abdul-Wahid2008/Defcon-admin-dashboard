import { requireUser } from '@/lib/server/auth';
import { sync } from '@/lib/server/services/sync';
import { getHealth } from '@/lib/server/services/health';
import { errorResponse, newRequestId } from '@/lib/server/errors';

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const requestId = newRequestId();
  try {
    const user = await requireUser(req);
    await sync();
    const { teamId } = await params;
    const result = await getHealth(user, teamId);
    return Response.json(result, { headers: { 'X-Request-Id': requestId } });
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
