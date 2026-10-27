import { getAdapter } from '@/lib/server/adapters';
import { errorResponse, newRequestId } from '@/lib/server/errors';
import { loadConfig } from '@/lib/config';
import { getEventConfig } from '@/lib/event-config';
import { dbHelper } from '@/lib/server/db';
import { getHealthSourceStatus } from '@/lib/server/health/source';
import { badgeFor } from '@/lib/server/health/badge';
import pkg from '../../../../package.json';

export const dynamic = 'force-dynamic';

const RESET_KIND = { mock: 'restore_patch', 'docker-compose': 'restart', real: 'recreate_pristine' } as const;

export async function GET() {
  const requestId = newRequestId();
  try {
    const adapter = getAdapter();
    const config = loadConfig();
    const event = getEventConfig();
    const demoControls = config.demoControls && adapter.mode === 'mock' && config.healthSource === 'mock';
    const frozen = dbHelper.get<{ value: string }>(`SELECT value FROM settings WHERE key = 'mutations_frozen'`)?.value === '1';
    const health = getHealthSourceStatus();
    return Response.json({
      adapter: adapter.mode,
      badge: badgeFor(adapter.mode, config.healthSource),
      version: pkg.version,
      serverTime: new Date().toISOString(),
      demoControls,
      limits: { softTeamCap: 30 },
      sources: {
        health: config.healthSource,
        lifecycle: adapter.mode,
        roster: 'manual', // CSV/JSON import only; no external roster source yet
      },
      health: {
        state: health.state,
        lastRound: health.lastRound,
        lastOkAt: health.lastOkAt,
        lastError: health.lastError,
        staleAfterSec: health.staleAfterSec,
      },
      capabilities: {
        resetKind: RESET_KIND[adapter.mode],
        serviceLevelReset: false,
        terminalMode: event.terminalMode,
        flagstores: event.services[0].flagstores,
      },
      frozen,
    }, { headers: { 'X-Request-Id': requestId } });
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
