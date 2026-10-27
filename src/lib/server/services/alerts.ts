import 'server-only';
import { dbHelper } from '../db';
import { can } from '../permissions';
import { AppError } from '../errors';
import { appendAudit } from '../audit';
import { assertNotFrozen } from '../freeze';
import type { SessionUser } from '../auth';

interface AlertRow {
  id: string; team_id: string | null; kind: string; message: string; resolved_at: string | null; acked_at: string | null;
}

/**
 * Acknowledge an alert, or resolve it by hand, with an optional note (audited as alert.ack).
 * An acknowledged alert stays open and keeps its dedupe key, so repeats of the same failure do not create new rows;
 * it just stops counting toward the sidebar badge. A manual resolve is overridden by the next health batch if the
 * failure is still present (the alert reopens, and that is audited too).
 */
export function acknowledgeAlert(
  user: SessionUser,
  alertId: string,
  input: { note?: string; resolve?: boolean },
  opts: { requestId: string },
) {
  if (!can(user, 'alert.ack')) {
    appendAudit({
      actorId: user.id, actorName: user.displayName, actorRole: user.role, action: 'alert.ack',
      targetType: 'system', targetId: alertId, outcome: 'denied', message: 'Unauthorized alert acknowledgement', requestId: opts.requestId,
    });
    throw new AppError('FORBIDDEN', 'Insufficient permissions.', { required: 'alert.ack' });
  }
  assertNotFrozen(user, { action: 'alert.ack', targetType: 'system', targetId: alertId, requestId: opts.requestId });

  const alert = dbHelper.get<AlertRow>(`SELECT id, team_id, kind, message, resolved_at, acked_at FROM alerts WHERE id = ?`, alertId);
  if (!alert) throw new AppError('NOT_FOUND', `Alert ${alertId} not found.`);
  const now = new Date().toISOString();
  const note = input.note?.trim() || null;

  if (alert.resolved_at) {
    return { id: alert.id, status: 'already_resolved' as const };
  }
  if (!input.resolve && alert.acked_at) {
    return { id: alert.id, status: 'already_acknowledged' as const };
  }

  dbHelper.transaction(() => {
    dbHelper.run(
      `UPDATE alerts SET acked_at = COALESCE(acked_at, ?), acked_by = COALESCE(acked_by, ?), ack_note = COALESCE(?, ack_note)${input.resolve ? ', resolved_at = ?' : ''} WHERE id = ?`,
      ...(input.resolve ? [now, user.displayName, note, now, alertId] : [now, user.displayName, note, alertId]));
    appendAudit({
      ts: now, actorId: user.id, actorName: user.displayName, actorRole: user.role, action: 'alert.ack',
      targetType: alert.team_id ? 'team' : 'system', targetId: alert.team_id ?? alertId, outcome: 'success',
      message: `${input.resolve ? 'Resolved' : 'Acknowledged'} alert: ${alert.message}`.slice(0, 300),
      requestId: opts.requestId, details: { alertId, kind: alert.kind, resolved: !!input.resolve, note },
    });
  });
  return { id: alert.id, status: input.resolve ? ('resolved' as const) : ('acknowledged' as const) };
}
