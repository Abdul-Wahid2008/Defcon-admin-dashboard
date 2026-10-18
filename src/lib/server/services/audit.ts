import 'server-only';
import { dbHelper } from '../db';
import { can } from '../permissions';
import { AppError } from '../errors';
import { SessionUser } from '../auth';
import { appendAudit } from '../audit';

export interface AuditQuery {
  actor?: string;
  action?: string[];
  team?: string;
  outcome?: string[];
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

interface AuditRow {
  id: number;
  ts: string;
  actor_id: string | null;
  actor_name: string;
  actor_role: string;
  action: string;
  target_type: AuditEntryTargetType;
  target_id: string | null;
  outcome: AuditOutcome;
  message: string;
  request_id: string | null;
  correlation_id: string | null;
  details_json: string | null;
}

type AuditEntryTargetType = 'team' | 'participant' | 'session' | 'settings' | 'system';
type AuditOutcome = 'requested' | 'success' | 'failure' | 'denied' | 'noop';

export function queryAudit(user: SessionUser, query: AuditQuery) {
  if (!can(user, 'audit.read')) {
    appendAudit({
      actorId: user.id,
      actorName: user.displayName,
      actorRole: user.role,
      action: 'audit.access_denied',
      targetType: 'system',
      outcome: 'denied',
      message: 'Unauthorized audit log access attempt',
    });
    throw new AppError('FORBIDDEN', 'Insufficient permissions.', { required: 'audit.read' });
  }

  const page = Math.max(1, query.page || 1);
  const pageSize = Math.min(query.pageSize || 50, 200);
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (query.actor) {
    if (query.actor === 'system') {
      conditions.push(`actor_role = 'system'`);
    } else {
      conditions.push(`actor_id = ?`);
      params.push(query.actor);
    }
  }

  if (query.action && query.action.length > 0) {
    conditions.push(`action IN (${query.action.map(() => '?').join(',')})`);
    params.push(...query.action);
  }

  if (query.team) {
    conditions.push(`target_id = ?`);
    params.push(query.team);
  }

  if (query.outcome && query.outcome.length > 0) {
    conditions.push(`outcome IN (${query.outcome.map(() => '?').join(',')})`);
    params.push(...query.outcome);
  }

  if (query.from) {
    conditions.push(`ts >= ?`);
    params.push(query.from);
  }

  if (query.to) {
    conditions.push(`ts <= ?`);
    params.push(query.to);
  }

  if (query.q) {
    conditions.push(`message LIKE ?`);
    params.push(`%${query.q}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = dbHelper.get<{ total: number }>(
    `SELECT COUNT(*) as total FROM audit_log ${where}`,
    ...params,
  );
  const total = countRow?.total || 0;

  const rows = dbHelper.all<AuditRow>(
    `SELECT * FROM audit_log ${where} ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?`,
    ...params, pageSize, offset,
  );

  const items = rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    actorId: r.actor_id,
    actorName: r.actor_name,
    actorRole: r.actor_role,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    outcome: r.outcome,
    message: r.message,
    requestId: r.request_id,
    correlationId: r.correlation_id,
    details: r.details_json ? JSON.parse(r.details_json) : null,
  }));

  return { items, page, pageSize, total };
}

export function exportAuditCsv(user: SessionUser, query: AuditQuery): string {
  if (!can(user, 'audit.read')) {
    appendAudit({
      actorId: user.id,
      actorName: user.displayName,
      actorRole: user.role,
      action: 'audit.access_denied',
      targetType: 'system',
      outcome: 'denied',
      message: 'Unauthorized audit export attempt',
    });
    throw new AppError('FORBIDDEN', 'Insufficient permissions.', { required: 'audit.read' });
  }

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (query.actor) { conditions.push(`actor_id = ?`); params.push(query.actor); }
  if (query.action && query.action.length > 0) {
    conditions.push(`action IN (${query.action.map(() => '?').join(',')})`);
    params.push(...query.action);
  }
  if (query.team) { conditions.push(`target_id = ?`); params.push(query.team); }
  if (query.outcome && query.outcome.length > 0) {
    conditions.push(`outcome IN (${query.outcome.map(() => '?').join(',')})`);
    params.push(...query.outcome);
  }
  if (query.from) { conditions.push(`ts >= ?`); params.push(query.from); }
  if (query.to) { conditions.push(`ts <= ?`); params.push(query.to); }
  if (query.q) { conditions.push(`message LIKE ?`); params.push(`%${query.q}%`); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = dbHelper.all<AuditRow>(
    `SELECT * FROM audit_log ${where} ORDER BY ts DESC LIMIT 10000`,
    ...params,
  );

  const header = 'id,ts,actor_name,actor_role,action,target_type,target_id,outcome,message,request_id,correlation_id\n';
  const lines = rows.map((r) => [
    r.id, r.ts, `"${r.actor_name}"`, r.actor_role, r.action,
    r.target_type, r.target_id || '', r.outcome, `"${r.message}"`,
    r.request_id || '', r.correlation_id || '',
  ].join(','));
  return header + lines.join('\n');
}
