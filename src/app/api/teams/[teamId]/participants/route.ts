import { readJson } from '@/lib/server/limits';
import { requireUser, assertSameOrigin } from '@/lib/server/auth';
import { sync } from '@/lib/server/services/sync';
import { listParticipants, addParticipant } from '@/lib/server/services/participants';
import { errorResponse, newRequestId, AppError } from '@/lib/server/errors';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const AddParticipantBody = z.object({ name: z.string().min(1).max(80) });

export async function GET(
  req: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  const requestId = newRequestId();
  try {
    const user = await requireUser(req);
    await sync();
    const { teamId } = await params;
    const participants = await listParticipants(user, teamId);
    return Response.json(participants, { headers: { 'X-Request-Id': requestId } });
  } catch (e) {
    return errorResponse(e, requestId);
  }
}

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
    const body = await readJson(req, null);
    const parsed = AddParticipantBody.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'name is required', {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }
    const result = await addParticipant(user, teamId, parsed.data.name, { requestId });
    return Response.json(result, { status: 201, headers: { 'X-Request-Id': requestId } });
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
