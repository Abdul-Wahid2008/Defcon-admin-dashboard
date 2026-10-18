import 'server-only';
import { getAdapter } from '../adapters';
import { can } from '../permissions';
import { AppError } from '../errors';
import { SessionUser } from '../auth';

export async function getOverview(user: SessionUser) {
  if (!can(user, 'team.read')) {
    throw new AppError('FORBIDDEN', 'Insufficient permissions.', { required: 'team.read' });
  }
  const adapter = getAdapter();
  return adapter.getOverviewData();
}

export async function listAlerts(
  user: SessionUser,
  query: { status?: 'open' | 'resolved'; limit?: number },
) {
  if (!can(user, 'team.read')) {
    throw new AppError('FORBIDDEN', 'Insufficient permissions.', { required: 'team.read' });
  }
  const adapter = getAdapter();
  return adapter.listAlerts(query);
}
