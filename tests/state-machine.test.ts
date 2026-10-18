import { describe, it, expect, beforeEach } from 'vitest';
import { MockAdapter } from '../src/lib/server/adapters/mock';
import { dbHelper } from '../src/lib/server/db';

interface ArchivedTeamRow {
  archived_at: string | null;
}

interface PatchVersionRow {
  accepted_patch_version: number;
}

describe('MockAdapter State Machine', () => {
  let adapter: MockAdapter;
  let mockNow = new Date('2026-10-17T10:00:00Z');

  const advanceClock = (ms: number) => {
    mockNow = new Date(mockNow.getTime() + ms);
  };

  beforeEach(() => {
    // Clear mock tables before each test
    dbHelper.run(`DELETE FROM checks`);
    dbHelper.run(`DELETE FROM services`);
    dbHelper.run(`DELETE FROM environments`);
    dbHelper.run(`DELETE FROM participants`);
    dbHelper.run(`DELETE FROM teams`);

    adapter = new MockAdapter(() => mockNow.toISOString());
  });

  async function setupTeam(name = 'Test Team') {
    const result = await adapter.createTeam({ name });
    return result.team;
  }

  describe('Transition Table', () => {
    it('should transition provisioning -> running', async () => {
      const team = await setupTeam();
      const teamId = team.id;

      // Initial state is provisioning
      let detail = await adapter.getTeam(teamId);
      expect(detail?.environment.lifecycleState).toBe('provisioning');

      // Advance clock past provision duration (6s)
      advanceClock(7000);
      await adapter.resolveDue();

      detail = await adapter.getTeam(teamId);
      expect(detail?.environment.lifecycleState).toBe('running');
    });

    it('should transition running -> stopping -> stopped', async () => {
      const team = await setupTeam();
      const teamId = team.id;

      // Move to running
      advanceClock(7000);
      await adapter.resolveDue();

      const res = await adapter.requestAction(teamId, 'stop', { correlationId: 'c1' });
      expect(res).not.toHaveProperty('noop');
      expect((await adapter.getTeam(teamId))?.environment.lifecycleState).toBe('stopping');

      // Advance clock past stop duration (2s)
      advanceClock(3000);
      await adapter.resolveDue();

      expect((await adapter.getTeam(teamId))?.environment.lifecycleState).toBe('stopped');
    });

    it('should transition stopped -> starting -> running', async () => {
      const team = await setupTeam();
      const teamId = team.id;

      // Get to stopped
      advanceClock(7000);
      await adapter.resolveDue();
      await adapter.requestAction(teamId, 'stop', { correlationId: 'c1' });
      advanceClock(3000);
      await adapter.resolveDue();

      const res = await adapter.requestAction(teamId, 'start', { correlationId: 'c2' });
      expect((await adapter.getTeam(teamId))?.environment.lifecycleState).toBe('starting');

      advanceClock(4000);
      await adapter.resolveDue();

      expect((await adapter.getTeam(teamId))?.environment.lifecycleState).toBe('running');
    });

    it('should transition running -> resetting -> running', async () => {
      const team = await setupTeam();
      const teamId = team.id;

      advanceClock(7000);
      await adapter.resolveDue();

      await adapter.requestAction(teamId, 'reset', { correlationId: 'c1' });
      expect((await adapter.getTeam(teamId))?.environment.lifecycleState).toBe('resetting');

      advanceClock(6000);
      await adapter.resolveDue();

      expect((await adapter.getTeam(teamId))?.environment.lifecycleState).toBe('running');
    });

    it('should transition running -> deleting -> deleted', async () => {
      const team = await setupTeam();
      const teamId = team.id;

      advanceClock(7000);
      await adapter.resolveDue();

      await adapter.requestAction(teamId, 'delete', { correlationId: 'c1' });
      expect((await adapter.getTeam(teamId))?.environment.lifecycleState).toBe('deleting');

      advanceClock(4000);
      await adapter.resolveDue();

      expect((await adapter.getTeam(teamId))?.environment.lifecycleState).toBe('deleted');

      // Check team is archived
      const teamData = dbHelper.get<ArchivedTeamRow>(
        `SELECT archived_at FROM teams WHERE id = ?`,
        teamId,
      );
      expect(teamData?.archived_at).not.toBeNull();
    });
  });

  describe('Edge Cases & Invariants', () => {
    it('should return no-op when starting a running environment', async () => {
      const team = await setupTeam();
      const teamId = team.id;
      advanceClock(7000);
      await adapter.resolveDue();

      const result = await adapter.requestAction(teamId, 'start', { correlationId: 'c1' });
      expect(result).toHaveProperty('noop', true);
    });

    it('should throw ACTION_IN_PROGRESS when a transition is pending', async () => {
      const team = await setupTeam();
      const teamId = team.id;
      advanceClock(7000);
      await adapter.resolveDue();

      await adapter.requestAction(teamId, 'stop', { correlationId: 'c1' });

      await expect(adapter.requestAction(teamId, 'reset', { correlationId: 'c2' }))
        .rejects.toThrow('ACTION_IN_PROGRESS');
    });

    it('should throw INVALID_TRANSITION for forbidden actions (stopped -> reset)', async () => {
      const team = await setupTeam();
      const teamId = team.id;
      advanceClock(7000);
      await adapter.resolveDue();
      await adapter.requestAction(teamId, 'stop', { correlationId: 'c1' });
      advanceClock(3000);
      await adapter.resolveDue();

      await expect(adapter.requestAction(teamId, 'reset', { correlationId: 'c2' }))
        .rejects.toThrow('INVALID_TRANSITION');
    });

    it('should handle simulated failures via fail_next_action', async () => {
      const team = await setupTeam();
      const teamId = team.id;
      advanceClock(7000);
      await adapter.resolveDue();

      dbHelper.run(`UPDATE environments SET fail_next_action = 'stop' WHERE team_id = ?`, teamId);

      await adapter.requestAction(teamId, 'stop', { correlationId: 'c1' });
      advanceClock(3000);
      await adapter.resolveDue();

      const detail = await adapter.getTeam(teamId);
      expect(detail?.environment.lifecycleState).toBe('failed');
      expect(detail?.environment.failureReason).toContain('stop failed');
    });

    it('should maintain accepted_patch_version during lifecycle actions', async () => {
      const team = await setupTeam();
      const teamId = team.id;
      const version = dbHelper.get<PatchVersionRow>(
        `SELECT accepted_patch_version FROM environments WHERE team_id = ?`,
        teamId,
      )?.accepted_patch_version;

      advanceClock(7000);
      await adapter.resolveDue();
      await adapter.requestAction(teamId, 'stop', { correlationId: 'c1' });
      advanceClock(3000);
      await adapter.resolveDue();

      const versionAfter = dbHelper.get<PatchVersionRow>(
        `SELECT accepted_patch_version FROM environments WHERE team_id = ?`,
        teamId,
      )?.accepted_patch_version;
      expect(versionAfter).toBe(version);
    });
  });
});
