import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }) }));
vi.mock('@tanstack/react-query', async (orig) => ({ ...(await orig<typeof import('@tanstack/react-query')>()), useQueryClient: () => ({ invalidateQueries: () => undefined }) }));

import { IncidentList, describeProblems } from '../src/components/overview/IncidentList';
import { SHORTCUTS } from '../src/components/layout/CommandPalette';
import { acknowledgeAlert } from '../src/lib/server/services/alerts';
import { updateTeam } from '../src/lib/server/services/teams';
import { applyHealthBatch } from '../src/lib/server/health/apply';
import { MockAdapter } from '../src/lib/server/adapters/mock';
import { dbHelper } from '../src/lib/server/db';
import { getOverview } from '../src/lib/server/services/overview';
import type { OverviewData } from '../src/lib/schemas';
import type { SessionUser } from '../src/lib/server/auth';

const admin: SessionUser = { id: 'u_admin', username: 'admin', displayName: 'Admin', role: 'organizer_admin' };
const operator: SessionUser = { id: 'u_op', username: 'operator', displayName: 'Operator', role: 'organizer_operator' };
const teamUser: SessionUser = { id: 'u_team', username: 'team-01', displayName: 'Team', role: 'team', teamId: 'team-01' };
const opts = { requestId: 'r_w6' };

type Team = OverviewData['grid'][number];
const svc = (over: Partial<Team['services'][number]> = {}): Team['services'][number] => ({
  key: 'docuvault', name: 'DocuVault', reachability: 'pass', functional: 'pass', stale: false, flagstores: ['OK', 'OK', 'OK'], ...over,
});
const team = (id: string, over: Partial<Team> = {}, services = [svc()]): Team => ({
  teamId: id, name: `Team ${id}`, lifecycleState: 'running', health: 'healthy', pending: false, services, ...over,
});

describe('incident view', () => {
  it('describes problems in words, including the failing flagstore', () => {
    expect(describeProblems(team('t', {}, [svc({ functional: 'fail', flagstores: ['OK', 'MUMBLE', 'OK'] })]))).toEqual(['DocuVault: functional fail (flag1 MUMBLE)']);
    expect(describeProblems(team('t', { lifecycleState: 'failed' }))).toEqual(['Environment failed']);
    expect(describeProblems(team('t', {}, [svc({ stale: true })]))).toEqual(['DocuVault: no recent result (stale)']);
    expect(describeProblems(team('t'))).toEqual([]);
  });

  it('lists only teams with a problem, worst first, with permission-aware restart buttons', () => {
    const grid = [
      team('team-01'),
      team('team-02', {}, [svc({ functional: 'fail', flagstores: ['OK', 'MUMBLE', 'OK'] })]),
      team('team-03', {}, [svc({ reachability: 'fail', flagstores: ['OFFLINE', 'OFFLINE', 'OFFLINE'] })]),
      team('team-04', { lifecycleState: 'failed' }),
    ];
    const html = renderToStaticMarkup(createElement(IncidentList, { grid, serviceActions: true }));
    expect(html).not.toContain('team-01');
    expect(html.indexOf('team-04')).toBeLessThan(html.indexOf('team-03'));
    expect(html.indexOf('team-03')).toBeLessThan(html.indexOf('team-02'));
    expect(html).toContain('Open team');
    expect(html).toContain('Run check');
    expect(html).toContain('Restart DocuVault');

    const noActions = renderToStaticMarkup(createElement(IncidentList, { grid, serviceActions: false }));
    expect(noActions).not.toContain('Restart DocuVault');
    expect(renderToStaticMarkup(createElement(IncidentList, { grid: [team('team-01')], serviceActions: true }))).toContain('No team has a failing');
  });

  it('documents the keyboard shortcuts it implements', () => {
    const keys = SHORTCUTS.map(s => s.keys).join(' | ');
    expect(keys).toContain('Ctrl+K');
    expect(keys).toContain('/');
    expect(keys).toContain('?');
    expect(keys).toContain('Esc');
  });
});

