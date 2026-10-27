import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }), usePathname: () => '/overview' }));

import { ServiceMatrix, teamSeverity } from '../src/components/overview/ServiceMatrix';
import { getEventClock, phaseAt } from '../src/lib/server/services/event';
import { updateSettings, getSettings } from '../src/lib/server/services/settings';
import { getOverview } from '../src/lib/server/services/overview';
import { MockAdapter } from '../src/lib/server/adapters/mock';
import { dbHelper } from '../src/lib/server/db';
import type { OverviewData } from '../src/lib/schemas';

type Team = OverviewData['grid'][number];
const svc = (over: Partial<Team['services'][number]> = {}): Team['services'][number] => ({
  key: 'docuvault', name: 'DocuVault', reachability: 'pass', functional: 'pass', stale: false, flagstores: ['OK', 'OK', 'OK'], ...over,
});
const team = (id: string, over: Partial<Team> = {}, services = [svc()]): Team => ({
  teamId: id, name: `Team ${id}`, lifecycleState: 'running', health: 'healthy', pending: false, services, ...over,
});

describe('matrix ordering and rendering', () => {
  it('ranks failed environments, then reachability, then functional, then unknown/stale, then healthy', () => {
    const failedEnv = team('team-05', { lifecycleState: 'failed' });
    const offline = team('team-04', {}, [svc({ reachability: 'fail', flagstores: ['OFFLINE', 'OFFLINE', 'OFFLINE'] })]);
    const mumble = team('team-03', {}, [svc({ functional: 'fail', flagstores: ['OK', 'MUMBLE', 'OK'] })]);
    const stale = team('team-02', {}, [svc({ stale: true, reachability: 'unknown', functional: 'unknown' })]);
    const fine = team('team-01');
    expect([failedEnv, offline, mumble, stale, fine].map(teamSeverity)).toEqual([4, 3, 2, 1, 0]);
  });

  it('a stale failure is not reported as a live failure', () => {
    expect(teamSeverity(team('team-09', {}, [svc({ stale: true, reachability: 'fail' })]))).toBe(1);
  });

  it('renders worst first with text for every status, and never shows pass for a stale cell', () => {
    const html = renderToStaticMarkup(createElement(ServiceMatrix, {
      grid: [
        team('team-01'),
        team('team-02', {}, [svc({ stale: true, reachability: 'pass', functional: 'pass' })]),
        team('team-03', {}, [svc({ reachability: 'fail', flagstores: ['OFFLINE', 'OFFLINE', 'OFFLINE'] })]),
      ],
    }));
    expect(html.indexOf('team-03')).toBeLessThan(html.indexOf('team-02'));
    expect(html.indexOf('team-02')).toBeLessThan(html.indexOf('team-01'));
    expect(html).toContain('DocuVault: reachability fail, functional pass; flag0: OFFLINE');
    expect(html).toContain('reachability unknown (stale), functional unknown (stale)');
    expect(html).toContain('aria-label="Open team-01 Team team-01"');
  });
});

describe('event clock', () => {
  const m = { peace: 45, battle: 165, freeze: 30 };
  const start = '2026-10-30T10:00:00Z';
  const at = (min: number) => Date.parse(start) + min * 60_000;
  it('derives the phase from the start time and lengths; null when unset', () => {
    expect(phaseAt(null, at(0), m)).toBeNull();
    expect(phaseAt('garbage', at(0), m)).toBeNull();
    expect(phaseAt(start, at(-1), m)).toBe('not_started');
    expect(phaseAt(start, at(0), m)).toBe('peace');
    expect(phaseAt(start, at(44), m)).toBe('peace');
    expect(phaseAt(start, at(45), m)).toBe('battle');
    expect(phaseAt(start, at(209), m)).toBe('battle');
    expect(phaseAt(start, at(210), m)).toBe('freeze');
    expect(phaseAt(start, at(240), m)).toBe('ended');
  });
});

describe('overview data', () => {
  const admin = { id: 'u_admin', username: 'admin', displayName: 'Admin', role: 'organizer_admin' as const };
  beforeEach(() => {
    for (const t of ['flagstore_results', 'checks', 'alerts', 'services', 'environments', 'participants', 'teams']) dbHelper.run(`DELETE FROM ${t}`);
    dbHelper.run(`DELETE FROM settings WHERE key = 'event_start_iso'`);
  });

  it('carries per-service matrix data and an unset clock by default', async () => {
    await new MockAdapter().createTeam({ name: 'Matrix Data' });
    const o = await getOverview(admin);
    expect(o.event).toMatchObject({ phase: null, startedAt: null, source: 'none', currentRound: null });
    expect(o.grid[0].services.map(s => s.key)).toEqual(['docuvault', 'pulsechat', 'service-4', 'swiftshop']);
    expect(o.grid[0].services[0]).toMatchObject({ reachability: 'unknown', stale: false, flagstores: ['UNKNOWN', 'UNKNOWN', 'UNKNOWN'] });
  });

  it('settings: admin sets and clears the event start; operator cannot', async () => {
    const opts = { requestId: 'r_ev' };
    const op = { ...admin, id: 'u_op', role: 'organizer_operator' as const };
    expect(() => updateSettings(op, { eventStartIso: '2026-10-30T10:00:00Z' }, opts)).toThrow();
    updateSettings(admin, { eventStartIso: '2026-10-30T10:00:00+05:30' }, opts);
    expect(getSettings(admin).eventStartIso).toBe('2026-10-30T04:30:00.000Z');
    const clock = getEventClock(Date.parse('2026-10-30T05:00:00Z'), { source: 'mock', lastRound: null, roundSec: 90 });
    expect(clock.phase).toBe('peace');
    updateSettings(admin, { eventStartIso: null }, opts);
    expect(getSettings(admin).eventStartIso).toBeNull();
  });
});

describe('copy', () => {
  const BANNED = /\b(seamless|seamlessly|powerful|elevate|effortless|effortlessly|robust|leverage|journey|calm|quiet)\b/i;
  function files(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
      e.isDirectory() ? files(path.join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name)] : []);
  }
  it('has no marketing words in the app source', () => {
    const hits = files(path.join(process.cwd(), 'src')).flatMap(f =>
      fs.readFileSync(f, 'utf8').split('\n').map((line, i) => ({ f, i, line })).filter(x => BANNED.test(x.line))
        .map(x => `${path.relative(process.cwd(), x.f)}:${x.i + 1}: ${x.line.trim().slice(0, 80)}`));
    expect(hits).toEqual([]);
  });

  it('does not hard-code SIMULATED text outside the badge components', () => {
    const allowed = ['AdapterBadge.tsx', 'SimBanner.tsx', 'SourceFreshness.tsx'];
    const hits = files(path.join(process.cwd(), 'src', 'app')).concat(files(path.join(process.cwd(), 'src', 'components')))
      .filter(f => !allowed.includes(path.basename(f)))
      .filter(f => /SIMULATED/.test(fs.readFileSync(f, 'utf8')) && !/meta\??\.badge|\?\? 'SIMULATED'/.test(fs.readFileSync(f, 'utf8')));
    expect(hits.map(f => path.basename(f))).toEqual([]);
  });
});
