import 'server-only';
import { dbHelper } from './db';
import { appendAudit, type AuditAction, type TargetType } from './audit';
import { AppError } from './errors';
import type { SessionUser } from './auth';

export function isFrozen(): boolean {
  return dbHelper.get<{ value: string }>(`SELECT value FROM settings WHERE key = 'mutations_frozen'`)?.value === '1';
}

/**
 * Single guard for every mutating service call (docs/12 D19). Call it after the permission check so an
 * unauthorised caller still gets FORBIDDEN. Reads, audit export, logout and the unfreeze toggle never call it.
 */
export function assertNotFrozen(
  user: SessionUser,
  ctx: { action: AuditAction; targetType: TargetType; targetId?: string | null; requestId?: string },
): void {
  if (!isFrozen()) return;
  appendAudit({
    actorId: user.id, actorName: user.displayName, actorRole: user.role,
    action: ctx.action, targetType: ctx.targetType, targetId: ctx.targetId ?? null, outcome: 'denied',
    message: 'Mutation refused: mutations are frozen.', requestId: ctx.requestId,
  });
  throw new AppError('MUTATIONS_FROZEN', 'Mutations are frozen by an administrator. Reads and the audit log still work.');
}
