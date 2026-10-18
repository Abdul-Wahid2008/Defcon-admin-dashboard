import { beforeEach, describe, expect, it } from 'vitest';
import { importTeams, validateBulkConfirmation } from '../src/lib/server/services/teams';
import { dbHelper } from '../src/lib/server/db';
import { TeamImportRequestSchema, BulkEnvActionRequestSchema } from '../src/lib/schemas';
import type { SessionUser } from '../src/lib/server/auth';

const admin: SessionUser = {
  id: 'user-admin',
  username: 'admin',
  displayName: 'Admin',
  role: 'organizer_admin',
};

const teamUser = {
  ...admin,
  role: 'team',
  teamId: 'team-01',
} as SessionUser;

describe('P17 bulk and import contracts', () => {
  beforeEach(() => {
    dbHelper.run('DELETE FROM checks');
    dbHelper.run('DELETE FROM services');
    dbHelper.run('DELETE FROM environments');
    dbHelper.run('DELETE FROM participants');
    dbHelper.run('DELETE FROM teams');
  });

  it('dry-run validates rows without writing teams or returning credentials', async () => {
    const result = await importTeams(admin, {
      rows: [{ name: 'Dry Run Team', participantNames: ['One'] }],
      dryRun: true,
    }, { requestId: 'r_p17_dry_run' });

    expect(result.created).toHaveLength(0);
    expect(result.skipped[0]?.reason).toContain('dry-run');
    expect(dbHelper.get<{ count: number }>('SELECT COUNT(*) as count FROM teams')?.count).toBe(0);
  });

  it('imports in input order, skips duplicate rows, and only returns plaintext on creation', async () => {
    const result = await importTeams(admin, {
      rows: [
        { name: 'Alpha Team', participantNames: ['A'] },
        { name: 'alpha team', participantNames: ['Duplicate'] },
        { name: 'Beta Team', participantNames: ['B'] },
      ],
    }, { requestId: 'r_p17_partial' });

    expect(result.created.map(({ team }) => team.id)).toEqual(['team-01', 'team-02']);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toContain('Duplicate');
    expect(result.created[0]?.credentials[0]?.password).toBeTruthy();
    expect(JSON.stringify(result.created.map(({ team }) => team))).not.toContain('password');
    const stored = dbHelper.get<{ password_hash: string }>(
      'SELECT password_hash FROM participants WHERE team_id = ?',
      'team-01',
    );
    expect(stored?.password_hash).not.toBe(result.created[0]?.credentials[0]?.password);
  });

  it('reports existing names as row-level skips while allowing later rows to succeed', async () => {
    await importTeams(admin, { rows: [{ name: 'Existing Team' }] }, { requestId: 'r_p17_existing' });
    const result = await importTeams(admin, {
      rows: [{ name: 'Existing Team' }, { name: 'Later Team' }],
    }, { requestId: 'r_p17_existing_partial' });

    expect(result.created.map(({ team }) => team.name)).toEqual(['Later Team']);
    expect(result.skipped[0]?.reason).toContain('already exists');
  });

  it('denies team-scoped users before writing any import rows', async () => {
    await expect(importTeams(teamUser, {
      rows: [{ name: 'Forbidden Team' }],
    }, { requestId: 'r_p17_denied' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(dbHelper.get<{ count: number }>('SELECT COUNT(*) as count FROM teams')?.count).toBe(0);
  });

  it('requires the documented bulk action shape and rejects reset/delete actions', () => {
    expect(BulkEnvActionRequestSchema.safeParse({
      action: 'start',
      teamIds: ['team-01'],
    }).success).toBe(true);
    expect(BulkEnvActionRequestSchema.safeParse({
      action: 'reset',
      teamIds: ['team-01'],
    }).success).toBe(false);
    expect(BulkEnvActionRequestSchema.safeParse({
      action: 'start',
      teamIds: [],
    }).success).toBe(false);
    expect(TeamImportRequestSchema.safeParse({
      rows: [{ name: 'Valid Team', participantNames: ['P1'] }],
    }).success).toBe(true);
  });

  it('requires typed confirmation only for bulk selections of five or more', () => {
    expect(() => validateBulkConfirmation('start', ['team-01', 'team-02'], undefined)).not.toThrow();
    expect(() => validateBulkConfirmation(
      'stop',
      ['team-01', 'team-02', 'team-03', 'team-04', 'team-05'],
      'START ALL',
    )).toThrowError(/STOP ALL/);
    expect(() => validateBulkConfirmation(
      'stop',
      ['team-01', 'team-02', 'team-03', 'team-04', 'team-05'],
      'STOP ALL',
    )).not.toThrow();
  });
});
