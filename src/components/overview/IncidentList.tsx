'use client';

import { memo, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Activity, ExternalLink, RotateCw } from 'lucide-react';
import type { OverviewData } from '@/lib/schemas';
import { apiRunCheck, apiServiceAction } from '@/lib/api-admin';
import { StateBadge } from '@/components/status/StateBadge';
import { HealthBadge } from '@/components/status/HealthBadge';
import { Button } from '@/components/ui/button';
import { teamSeverity } from '@/components/overview/ServiceMatrix';

type Team = OverviewData['grid'][number];
type Svc = Team['services'][number];

/** One line per problem, in words: "DocuVault: reachability fail (flag0 OFFLINE)". */
export function describeProblems(team: Team): string[] {
  const lines: string[] = [];
  if (team.lifecycleState === 'failed') lines.push('Environment failed');
  for (const s of team.services) {
    const parts: string[] = [];
    if (s.stale) parts.push('no recent result (stale)');
    else {
      if (s.reachability === 'fail') parts.push('reachability fail');
      if (s.functional === 'fail') parts.push('functional fail');
      if (!parts.length && team.lifecycleState === 'running' && (s.reachability === 'unknown' || s.functional === 'unknown')) parts.push('status unknown');
    }
    if (!parts.length) continue;
    const bad = s.flagstores.map((v, i) => (v === 'OK' ? null : `flag${i} ${v}`)).filter(Boolean);
    lines.push(`${s.name}: ${parts.join(', ')}${bad.length ? ` (${bad.join(', ')})` : ''}`);
  }
  return lines;
}

const Row = memo(function Row({ team, canRestart, simulated, onRefresh }: { team: Team; canRestart: boolean; simulated: boolean; onRefresh: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const failing: Svc[] = team.services.filter(s => !s.stale && (s.reachability === 'fail' || s.functional === 'fail'));

  const check = async () => {
    setBusy('check');
    try {
      const r = await apiRunCheck(team.teamId);
      toast(`${team.teamId}: ${simulated ? 'simulated check' : 'check'} finished, health ${r.health}`);
    } catch (e) {
      toast.error(`${team.teamId}: check failed. ${(e as Error).message}`, { duration: Infinity });
    } finally { setBusy(null); onRefresh(); }
  };
  const restart = async (s: Svc) => {
    setBusy(s.key);
    try {
      await apiServiceAction(team.teamId, s.key, 'restart', crypto.randomUUID());
      toast(`Restart of ${s.name} requested for ${team.teamId}. The result shows on the team page.`);
    } catch (e) {
      toast.error(`${team.teamId}: restart of ${s.name} refused. ${(e as Error).message}`, { duration: Infinity });
    } finally { setBusy(null); onRefresh(); }
  };

  const running = team.lifecycleState === 'running';
  return (
    <li className="grid gap-2 border-t border-[var(--border)] px-3 py-3 first:border-t-0 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/teams/${team.teamId}`} className="font-medium hover:text-[var(--accent)]"><span className="font-mono text-xs text-[var(--text-subtle)]">{team.teamId}</span> {team.name}</Link>
          <StateBadge state={team.lifecycleState} size="sm" />
          <HealthBadge health={team.health} size="sm" />
          {team.pending && <span className="text-xs text-[var(--warn)]">action in progress</span>}
        </div>
        <ul className="mt-1 text-sm text-[var(--muted)]">
          {describeProblems(team).map((l, i) => <li key={`${i}-${l}`}>{l}</li>)}
        </ul>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="outline" render={<Link href={`/teams/${team.teamId}`} />}><ExternalLink size={16} aria-hidden="true" />Open team</Button>
        <Button size="sm" variant="outline" disabled={!running || busy !== null} title={running ? undefined : 'The environment is not running'} onClick={() => void check()}><Activity size={16} aria-hidden="true" />{busy === 'check' ? 'Checking…' : 'Run check'}</Button>
        {canRestart && failing.slice(0, 2).map(s => (
          <Button key={s.key} size="sm" variant="outline" disabled={!running || team.pending || busy !== null} title={team.pending ? 'Another action is in progress for this team' : undefined} onClick={() => void restart(s)}>
            <RotateCw size={16} aria-hidden="true" />{busy === s.key ? 'Requesting…' : `Restart ${s.name.split(' ')[0]}`}
          </Button>
        ))}
      </div>
    </li>
  );
});

/** Only teams with a problem, worst first, each with the actions an operator reaches for first. */
export function IncidentList({ grid, serviceActions, simulated = false }: { grid: Team[]; serviceActions: boolean; simulated?: boolean }) {
  const qc = useQueryClient();
  const incidents = useMemo(
    () => grid.filter(t => teamSeverity(t) > 0).sort((a, b) => teamSeverity(b) - teamSeverity(a) || a.teamId.localeCompare(b.teamId)),
    [grid],
  );
  const refresh = useMemo(() => () => { void qc.invalidateQueries({ queryKey: ['overview'] }); }, [qc]);
  if (!incidents.length) return <p className="py-8 text-center text-sm text-[var(--muted)]">No team has a failing, stale or failed service.</p>;
  return <ul aria-label="Teams with problems" className="rounded-lg border border-[var(--border)]">{incidents.map(t => <Row key={t.teamId} team={t} canRestart={serviceActions} simulated={simulated} onRefresh={refresh} />)}</ul>;
}
