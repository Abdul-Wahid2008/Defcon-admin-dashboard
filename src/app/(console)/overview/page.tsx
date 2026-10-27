'use client';

import Link from 'next/link';
import { AlertCircle, ArrowRight, Info, TriangleAlert } from 'lucide-react';
import { useOverview } from '@/lib/queries';
import type { OverviewData } from '@/lib/schemas';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ActivityList, PageHeader, QueryState } from '@/components/console/DashboardPrimitives';
import { ServiceMatrix } from '@/components/overview/ServiceMatrix';
import { SourceFreshness } from '@/components/status/SourceFreshness';
import { RelativeTime } from '@/components/ui/relative-time';
import { formatTimestamp } from '@/lib/format';

const PHASE_LABEL: Record<NonNullable<OverviewData['event']['phase']>, string> = {
  not_started: 'Not started',
  peace: 'Peace',
  battle: 'Battle',
  freeze: 'Freeze',
  ended: 'Ended',
};

function EventStrip({ event }: { event: OverviewData['event'] }) {
  if (!event.phase) {
    return (
      <p className="flex items-center gap-2 text-sm text-[var(--muted)]">
        <Info size={15} aria-hidden="true" />
        Event clock not set.
        <Link href="/settings" className="text-[var(--accent)] underline-offset-2 hover:underline">Set the start time in Settings</Link>
      </p>
    );
  }
  const m = event.phaseMinutes;
  return (
    <p className="text-sm">
      <span className="console-label mr-2">Phase</span>
      <strong>{PHASE_LABEL[event.phase]}</strong>
      <span className="mx-2 text-[var(--border-strong)]">·</span>
      <span className="console-label mr-2">Round</span>
      <strong className="tabular-nums">{event.currentRound ?? '—'}</strong>
      {event.source !== 'none' && <span className="ml-1 text-[var(--text-subtle)]">({event.source})</span>}
      <span className="mx-2 text-[var(--border-strong)]">·</span>
      <span className="text-[var(--text-subtle)]">
        started {event.startedAt ? formatTimestamp(event.startedAt) : '—'}; phases {m.peace}/{m.battle}/{m.freeze} min (not confirmed by the club)
      </span>
    </p>
  );
}

function Stat({ label, value, href, tone }: { label: string; value: number; href?: string; tone?: 'ok' | 'warn' | 'bad' }) {
  const color = tone === 'ok' ? 'text-[var(--ok)]' : tone === 'warn' ? 'text-[var(--warn)]' : tone === 'bad' ? 'text-[var(--bad)]' : '';
  const body = (
    <>
      <span className="console-label">{label}</span>
      <span className={`font-mono text-xl font-semibold tabular-nums ${color}`}>{value}</span>
    </>
  );
  const cls = 'flex min-w-[88px] flex-col gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2';
  return href
    ? <Link href={href} className={`${cls} hover:bg-[var(--panel-2)]`}>{body}</Link>
    : <div className={cls}>{body}</div>;
}

export default function OverviewPage() {
  const query = useOverview();
  const data = query.data;

  return (
    <QueryState loading={query.isLoading} error={query.error} onRetry={() => query.refetch()}>
      {data && (
        <div>
          <PageHeader title="Overview" updatedAt={data.serverTime} onRefresh={() => query.refetch()} refreshing={query.isFetching}>
            {data.totals.failed > 0 && (
              <Link href="/teams?state=failed" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--bad)]/50 px-2.5 text-sm font-medium text-[var(--bad)] hover:bg-[var(--bad)]/10">
                <TriangleAlert size={15} aria-hidden="true" />Show {data.totals.failed} failed {data.totals.failed === 1 ? 'team' : 'teams'}
              </Link>
            )}
          </PageHeader>

          <section aria-label="Event clock and data source" className="mb-3 grid gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2.5 lg:grid-cols-[1fr_auto] lg:items-center">
            <EventStrip event={data.event} />
            <SourceFreshness source={data.healthSource} />
          </section>

          <section aria-label="Counts" className="mb-4 flex flex-wrap gap-2">
            <Stat label="Teams" value={data.totals.teams} href="/teams" />
            <Stat label="Running" value={data.totals.running} href="/teams?state=running" tone="ok" />
            <Stat label="Stopped" value={data.totals.stopped} href="/teams?state=stopped" />
            <Stat label="Failed" value={data.totals.failed} href="/teams?state=failed" tone={data.totals.failed ? 'bad' : undefined} />
            <Stat label="Healthy" value={data.healthTotals.healthy} href="/teams?health=healthy" tone="ok" />
            <Stat label="Degraded" value={data.healthTotals.degraded} href="/teams?health=degraded" tone={data.healthTotals.degraded ? 'warn' : undefined} />
            <Stat label="Down" value={data.healthTotals.down} href="/teams?health=down" tone={data.healthTotals.down ? 'bad' : undefined} />
            <Stat label="Unknown" value={data.healthTotals.unknown} href="/teams?health=unknown" />
            <Stat label={data.adapter === 'mock' ? 'Sessions (simulated)' : 'Sessions'} value={data.activeSessions} />
          </section>

          <Card className="console-surface mb-4">
            <CardHeader className="border-b border-[var(--border)]">
              <CardTitle className="flex items-center justify-between">
                <span>Teams × services</span>
                <span className="text-xs font-normal tabular-nums text-[var(--text-subtle)]">
                  {data.services.failingReachability} reachability and {data.services.failingFunctional} functional failures
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-3">
              <ServiceMatrix grid={data.grid} />
            </CardContent>
          </Card>

          <section className="grid gap-4 xl:grid-cols-2">
            <Card className="console-surface">
              <CardHeader className="border-b border-[var(--border)]">
                <CardTitle className="flex items-center justify-between">
                  <span>Alerts</span>
                  <span className="text-xs font-normal tabular-nums text-[var(--text-subtle)]">{data.recentAlerts.filter(a => !a.resolvedAt).length} open</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-2">
                {data.recentAlerts.length ? (
                  <ul className="divide-y divide-[var(--border)]">
                    {data.recentAlerts.slice(0, 10).map((alert) => (
                      <li key={alert.id} className="flex gap-3 py-2.5">
                        <AlertCircle size={16} className={`mt-0.5 shrink-0 ${alert.resolvedAt ? 'text-[var(--idle)]' : alert.severity === 'critical' ? 'text-[var(--bad)]' : alert.severity === 'warning' ? 'text-[var(--warn)]' : 'text-[var(--text-subtle)]'}`} aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm">{alert.message}{alert.resolvedAt && <span className="ml-2 text-xs text-[var(--text-subtle)]">resolved</span>}</div>
                          <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--text-subtle)]">
                            {alert.teamId ? <Link className="font-mono text-[var(--accent)] hover:underline" href={`/teams/${alert.teamId}`}>{alert.teamId}</Link> : 'System'}
                            <span aria-hidden="true">·</span><RelativeTime ts={alert.createdAt} />
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-6 text-sm text-[var(--muted)]">No open alerts.</p>
                )}
              </CardContent>
            </Card>

            <Card className="console-surface">
              <CardHeader className="border-b border-[var(--border)]">
                <CardTitle className="flex items-center justify-between">
                  <span>Recent activity</span>
                  <Link href="/audit" className="inline-flex items-center gap-1 text-xs font-normal text-[var(--accent)] hover:underline">Open audit log <ArrowRight size={13} aria-hidden="true" /></Link>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-2"><ActivityList entries={data.recentActivity} /></CardContent>
            </Card>
          </section>
        </div>
      )}
    </QueryState>
  );
}
