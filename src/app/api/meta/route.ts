import { getAdapter } from '@/lib/server/adapters';
import { errorResponse, newRequestId } from '@/lib/server/errors';
import { requireUser } from '@/lib/server/auth';
import { loadConfig } from '@/lib/config';
import { dbHelper } from '@/lib/server/db';
import { getHealthSourceStatus } from '@/lib/server/health/source';
import { badgeFor } from '@/lib/server/health/badge';
import pkg from '../../../../package.json';

export const dynamic = 'force-dynamic';

export async function GET(req?: Request) {
  const requestId = newRequestId();
  try {
    const adapter = getAdapter();
    const config = loadConfig();
    const demoControls = config.demoControls && adapter.mode === 'mock' && config.healthSource === 'mock';
    const frozen = dbHelper.get<{ value: string }>(`SELECT value FROM settings WHERE key = 'mutations_frozen'`)?.value === '1';
    const health = getHealthSourceStatus();
    // Public callers get only what the badge needs; source detail and freeze state need a session.
    const authed = req ? await requireUser(req).then(() => true, () => false) : false;
    return Response.json({
      adapter: adapter.mode,
      badge: badgeFor(adapter.mode, config.healthSource, config.evidenceGatePassed),
      version: pkg.version,
      serverTime: new Date().toISOString(),
      demoControls,
      limits: { softTeamCap: 30 },
      sources: {
        health: authed ? config.healthSource : 'mock',
        lifecycle: adapter.mode,
        roster: 'manual', // CSV/JSON import only; no external roster source yet
      },
      health: {
        state: authed ? health.state : 'mock',
        lastRound: authed ? health.lastRound : null,
        lastOkAt: authed ? health.lastOkAt : null,
        lastError: authed ? health.lastError : null,
        staleAfterSec: health.staleAfterSec,
      },
      capabilities: adapter.capabilities,
      frozen: authed ? frozen : false,
    }, { headers: { 'X-Request-Id': requestId } });
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
