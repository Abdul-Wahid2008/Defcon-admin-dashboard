import type { MetaResponse } from './schemas';

export type ResetKind = MetaResponse['capabilities']['resetKind'];

export interface ResetCopy {
  title: string;
  body: string;
  button: string;
  /** Reset needs a written reason and the typed team id (anything beyond "restore latest accepted patch"). */
  requiresConfirmation: boolean;
}

export const MIN_REASON_CHARS = 10;

/**
 * Environment-reset dialog text, chosen by what the adapter says a reset really does (docs/12 D22).
 * Never claim "restores the latest patch" unless resetKind === 'restore_patch'.
 */
export function resetCopy(kind: ResetKind, acceptedPatchVersion: number): ResetCopy {
  switch (kind) {
    case 'restore_patch':
      return {
        title: 'Reset environment?',
        body: `The environment will be restored to the latest accepted patch (v${acceptedPatchVersion}), not the original vulnerable baseline. Preserved: flags and challenge state · scores and submissions · accepted patches · audit and deployment history · application data. Anything not captured in an accepted patch is discarded.`,
        button: 'Reset environment',
        requiresConfirmation: false,
      };
    case 'recreate_pristine':
      // TODO(club): UNCONFIRMED wording (docs/12 C1, docs/15 §2.5). Confirm what an admin reset restores and whether it wipes the service DB.
      return {
        title: 'Reset environment from the pristine image?',
        body: "Resets this team's environment from the pristine image. Player patches and the service database may be erased and the team may lose SLA points. Flags and scores are held by the game server and are not affected by this action.",
        button: 'Reset environment',
        requiresConfirmation: true,
      };
    case 'restart':
      return {
        title: 'Restart environment?',
        body: "Restarts this team's containers. Patch restore is not available: files changed inside the containers are not restored, and services are unreachable while they restart.",
        button: 'Restart environment',
        requiresConfirmation: true,
      };
  }
}

export function isResetConfirmed(copy: ResetCopy, reason: string, typedTeamId: string, teamId: string): boolean {
  return !copy.requiresConfirmation || (reason.trim().length >= MIN_REASON_CHARS && typedTeamId === teamId);
}
