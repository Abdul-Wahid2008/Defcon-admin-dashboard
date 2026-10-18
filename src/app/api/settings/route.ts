import { requireUser, assertSameOrigin } from '@/lib/server/auth';
import { getSettings, updateSettings } from '@/lib/server/services/settings';
import { errorResponse, newRequestId, AppError } from '@/lib/server/errors';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const PatchSettingsBody = z.object({
  competitionStatus: z.enum(['not_started', 'running', 'paused', 'ended']).optional(),
});

export async function GET(req: Request) {
  const requestId = newRequestId();
  try {
    const user = await requireUser(req);
    const result = getSettings(user);
    return Response.json(result, { headers: { 'X-Request-Id': requestId } });
  } catch (e) {
    return errorResponse(e, requestId);
  }
}

export async function PATCH(req: Request) {
  const requestId = newRequestId();
  try {
    const user = await requireUser(req);
    assertSameOrigin(req);
    const body = await req.json().catch(() => null);
    const parsed = PatchSettingsBody.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid settings', {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }
    const result = updateSettings(user, parsed.data, { requestId });
    return Response.json(result, { headers: { 'X-Request-Id': requestId } });
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
