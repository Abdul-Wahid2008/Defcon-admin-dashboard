import 'server-only';
import { getAdapter } from '../adapters';
import { can } from '../permissions';
import { AppError } from '../errors';
import { appendAudit, newCorrelationId } from '../audit';
import { lookupIdempotencyKey, storeIdempotencyKey } from '../idempotency';
import { SessionUser } from '../auth';
import { TeamQuery, CreateTeamInput, UpdateTeamInput, TeamDetail, IssuedCredential } from '../adapters/types';
import { SOFT_TEAM_CAP } from '../../config';
import { dbHelper } from '../db';

export async function listTeams(user: SessionUser, query: TeamQuery) {
  if (!can(user, 'team.read')) {
    appendAudit({
      actorId: user.id, actorName: user.displayName, actorRole: user.role,
      action: 'team.create', targetType: 'team', outcome: 'denied',
      message: 'Unauthorized list teams attempt',
    });
    throw new AppError('FORBIDDEN', 'Insufficient permissions.', { required: 'team.read' });
  }
  const adapter = getAdapter();
  return adapter.listTeams(query);
}

export async function getTeam(user: SessionUser, teamId: string) {
  if (!can(user, 'team.read', { teamId })) {
    appendAudit({
      actorId: user.id, actorName: user.displayName, actorRole: user.role,
      action: 'team.create', targetType: 'team', targetId: teamId, outcome: 'denied',
      message: `Unauthorized get team ${teamId}`,
    });
    throw new AppError('FORBIDDEN', 'Insufficient permissions.', { required: 'team.read' });
  }
  const adapter = getAdapter();
  const team = await adapter.getTeam(teamId);
  if (!team) throw new AppError('NOT_FOUND', `Team ${teamId} not found.`);
  return team;
}

