import { z } from 'zod';
import { requireUser, assertSameOrigin, createSession, setSessionCookie } from '@/lib/server/auth';
import { changeOwnPassword } from '@/lib/server/services/users';
import { errorResponse, newRequestId, AppError } from '@/lib/server/errors';

export const dynamic = 'force-dynamic';

const Body = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(12, 'At least 12 characters').max(200),
}).strict();

export async function POST(req: Request) {
  const requestId = newRequestId();
  try {
    const user = await requireUser(req);
    assertSameOrigin(req);
    if (user.role === 'team') throw new AppError('FORBIDDEN', 'Not available for this account.');
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid password change', { fieldErrors: parsed.error.flatten().fieldErrors });
    }
    const { epoch } = await changeOwnPassword(user, parsed.data, { requestId });
    // Re-issue this browser's session at the new epoch; every other session of the account is now revoked.
    const token = await createSession({ ...user, epoch, mustChangePassword: false });
    return setSessionCookie(Response.json({ ok: true }, { headers: { 'X-Request-Id': requestId } }), token, req);
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
