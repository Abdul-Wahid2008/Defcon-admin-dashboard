import 'server-only';
import { getAdapter } from '../adapters';
import { can, type Permission } from '../permissions';
import { AppError } from '../errors';
import { appendAudit, newCorrelationId } from '../audit';
import { assertNotFrozen } from '../freeze';
import { lookupIdempotencyKey, storeIdempotencyKey } from '../idempotency';
import type { SessionUser } from '../auth';
import type { ServiceActionKind } from '../adapters/types';

export const MIN_REASON_CHARS = 10;

export interface ServiceActionInput {
  reason?: string;
  confirmTeamId?: string;
}

/**
 * Restart or reset one service of one team. Restart needs `service.restart`; reset needs `service.reset`, a reason of
 * at least 10 characters and the typed team id (CONFIRMATION_MISMATCH 422 otherwise). Async like environment actions:
 * a `requested` audit row now, the completion row (same correlation id) when the pending slot resolves.
 */
export async function requestServiceAction(
  user: SessionUser,
  teamId: string,
  serviceKey: string,
  kind: ServiceActionKind,
  input: ServiceActionInput,
  opts: { requestId: string; idempotencyKey?: string | null },
) {
  const permission: Permission = kind === 'restart' ? 'service.restart' : 'service.reset';
  const action = kind === 'restart' ? 'service.restart' : 'service.reset';

  if (!can(user, permission, { teamId })) {
    appendAudit({
      actorId: user.id, actorName: user.displayName, actorRole: user.role, action,
      targetType: 'team', targetId: teamId, outcome: 'denied',
      message: `Unauthorized ${kind} of ${serviceKey} for ${teamId}`, requestId: opts.requestId,
    });
    throw new AppError('FORBIDDEN', 'Insufficient permissions.', { required: permission });
  }
  assertNotFrozen(user, { action, targetType: 'team', targetId: teamId, requestId: opts.requestId });

  const adapter = getAdapter();
  if (!adapter.capabilities.serviceLevelReset || !adapter.requestServiceAction) {
    throw new AppError('CONFLICT', 'This adapter does not support service-level actions.');
  }

  if (kind === 'reset') {
    const reason = input.reason?.trim() ?? '';
    if (reason.length < MIN_REASON_CHARS || input.confirmTeamId !== teamId) {
      throw new AppError('CONFIRMATION_MISMATCH',
        `A reason of at least ${MIN_REASON_CHARS} characters and the typed team id are required to reset a service.`,
        { expectedTeamId: teamId, minReasonChars: MIN_REASON_CHARS });
    }
  }

  const route = `POST /api/teams/${teamId}/services/${serviceKey}/${kind}`;
  if (opts.idempotencyKey) {
    const stored = lookupIdempotencyKey(opts.idempotencyKey, user.id, route);
    if (stored) return { ...stored, replay: true };
  }

  const correlationId = newCorrelationId();
  const body = await adapter.requestServiceAction(teamId, serviceKey, kind, { correlationId });

  appendAudit({
    actorId: user.id, actorName: user.displayName, actorRole: user.role, action,
    targetType: 'team', targetId: teamId, outcome: 'requested',
    message: `${kind} of ${serviceKey} requested for ${teamId}`,
    requestId: opts.requestId, correlationId,
    details: { serviceKey, ...(kind === 'reset' ? { reason: input.reason!.trim() } : {}) },
  });

  if (opts.idempotencyKey) storeIdempotencyKey(opts.idempotencyKey, user.id, route, { status: 202, body });
  return { status: 202 as const, body, replay: false };
}
