import 'server-only';
import { getAdapter } from '../adapters';
import { appendCompletionAudits } from '../audit';
import { pullIfDue } from '../health/source';

/**
 * Must be called at the start of every request handler.
 * Resolves any due mock transitions and appends their completion audit rows.
 */
export async function sync(): Promise<void> {
  const adapter = getAdapter();
  const completions = await adapter.resolveDue();
  if (completions.length > 0) {
    appendCompletionAudits(completions);
  }
  // Not awaited: a slow or down source must not delay organizer actions. Stale data is shown as unknown instead.
  // No-op unless HEALTH_SOURCE=scoreboard and the poll interval has elapsed.
  void pullIfDue().catch(() => undefined);
}
