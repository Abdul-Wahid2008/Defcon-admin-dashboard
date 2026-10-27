import { readJson } from '@/lib/server/limits';
import { z } from 'zod';
import { requireUser, assertSameOrigin } from '@/lib/server/auth';
import { sync } from '@/lib/server/services/sync';
import { acknowledgeAlert } from '@/lib/server/services/alerts';
import { errorResponse, newRequestId, AppError } from '@/lib/server/errors';

export const dynamic = 'force-dynamic';

const Body = z.object({ note: z.string().max(300).optional(), resolve: z.boolean().optional() }).strict();

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = newRequestId();
  try {
    const user = await requireUser(req);
    assertSameOrigin(req);
    await sync();
    const { id } = await params;
    const parsed = Body.safeParse(await readJson(req, ({})));
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid acknowledgement');
    return Response.json(acknowledgeAlert(user, id, parsed.data, { requestId }), { headers: { 'X-Request-Id': requestId } });
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
