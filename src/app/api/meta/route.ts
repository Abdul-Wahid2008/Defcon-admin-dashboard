import { getAdapter } from '@/lib/server/adapters';
import { errorResponse, newRequestId } from '@/lib/server/errors';
import { loadConfig } from '@/lib/config';

export const dynamic = 'force-dynamic';

export async function GET() {
  const requestId = newRequestId();
  try {
    const adapter = getAdapter();
    const config = loadConfig();
    const demoControls = config.demoControls && adapter.mode === 'mock';
    return Response.json({
      adapter: adapter.mode,
      version: '1.1.0',
      serverTime: new Date().toISOString(),
      demoControls,
      limits: { softTeamCap: 30 },
    }, { headers: { 'X-Request-Id': requestId } });
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
