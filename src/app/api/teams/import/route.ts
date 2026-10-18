import { requireUser, assertSameOrigin } from '@/lib/server/auth';
import { sync } from '@/lib/server/services/sync';
import { importTeams } from '@/lib/server/services/teams';
import { errorResponse, newRequestId, AppError } from '@/lib/server/errors';
import { TeamImportRequestSchema } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const requestId = newRequestId();
  try {
    const user = await requireUser(req);
    assertSameOrigin(req);
    await sync();
    const body = await req.json().catch(() => null);
    const parsed = TeamImportRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid team import request', {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }
    const result = await importTeams(user, parsed.data, { requestId });
    return Response.json(result, { headers: { 'X-Request-Id': requestId } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
