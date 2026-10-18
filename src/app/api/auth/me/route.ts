import { requireUser } from '@/lib/server/auth';
import { errorResponse, newRequestId } from '@/lib/server/errors';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const requestId = newRequestId();
  try {
    const user = await requireUser(req);
    return Response.json({ user }, { headers: { 'X-Request-Id': requestId } });
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
