import 'server-only';
import { getAdapter } from '../adapters';
import { appendCompletionAudits } from '../audit';

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
}
