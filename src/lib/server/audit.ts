import 'server-only';
import { dbHelper } from './db';
import crypto from 'node:crypto';

export type AuditAction =
  | 'auth.login' | 'auth.login_failed' | 'auth.logout' | 'audit.access_denied'
  | 'team.create' | 'team.update' | 'team.suspend' | 'team.reactivate' | 'team.delete'
  | 'env.provision' | 'env.start' | 'env.stop' | 'env.reset' | 'env.delete'
  | 'participant.add' | 'participant.remove' | 'credential.issue' | 'credential.rotate'
  | 'health.run' | 'settings.freeze' | 'user.create' | 'user.reset_password' | 'user.revoke_sessions' | 'user.disable' | 'auth.password_change' | 'auth.session_revoked' | 'alert.open' | 'alert.resolve' | 'ingest.rejected' | 'settings.update' | 'demo.inject' | 'demo.fail_next' | 'demo.reseed';

export type AuditOutcome = 'requested' | 'success' | 'failure' | 'denied' | 'noop';
export type TargetType = 'team' | 'participant' | 'session' | 'settings' | 'system' | 'user';
export type ActorRole = 'organizer_admin' | 'organizer_operator' | 'team' | 'system' | 'anonymous';

export interface AuditParams {
  ts?: string;
  actorId?: string | null;
  actorName: string;
  actorRole: ActorRole;
  action: AuditAction;
  targetType: TargetType;
  targetId?: string | null;
  outcome: AuditOutcome;
  message: string;
  requestId?: string | null;
  correlationId?: string | null;
  details?: Record<string, unknown> | null;
}

export function appendAudit(params: AuditParams): number {
  const ts = params.ts || new Date().toISOString();
  const result = dbHelper.run(
    `INSERT INTO audit_log
      (ts, actor_id, actor_name, actor_role, action, target_type, target_id,
       outcome, message, request_id, correlation_id, details_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ts,
    params.actorId ?? null,
    params.actorName,
    params.actorRole,
    params.action,
    params.targetType,
    params.targetId ?? null,
    params.outcome,
    params.message,
    params.requestId ?? null,
    params.correlationId ?? null,
    params.details ? JSON.stringify(params.details) : null,
  );
  return result.lastInsertRowid;
}

export function newCorrelationId(): string {
  return `c_${crypto.randomBytes(6).toString('hex')}`;
}

/** Append completion rows for any transitions resolved by resolveDue */
export function appendCompletionAudits(
  completions: Array<{
    teamId: string;
    action: string;
    outcome: 'success' | 'failure';
    correlationId: string;
    ts: string;
  }>,
  actorName = 'system',
  actorRole: ActorRole = 'system',
): void {
  for (const c of completions) {
    const action = `env.${c.action === 'provision' ? 'provision' : c.action}` as AuditAction;
    appendAudit({
      ts: c.ts,
      actorId: null,
      actorName,
      actorRole,
      action,
      targetType: 'team',
      targetId: c.teamId,
      outcome: c.outcome,
      message: `${c.action} ${c.outcome} for ${c.teamId}`,
      correlationId: c.correlationId,
    });
  }
}
