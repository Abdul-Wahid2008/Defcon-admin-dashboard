import { requireUser, assertSameOrigin } from '@/lib/server/auth';
import { getAdapter } from '@/lib/server/adapters';
import { appendAudit } from '@/lib/server/audit';
import { errorResponse, newRequestId, AppError } from '@/lib/server/errors';
import { dbHelper } from '@/lib/server/db';
import { loadConfig } from '@/lib/config';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const ReseedBody = z.object({ confirm: z.literal('RESEED') });

export async function POST(req: Request) {
  const requestId = newRequestId();
  try {
    const user = await requireUser(req);
    assertSameOrigin(req);
    if (user.role !== 'organizer_admin') {
      throw new AppError('FORBIDDEN', 'Requires organizer_admin.');
    }
    const adapter = getAdapter();
    if (!loadConfig().demoControls || adapter.mode !== 'mock') {
      throw new AppError('NOT_FOUND', 'Demo controls not available.');
    }

    const body = await req.json().catch(() => null);
    const parsed = ReseedBody.safeParse(body);
    if (!parsed.success) {
      throw new AppError('CONFIRMATION_MISMATCH', 'Type "RESEED" to confirm.');
    }

    // Wipe mock tables (NOT audit_log)
    dbHelper.run('DELETE FROM checks');
    dbHelper.run('DELETE FROM services');
    dbHelper.run('DELETE FROM participants');
    dbHelper.run('DELETE FROM environments');
    dbHelper.run('DELETE FROM teams');
    dbHelper.run('DELETE FROM alerts');
    dbHelper.run('DELETE FROM settings');
    dbHelper.run('DELETE FROM idempotency_keys');

    appendAudit({
      actorId: user.id, actorName: user.displayName, actorRole: user.role,
      action: 'demo.reseed', targetType: 'system', outcome: 'success',
      message: 'Demo data cleared via reseed API (run npm run seed to repopulate)',
      requestId,
    });

    return Response.json({ ok: true, message: 'Mock data cleared. Run npm run seed to repopulate.' }, {
      headers: { 'X-Request-Id': requestId },
    });
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
