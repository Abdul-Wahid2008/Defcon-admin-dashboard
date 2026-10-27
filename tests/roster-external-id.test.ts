import { beforeEach, describe, expect, it } from 'vitest';
import { importTeams, createTeam } from '../src/lib/server/services/teams';
import { applyHealthBatch } from '../src/lib/server/health/apply';
import { dbHelper } from '../src/lib/server/db';
import type { SessionUser } from '../src/lib/server/auth';

const admin: SessionUser = { id: 'u_admin', username: 'admin', displayName: 'Admin', role: 'organizer_admin' };
const opts = { requestId: 'r_roster' };

beforeEach(() => {
  for (const t of ['flagstore_results', 'checks', 'alerts', 'services', 'environments', 'participants', 'teams']) dbHelper.run(`DELETE FROM ${t}`);
  dbHelper.run(`UPDATE settings SET value = '0' WHERE key = 'mutations_frozen'`);
});

describe('roster import carries the engine team id', () => {
  it('stores external_team_id, so health rows for that id find the team', async () => {
    const res = await importTeams(admin, { rows: [{ name: 'Alpha', externalTeamId: '17' }, { name: 'Beta' }] }, opts);
    expect(res.created).toHaveLength(2);
    expect(dbHelper.get<{ external_team_id: string | null }>(`SELECT external_team_id FROM teams WHERE name = 'Alpha'`)!.external_team_id).toBe('17');
    expect(dbHelper.get<{ external_team_id: string | null }>(`SELECT external_team_id FROM teams WHERE name = 'Beta'`)!.external_team_id).toBeNull();

    const r = applyHealthBatch([
      { externalTeamId: '17', serviceKey: 'docuvault', flagstore: 'flag0', verdict: 'OK', round: 1 },
      { externalTeamId: '18', serviceKey: 'docuvault', flagstore: 'flag0', verdict: 'OK', round: 1 },
    ], 'ingest');
    expect(r.accepted).toBe(1);
    expect(r.rejected).toEqual([{ index: 1, reason: 'unknown_team' }]);
  });

  it('skips a duplicate engine id inside the file and one already used, in dry-run and for real', async () => {
    await importTeams(admin, { rows: [{ name: 'Gamma', externalTeamId: '5' }] }, opts);
    for (const dryRun of [true, false]) {
      const res = await importTeams(admin, { dryRun, rows: [
        { name: 'Delta', externalTeamId: '5' },
        { name: 'Epsilon', externalTeamId: '6' },
        { name: 'Zeta', externalTeamId: '6' },
      ] }, opts);
      expect(res.skipped.map(s => [s.row.name, s.reason.includes('already used')])).toEqual(
        dryRun ? [['Delta', true], ['Epsilon', false], ['Zeta', true]] : [['Delta', true], ['Zeta', true]]);
    }
  });

  it('a single create with a used engine id is a conflict', async () => {
    await createTeam(admin, { name: 'Eta', externalTeamId: '9' }, opts);
    await expect(createTeam(admin, { name: 'Theta', externalTeamId: '9' }, opts)).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
