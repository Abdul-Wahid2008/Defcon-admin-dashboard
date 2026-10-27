import { readJson } from '@/lib/server/limits';
import { z } from 'zod';
import { requireUser, assertSameOrigin } from '@/lib/server/auth';
import { sync } from '@/lib/server/services/sync';
import { createUser, listUsers } from '@/lib/server/services/users';
import { errorResponse, newRequestId, AppError } from '@/lib/server/errors';

export const dynamic = 'force-dynamic';

const CreateBody = z.object({
  username: z.string().trim().regex(/^[a-z0-9][a-z0-9._-]{2,31}$/i, '3-32 characters: letters, digits, . _ -'),
  displayName: z.string().trim().min(1).max(60),
  role: z.enum(['organizer_admin', 'organizer_operator']),
}).strict();

export async function GET(req: Request) {
  const requestId = newRequestId();
  try {
    const user = await requireUser(req);
    return Response.json({ items: listUsers(user, { requestId }) }, { headers: { 'X-Request-Id': requestId } });
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
    const parsed = CreateBody.safeParse(await readJson(req, null));
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid user', { fieldErrors: parsed.error.flatten().fieldErrors });
    }
    return Response.json(await createUser(user, parsed.data, { requestId }), { status: 201, headers: { 'X-Request-Id': requestId } });
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