export async function createTeam(
  user: SessionUser,
  input: CreateTeamInput,
  opts: { requestId: string; idempotencyKey?: string | null },
) {
  if (!can(user, 'team.create')) {
    appendAudit({
      actorId: user.id, actorName: user.displayName, actorRole: user.role,
      action: 'team.create', targetType: 'team', outcome: 'denied',
      message: 'Unauthorized create team attempt',
      requestId: opts.requestId,
    });
    throw new AppError('FORBIDDEN', 'Insufficient permissions.', { required: 'team.create' });
  }

  // Idempotency check
  if (opts.idempotencyKey) {
    const stored = lookupIdempotencyKey(opts.idempotencyKey, user.id, 'POST /api/teams');
    if (stored) {
      return { ...stored, replay: true };
    }
  }

  // Check for duplicate name (case-insensitive, among active teams)
  const existing = dbHelper.get<{ id: string }>(
    `SELECT id FROM teams WHERE name = ? COLLATE NOCASE AND archived_at IS NULL`,
    input.name,
  );
  if (existing) {
    throw new AppError('CONFLICT', `A team named "${input.name}" already exists.`);
  }

  const adapter = getAdapter();
  const correlationId = newCorrelationId();
  const { team, credentials, completionDueAt } = await adapter.createTeam(input);

  // Audit team.create
  appendAudit({
    actorId: user.id, actorName: user.displayName, actorRole: user.role,
    action: 'team.create', targetType: 'team', targetId: team.id, outcome: 'success',
    message: `Team ${team.id} (${team.name}) created`,
    requestId: opts.requestId,
    correlationId,
    details: { participantCount: credentials.length },
  });

  // Audit env.provision (requested)
  appendAudit({
    actorId: user.id, actorName: user.displayName, actorRole: user.role,
    action: 'env.provision', targetType: 'team', targetId: team.id, outcome: 'requested',
    message: `Provisioning environment for ${team.id}`,
    requestId: opts.requestId,
    correlationId,
    details: { completionDueAt },
  });

  // Soft cap warning flag
  const activeTeams = dbHelper.get<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM teams WHERE archived_at IS NULL`,
  );
  const softCapExceeded = (activeTeams?.cnt || 0) > SOFT_TEAM_CAP;

  const responseBody = { team, credentials };
  const result = { status: 201 as const, body: responseBody, softCapExceeded, replay: false };

  if (opts.idempotencyKey) {
    storeIdempotencyKey(opts.idempotencyKey, user.id, 'POST /api/teams', {
      status: 201,
      body: responseBody,
    });
  }

  return result;
}

export async function importTeams(
  user: SessionUser,
  input: {
    rows: Array<{ name: string; participantNames?: string[] }>;
    autoProvision?: boolean;
    dryRun?: boolean;
  },
  opts: { requestId: string },
) {
  if (!can(user, 'team.create')) {
    appendAudit({
      actorId: user.id, actorName: user.displayName, actorRole: user.role,
      action: 'team.create', targetType: 'team', outcome: 'denied',
      message: 'Unauthorized team import attempt', requestId: opts.requestId,
    });
    throw new AppError('FORBIDDEN', 'Insufficient permissions.', { required: 'team.create' });
  }

  const seen = new Set<string>();
  const created: Array<{ team: TeamDetail; credentials: IssuedCredential[] }> = [];
  const skipped: Array<{ row: { name: string; participantNames?: string[] }; reason: string }> = [];

  for (const row of input.rows) {
    const normalizedName = row.name.trim().toLocaleLowerCase();
    if (seen.has(normalizedName)) {
      skipped.push({ row, reason: 'Duplicate team name in import.' });
      continue;
    }
    seen.add(normalizedName);

    const existing = dbHelper.get<{ id: string }>(
      `SELECT id FROM teams WHERE name = ? COLLATE NOCASE AND archived_at IS NULL`,
      row.name.trim(),
    );
    if (existing) {
      skipped.push({ row, reason: 'A team with this name already exists.' });
      continue;
    }

    if (input.dryRun) continue;

    try {
      const result = await createTeam(user, {
        name: row.name.trim(),
        participantNames: row.participantNames,
        autoProvision: input.autoProvision,
      }, { requestId: opts.requestId });
      const body = result.body as { team: TeamDetail; credentials: IssuedCredential[] };
      const team = await getAdapter().getTeam(body.team.id);
      if (team) created.push({ team, credentials: body.credentials });
    } catch (error) {
      skipped.push({
        row,
        reason: error instanceof AppError ? error.message : 'Unable to create team.',
      });
    }
  }

  return { created, skipped };
}

export async function updateTeam(
  user: SessionUser,
  teamId: string,
  patch: UpdateTeamInput,
  opts: { requestId: string },
) {
  if (!can(user, 'team.update', { teamId })) {
    appendAudit({
      actorId: user.id, actorName: user.displayName, actorRole: user.role,
      action: 'team.update', targetType: 'team', targetId: teamId, outcome: 'denied',
      message: `Unauthorized update team ${teamId}`,
      requestId: opts.requestId,
    });
    throw new AppError('FORBIDDEN', 'Insufficient permissions.', { required: 'team.update' });
  }

  // Check for name uniqueness if renaming
  if (patch.name) {
    const existing = dbHelper.get<{ id: string }>(
      `SELECT id FROM teams WHERE name = ? COLLATE NOCASE AND archived_at IS NULL AND id != ?`,
      patch.name, teamId,
    );
    if (existing) throw new AppError('CONFLICT', `A team named "${patch.name}" already exists.`);
  }

  const adapter = getAdapter();
  const prev = await adapter.getTeam(teamId);
  if (!prev) throw new AppError('NOT_FOUND', `Team ${teamId} not found.`);

  const team = await adapter.updateTeam(teamId, patch);

  // Determine audit action
  let action: 'team.update' | 'team.suspend' | 'team.reactivate' = 'team.update';
  if (patch.accountStatus === 'suspended') action = 'team.suspend';
  else if (patch.accountStatus === 'active') action = 'team.reactivate';

  const changed = Object.keys(patch).filter(k => (patch as any)[k] !== undefined);
  appendAudit({
    actorId: user.id, actorName: user.displayName, actorRole: user.role,
    action, targetType: 'team', targetId: teamId, outcome: 'success',
    message: `Team ${teamId} updated`,
    requestId: opts.requestId,
    details: { changed },
  });

  return team;
}

export async function requestLifecycleAction(
  user: SessionUser,
  teamId: string,
  action: 'start' | 'stop' | 'reset' | 'delete',
  opts: { requestId: string; idempotencyKey?: string | null; confirmName?: string },
) {
  const permMap: Record<string, 'env.start' | 'env.stop' | 'env.reset' | 'team.delete'> = {
    start: 'env.start', stop: 'env.stop', reset: 'env.reset', delete: 'team.delete',
  };
  const required = permMap[action];
  const auditAction = `env.${action}` as 'env.start' | 'env.stop' | 'env.reset' | 'env.delete';

  if (!can(user, required, { teamId })) {
    appendAudit({
      actorId: user.id, actorName: user.displayName, actorRole: user.role,
      action: auditAction, targetType: 'team', targetId: teamId, outcome: 'denied',
      message: `Unauthorized ${action} for ${teamId}`,
      requestId: opts.requestId,
    });
    throw new AppError('FORBIDDEN', 'Insufficient permissions.', { required });
  }

  // Delete requires typed confirmation
  if (action === 'delete') {
    const team = await getAdapter().getTeam(teamId);
    if (!team) throw new AppError('NOT_FOUND', `Team ${teamId} not found.`);
    if (opts.confirmName !== team.name) {
      throw new AppError('CONFIRMATION_MISMATCH', 'Team name confirmation does not match.', {
        expected: team.name,
      });
    }
  }

  const route = `POST /api/teams/${teamId}/environment/${action}`;
  if (opts.idempotencyKey) {
    const stored = lookupIdempotencyKey(opts.idempotencyKey, user.id, route);
    if (stored) {
      return { ...stored, replay: true };
    }
  }

  const adapter = getAdapter();
  const correlationId = newCorrelationId();
  const result = await adapter.requestAction(teamId, action, { correlationId });

  if ('noop' in result && result.noop) {
    appendAudit({
      actorId: user.id, actorName: user.displayName, actorRole: user.role,
      action: auditAction, targetType: 'team', targetId: teamId, outcome: 'noop',
      message: result.reason,
      requestId: opts.requestId,
      correlationId,
    });
    const body = { teamId, action, noop: true, reason: result.reason };
    if (opts.idempotencyKey) {
      storeIdempotencyKey(opts.idempotencyKey, user.id, route, { status: 200, body });
    }
    return { status: 200 as const, body, replay: false };
  }

  // Accepted
  appendAudit({
    actorId: user.id, actorName: user.displayName, actorRole: user.role,
    action: auditAction, targetType: 'team', targetId: teamId, outcome: 'requested',
    message: `${action} requested for ${teamId}`,
    requestId: opts.requestId,
    correlationId,
    details: { transition: (result as any).transition },
  });

  const body = result as any;
  if (opts.idempotencyKey) {
    storeIdempotencyKey(opts.idempotencyKey, user.id, route, { status: 202, body });
  }
  return { status: 202 as const, body, replay: false };
}

export async function deleteTeam(
  user: SessionUser,
  teamId: string,
  confirmName: string,
  opts: { requestId: string; idempotencyKey?: string | null },
) {
  return requestLifecycleAction(user, teamId, 'delete', {
    requestId: opts.requestId,
    idempotencyKey: opts.idempotencyKey,
    confirmName,
  });
}
