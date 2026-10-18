import 'server-only';
import { dbHelper } from '../db';
import { can } from '../permissions';
import { AppError } from '../errors';
import { appendAudit } from '../audit';
import { SessionUser } from '../auth';

type CompetitionStatus = 'not_started' | 'running' | 'paused' | 'ended';

export function getSettings(user: SessionUser) {
  if (!can(user, 'team.read')) {
    throw new AppError('FORBIDDEN', 'Insufficient permissions.', { required: 'team.read' });
  }
  const row = dbHelper.get<{ value: string }>(`SELECT value FROM settings WHERE key = 'competition_status'`);
  return { competitionStatus: (row?.value || 'not_started') as CompetitionStatus };
}

export function updateSettings(
  user: SessionUser,
  patch: { competitionStatus?: CompetitionStatus },
  opts: { requestId: string },
) {
  if (!can(user, 'settings.update')) {
    appendAudit({
      actorId: user.id, actorName: user.displayName, actorRole: user.role,
      action: 'settings.update', targetType: 'settings', outcome: 'denied',
      message: 'Unauthorized settings update',
      requestId: opts.requestId,
    });
    throw new AppError('FORBIDDEN', 'Insufficient permissions.', { required: 'settings.update' });
  }

  if (patch.competitionStatus) {
    dbHelper.run(
      `INSERT INTO settings (key, value) VALUES ('competition_status', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      patch.competitionStatus,
    );
  }

  appendAudit({
    actorId: user.id, actorName: user.displayName, actorRole: user.role,
    action: 'settings.update', targetType: 'settings', outcome: 'success',
    message: 'Settings updated',
    requestId: opts.requestId,
    details: patch,
  });

  return getSettings(user);
}
