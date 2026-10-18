import 'server-only';
import { getAdapter } from '../adapters';
import { can } from '../permissions';
import { AppError } from '../errors';
import { appendAudit } from '../audit';
import { SessionUser } from '../auth';

export async function listParticipants(user: SessionUser, teamId: string) {
  if (!can(user, 'team.read', { teamId })) {
    appendAudit({
      actorId: user.id, actorName: user.displayName, actorRole: user.role,
      action: 'participant.add', targetType: 'participant', targetId: teamId, outcome: 'denied',
      message: `Unauthorized list participants for ${teamId}`,
    });
    throw new AppError('FORBIDDEN', 'Insufficient permissions.', { required: 'team.read' });
  }
  const adapter = getAdapter();
  const team = await adapter.getTeam(teamId);
  if (!team) throw new AppError('NOT_FOUND', `Team ${teamId} not found.`);
  return team.participants;
}

export async function addParticipant(
  user: SessionUser,
  teamId: string,
  name: string,
  opts: { requestId: string },
) {
  if (!can(user, 'credential.manage', { teamId })) {
    appendAudit({
      actorId: user.id, actorName: user.displayName, actorRole: user.role,
      action: 'participant.add', targetType: 'participant', targetId: teamId, outcome: 'denied',
      message: `Unauthorized add participant to ${teamId}`,
      requestId: opts.requestId,
    });
    throw new AppError('FORBIDDEN', 'Insufficient permissions.', { required: 'credential.manage' });
  }

  const adapter = getAdapter();
  const { participant, credential } = await adapter.addParticipant(teamId, name);

  appendAudit({
    actorId: user.id, actorName: user.displayName, actorRole: user.role,
    action: 'participant.add', targetType: 'participant', targetId: participant.id, outcome: 'success',
    message: `Participant ${participant.username} added to ${teamId}`,
    requestId: opts.requestId,
    details: { teamId, participantName: name },
  });

  appendAudit({
    actorId: user.id, actorName: user.displayName, actorRole: user.role,
    action: 'credential.issue', targetType: 'participant', targetId: participant.id, outcome: 'success',
    message: `Credential issued to ${participant.username}`,
    requestId: opts.requestId,
  });

  return { participant, credential };
}

export async function removeParticipant(
  user: SessionUser,
  teamId: string,
  participantId: string,
  opts: { requestId: string },
) {
  if (!can(user, 'credential.manage', { teamId })) {
    appendAudit({
      actorId: user.id, actorName: user.displayName, actorRole: user.role,
      action: 'participant.remove', targetType: 'participant', targetId: participantId, outcome: 'denied',
      message: `Unauthorized remove participant ${participantId}`,
      requestId: opts.requestId,
    });
    throw new AppError('FORBIDDEN', 'Insufficient permissions.', { required: 'credential.manage' });
  }

  const adapter = getAdapter();
  await adapter.removeParticipant(teamId, participantId);

  appendAudit({
    actorId: user.id, actorName: user.displayName, actorRole: user.role,
    action: 'participant.remove', targetType: 'participant', targetId: participantId, outcome: 'success',
    message: `Participant ${participantId} removed from ${teamId}`,
    requestId: opts.requestId,
    details: { teamId },
  });
}

export async function rotateCredentials(
  user: SessionUser,
  teamId: string,
  participantId?: string,
  opts: { requestId: string } = { requestId: '' },
) {
  if (!can(user, 'credential.manage', { teamId })) {
    appendAudit({
      actorId: user.id, actorName: user.displayName, actorRole: user.role,
      action: 'credential.rotate', targetType: 'participant', targetId: teamId, outcome: 'denied',
      message: `Unauthorized rotate credentials for ${teamId}`,
      requestId: opts.requestId,
    });
    throw new AppError('FORBIDDEN', 'Insufficient permissions.', { required: 'credential.manage' });
  }

  const adapter = getAdapter();
  const credentials = await adapter.rotateCredentials(teamId, participantId);

  appendAudit({
    actorId: user.id, actorName: user.displayName, actorRole: user.role,
    action: 'credential.rotate', targetType: 'participant', targetId: participantId ?? teamId,
    outcome: 'success',
    message: participantId
      ? `Credential rotated for participant ${participantId}`
      : `All credentials rotated for ${teamId}`,
    requestId: opts.requestId,
    details: { teamId, count: credentials.length },
  });

  return credentials;
}
