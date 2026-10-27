import { readJson } from '@/lib/server/limits';
import { z } from 'zod';
import { requireUser, assertSameOrigin } from '@/lib/server/auth';
import { sync } from '@/lib/server/services/sync';
import { setFrozen } from '@/lib/server/services/settings';
import { errorResponse, newRequestId, AppError } from '@/lib/server/errors';

export const dynamic = 'force-dynamic';

const Body = z.object({ frozen: z.boolean(), confirm: z.string().optional() }).strict();

export async function POST(req: Request) {
  const requestId = newRequestId();
  try {
    const user = await requireUser(req);
    assertSameOrigin(req);
    await sync();
    const parsed = Body.safeParse(await readJson(req, null));
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid freeze request');
    return Response.json(setFrozen(user, parsed.data, { requestId }), { headers: { 'X-Request-Id': requestId } });
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
