import { readJson } from '@/lib/server/limits';
import { requireUser, assertSameOrigin } from '@/lib/server/auth';
import { sync } from '@/lib/server/services/sync';
import { rotateCredentials } from '@/lib/server/services/participants';
import { errorResponse, newRequestId } from '@/lib/server/errors';

export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const requestId = newRequestId();
  try {
    const user = await requireUser(req);
    assertSameOrigin(req);
    await sync();
    const { teamId } = await params;
    const body = await readJson(req, ({}));
    const participantId: string | undefined = body?.participantId;
    const credentials = await rotateCredentials(user, teamId, participantId, { requestId });
    return Response.json({ credentials }, { headers: { 'X-Request-Id': requestId } });
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
