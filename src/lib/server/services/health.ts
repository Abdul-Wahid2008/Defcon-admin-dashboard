import 'server-only';
import { getAdapter } from '../adapters';
import { can } from '../permissions';
import { AppError } from '../errors';
import { appendAudit } from '../audit';
import { SessionUser } from '../auth';

export async function getHealth(user: SessionUser, teamId: string) {
  if (!can(user, 'team.read', { teamId })) {
    throw new AppError('FORBIDDEN', 'Insufficient permissions.', { required: 'team.read' });
  }
  const adapter = getAdapter();
  const team = await adapter.getTeam(teamId);
  if (!team) throw new AppError('NOT_FOUND', `Team ${teamId} not found.`);
  return {
    health: team.environment.health,
    services: team.environment.services,
    lastHealthCheckAt: team.environment.lastHealthCheckAt,
  };
}

export async function runHealthChecks(user: SessionUser, teamId: string, opts: { requestId: string }) {
  if (!can(user, 'env.start', { teamId })) {
    appendAudit({
      actorId: user.id, actorName: user.displayName, actorRole: user.role,
      action: 'health.run', targetType: 'team', targetId: teamId, outcome: 'denied',
      message: `Unauthorized health check for ${teamId}`,
      requestId: opts.requestId,
    });
    throw new AppError('FORBIDDEN', 'Insufficient permissions.', { required: 'env.start' });
  }

  const adapter = getAdapter();
  const snapshot = await adapter.runHealthChecks(teamId);

  appendAudit({
    actorId: user.id, actorName: user.displayName, actorRole: user.role,
    action: 'health.run', targetType: 'team', targetId: teamId, outcome: 'success',
    message: `Health checks run for ${teamId}: ${snapshot.health}`,
    requestId: opts.requestId,
  });

  return snapshot;
}
