import 'server-only';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { dbHelper } from '../db';
import { can } from '../permissions';
import { AppError } from '../errors';
import { appendAudit, type AuditAction } from '../audit';
import { assertNotFrozen } from '../freeze';
import type { SessionUser } from '../auth';

export interface OrganizerUser {
  id: string;
  username: string;
  displayName: string;
  role: 'organizer_admin' | 'organizer_operator';
  active: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface Row {
  id: string; username: string; display_name: string; role: 'organizer_admin' | 'organizer_operator';
  active: number; must_change_password: number; last_login_at: string | null; created_at: string;
}

const toUser = (r: Row): OrganizerUser => ({
  id: r.id, username: r.username, displayName: r.display_name, role: r.role, active: r.active === 1,
  mustChangePassword: r.must_change_password === 1, lastLoginAt: r.last_login_at, createdAt: r.created_at,
});

const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
function generatePassword(): string {
  let out = '';
  for (let i = 0; i < 16; i++) out += CHARSET[crypto.randomInt(0, CHARSET.length)];
  return out;
}

function guard(user: SessionUser, action: AuditAction, requestId: string, targetId?: string, opts: { frozenExempt?: boolean } = {}) {
  if (!can(user, 'user.manage')) {
    appendAudit({
      actorId: user.id, actorName: user.displayName, actorRole: user.role, action,
      targetType: 'user', targetId: targetId ?? null, outcome: 'denied',
      message: `Unauthorized ${action}`, requestId,
    });
    throw new AppError('FORBIDDEN', 'Insufficient permissions.', { required: 'user.manage' });
  }
  // Security actions (revoke, disable) stay available during a freeze so a compromised account can still be cut off.
  if (!opts.frozenExempt) assertNotFrozen(user, { action, targetType: 'user', targetId, requestId });
}

function find(id: string): Row {
  const row = dbHelper.get<Row>(
    `SELECT id, username, display_name, role, active, must_change_password, last_login_at, created_at FROM users WHERE id = ?`, id);
  if (!row) throw new AppError('NOT_FOUND', `User ${id} not found.`);
  return row;
}

export function listUsers(user: SessionUser, opts: { requestId: string }): OrganizerUser[] {
  void opts;
  if (!can(user, 'user.manage')) throw new AppError('FORBIDDEN', 'Insufficient permissions.', { required: 'user.manage' });
  return dbHelper.all<Row>(
    `SELECT id, username, display_name, role, active, must_change_password, last_login_at, created_at FROM users ORDER BY username`,
  ).map(toUser);
}

export async function createUser(
  user: SessionUser,
  input: { username: string; displayName: string; role: 'organizer_admin' | 'organizer_operator' },
  opts: { requestId: string },
) {
  guard(user, 'user.create', opts.requestId);
  const password = generatePassword();
  const hash = await bcrypt.hash(password, 10); // hash first: the check and insert below must have no await between them
  const id = `u_${crypto.randomBytes(6).toString('hex')}`;
  if (dbHelper.get(`SELECT 1 AS x FROM users WHERE username = ? COLLATE NOCASE`, input.username)) {
    throw new AppError('CONFLICT', `Username "${input.username}" already exists.`);
  }
  dbHelper.run(
    `INSERT INTO users (id, username, password_hash, display_name, role, active, must_change_password, created_at)
     VALUES (?, ?, ?, ?, ?, 1, 1, ?)`,
    id, input.username, hash, input.displayName, input.role, new Date().toISOString());
  appendAudit({
    actorId: user.id, actorName: user.displayName, actorRole: user.role, action: 'user.create',
    targetType: 'user', targetId: id, outcome: 'success', message: `Created ${input.role} ${input.username}`,
    requestId: opts.requestId, details: { username: input.username, role: input.role },
  });
  return { user: toUser(find(id)), password }; // plaintext only in this response
}

export async function resetPassword(user: SessionUser, id: string, opts: { requestId: string }) {
  guard(user, 'user.reset_password', opts.requestId, id);
  const target = find(id);
  const password = generatePassword();
  // Epoch bump ends every existing session of that account, so the old password's sessions die with it.
  dbHelper.run(
    `UPDATE users SET password_hash = ?, must_change_password = 1, session_epoch = session_epoch + 1 WHERE id = ?`,
    await bcrypt.hash(password, 10), id);
  appendAudit({
    actorId: user.id, actorName: user.displayName, actorRole: user.role, action: 'user.reset_password',
    targetType: 'user', targetId: id, outcome: 'success', message: `Reset password for ${target.username}`,
    requestId: opts.requestId,
  });
  return { user: toUser(find(id)), password };
}

export function revokeSessions(user: SessionUser, id: string, opts: { requestId: string }) {
  guard(user, 'user.revoke_sessions', opts.requestId, id, { frozenExempt: true });
  const target = find(id);
  dbHelper.run(`UPDATE users SET session_epoch = session_epoch + 1 WHERE id = ?`, id);
  appendAudit({
    actorId: user.id, actorName: user.displayName, actorRole: user.role, action: 'user.revoke_sessions',
    targetType: 'user', targetId: id, outcome: 'success', message: `Revoked sessions for ${target.username}`,
    requestId: opts.requestId,
  });
  return { user: toUser(find(id)) };
}

export function disableUser(user: SessionUser, id: string, opts: { requestId: string }) {
  guard(user, 'user.disable', opts.requestId, id, { frozenExempt: true });
  const target = find(id);
  if (id === user.id) throw new AppError('CONFLICT', 'You cannot disable your own account.');
  if (target.role === 'organizer_admin' && target.active === 1) {
    const admins = dbHelper.get<{ n: number }>(`SELECT COUNT(*) AS n FROM users WHERE role = 'organizer_admin' AND active = 1`)!.n;
    if (admins <= 1) throw new AppError('CONFLICT', 'Cannot disable the last active admin.');
  }
  dbHelper.run(`UPDATE users SET active = 0, session_epoch = session_epoch + 1 WHERE id = ?`, id);
  appendAudit({
    actorId: user.id, actorName: user.displayName, actorRole: user.role, action: 'user.disable',
    targetType: 'user', targetId: id, outcome: 'success', message: `Disabled ${target.username}`,
    requestId: opts.requestId,
  });
  return { user: toUser(find(id)) };
}

/** Self-service password change; also clears must_change_password and revokes the account's other sessions. */
export async function changeOwnPassword(
  user: SessionUser,
  input: { currentPassword: string; newPassword: string },
  opts: { requestId: string },
) {
  const row = dbHelper.get<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = ?`, user.id);
  if (!row || !(await bcrypt.compare(input.currentPassword, row.password_hash))) {
    appendAudit({
      actorId: user.id, actorName: user.displayName, actorRole: user.role, action: 'auth.password_change',
      targetType: 'user', targetId: user.id, outcome: 'denied', message: 'Password change refused: wrong current password',
      requestId: opts.requestId,
    });
    throw new AppError('UNAUTHENTICATED', 'Current password is incorrect.');
  }
  if (input.newPassword === input.currentPassword) throw new AppError('VALIDATION_ERROR', 'New password must differ from the current one.');
  const hash = await bcrypt.hash(input.newPassword, 10);
  // Increment in SQL and read back with no await in between, so a concurrent revoke can never be undone.
  dbHelper.run(`UPDATE users SET password_hash = ?, must_change_password = 0, session_epoch = session_epoch + 1 WHERE id = ?`, hash, user.id);
  const epoch = dbHelper.get<{ session_epoch: number }>(`SELECT session_epoch FROM users WHERE id = ?`, user.id)!.session_epoch;
  appendAudit({
    actorId: user.id, actorName: user.displayName, actorRole: user.role, action: 'auth.password_change',
    targetType: 'user', targetId: user.id, outcome: 'success', message: `${user.username} changed their password`,
    requestId: opts.requestId,
  });
  return { epoch };
}
