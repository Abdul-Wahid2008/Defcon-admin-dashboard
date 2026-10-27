import { dbHelper } from '../../src/lib/server/db';
import type { SessionUser } from '../../src/lib/server/auth';

/** requireUser now checks the users row (active, session_epoch), so test sessions need a matching row. */
export function ensureUserRow(user: SessionUser, extra: { active?: number; epoch?: number; mustChange?: number } = {}): void {
  dbHelper.run(
    `INSERT OR REPLACE INTO users (id, username, password_hash, display_name, role, active, created_at, session_epoch, must_change_password)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    user.id, user.username, 'x', user.displayName, user.role === 'team' ? 'organizer_operator' : user.role,
    extra.active ?? 1, '2026-10-27T00:00:00Z', extra.epoch ?? 0, extra.mustChange ?? 0);
}
