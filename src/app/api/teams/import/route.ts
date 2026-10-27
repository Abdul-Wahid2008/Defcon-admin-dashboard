import { requireUser, assertSameOrigin } from '@/lib/server/auth';
import { sync } from '@/lib/server/services/sync';
import { importTeams } from '@/lib/server/services/teams';
import { errorResponse, newRequestId, AppError } from '@/lib/server/errors';
import { TeamImportRequestSchema } from '@/lib/schemas';
import { readCapped } from '@/lib/server/limits';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const requestId = newRequestId();
  try {
    const user = await requireUser(req);
    assertSameOrigin(req);
    await sync();
    // Body cap: 40 rows of names fit well under 128 KB, so anything larger is refused before parsing.
    let body: unknown = null;
    try {
      body = JSON.parse(await readCapped(req.body, 128 * 1024));
    } catch (e) {
      if ((e as Error).message === 'TOO_LARGE') throw new AppError('VALIDATION_ERROR', 'Import body exceeds 128 KB.', undefined, 413);
    }
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