describe('alert acknowledgement', () => {
  let teamId = '';
  beforeEach(async () => {
    for (const t of ['flagstore_results', 'checks', 'alerts', 'services', 'environments', 'participants', 'teams']) dbHelper.run(`DELETE FROM ${t}`);
    dbHelper.run(`UPDATE settings SET value = '0' WHERE key = 'mutations_frozen'`);
    const { team: t } = await new MockAdapter().createTeam({ name: 'Alert Team' });
    teamId = t.id;
    dbHelper.run(`UPDATE teams SET external_team_id = '1' WHERE id = ?`, teamId);
    applyHealthBatch(['flag0', 'flag1', 'flag2'].map(flagstore => ({ externalTeamId: '1', serviceKey: 'docuvault', flagstore, verdict: 'OFFLINE', round: 1 })), 'ingest', '2026-10-27T10:00:00.000Z');
  });
  const openAlert = () => dbHelper.get<{ id: string; acked_at: string | null; acked_by: string | null; ack_note: string | null; resolved_at: string | null }>(
    `SELECT id, acked_at, acked_by, ack_note, resolved_at FROM alerts WHERE resolved_at IS NULL AND kind = 'service_down'`)!;
  const auditRows = (outcome: string) => dbHelper.all<{ message: string; details_json: string; actor_name: string }>(
    `SELECT message, details_json, actor_name FROM audit_log WHERE action = 'alert.ack' AND outcome = ?`, outcome);

  it('acknowledges with a note, keeps it open, drops it from the badge, and is idempotent', async () => {
    const before = (await getOverview(admin)).openAlertCount;
    const a = openAlert();
    expect(acknowledgeAlert(operator, a.id, { note: ' checker looks wrong ' }, opts)).toEqual({ id: a.id, status: 'acknowledged' });
    expect(openAlert()).toMatchObject({ resolved_at: null, acked_by: 'Operator', ack_note: 'checker looks wrong' });
    expect((await getOverview(admin)).openAlertCount).toBe(before - 1);
    expect(acknowledgeAlert(admin, a.id, {}, opts).status).toBe('already_acknowledged');
    const rows = auditRows('success');
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].details_json)).toMatchObject({ alertId: a.id, resolved: false, note: 'checker looks wrong' });
    // the same failure arriving again does not create a second open alert
    applyHealthBatch(['flag0', 'flag1', 'flag2'].map(flagstore => ({ externalTeamId: '1', serviceKey: 'docuvault', flagstore, verdict: 'OFFLINE', round: 2 })), 'ingest', '2026-10-27T10:01:30.000Z');
    expect(dbHelper.get<{ n: number }>(`SELECT COUNT(*) AS n FROM alerts WHERE resolved_at IS NULL AND kind = 'service_down'`)!.n).toBe(1);
  });

  it('resolves by hand with a note, and the alert reopens if the failure is still present', () => {
    const a = openAlert();
    expect(acknowledgeAlert(admin, a.id, { note: 'rebooted host', resolve: true }, opts).status).toBe('resolved');
    expect(dbHelper.get<{ resolved_at: string | null }>(`SELECT resolved_at FROM alerts WHERE id = ?`, a.id)!.resolved_at).not.toBeNull();
    expect(acknowledgeAlert(admin, a.id, { resolve: true }, opts).status).toBe('already_resolved');
    applyHealthBatch(['flag0', 'flag1', 'flag2'].map(flagstore => ({ externalTeamId: '1', serviceKey: 'docuvault', flagstore, verdict: 'OFFLINE', round: 3 })), 'ingest', '2026-10-27T10:03:00.000Z');
    expect(openAlert().id).not.toBe(a.id);
  });

  it('denies the team role (audited), refuses unknown alerts, and obeys the freeze', () => {
    const a = openAlert();
    expect(() => acknowledgeAlert(teamUser, a.id, {}, opts)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(auditRows('denied')).toHaveLength(1);
    expect(() => acknowledgeAlert(admin, 'a_nope', {}, opts)).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    dbHelper.run(`UPDATE settings SET value = '1' WHERE key = 'mutations_frozen'`);
    expect(() => acknowledgeAlert(operator, a.id, {}, opts)).toThrow(expect.objectContaining({ code: 'MUTATIONS_FROZEN' }));
  });
});

describe('conflict-safe notes', () => {
  it('saves when the loaded notes still match and refuses with the current text when they do not', async () => {
    dbHelper.run(`UPDATE settings SET value = '0' WHERE key = 'mutations_frozen'`);
    for (const t of ['flagstore_results', 'checks', 'alerts', 'services', 'environments', 'participants', 'teams']) dbHelper.run(`DELETE FROM ${t}`);
    const { team: t } = await new MockAdapter().createTeam({ name: 'Notes Team', notes: 'first' });
    await updateTeam(admin, t.id, { notes: 'second' }, { ...opts, expectedNotes: 'first' });
    await expect(updateTeam(operator, t.id, { notes: 'mine' }, { ...opts, expectedNotes: 'first' }))
      .rejects.toMatchObject({ code: 'CONFLICT', details: { currentNotes: 'second' } });
    expect(dbHelper.get<{ notes: string }>(`SELECT notes FROM teams WHERE id = ?`, t.id)!.notes).toBe('second');
    await updateTeam(operator, t.id, { notes: 'mine' }, { ...opts, expectedNotes: 'second' }); // after reviewing theirs
    expect(dbHelper.get<{ notes: string }>(`SELECT notes FROM teams WHERE id = ?`, t.id)!.notes).toBe('mine');
    await updateTeam(operator, t.id, { notes: 'no guard' }, opts); // callers that send no expectation keep the old behaviour
  });
});
