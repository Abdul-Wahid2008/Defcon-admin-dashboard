'use client';

import Link from 'next/link';
import { ArrowRight, Info, TriangleAlert } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useMeta, useOverview } from '@/lib/queries';
import type { OverviewData } from '@/lib/schemas';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ActivityList, PageHeader, QueryState } from '@/components/console/DashboardPrimitives';
import { ServiceMatrix, teamSeverity } from '@/components/overview/ServiceMatrix';
import { IncidentList } from '@/components/overview/IncidentList';
import { AlertsPanel } from '@/components/overview/AlertsPanel';
import { SourceFreshness } from '@/components/status/SourceFreshness';
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
        <Info size={16} aria-hidden="true" />
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
      <span className={`font-mono text-2xl font-semibold tabular-nums ${color}`}>{value}</span>
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
  const meta = useMeta();
  const incidents = useSearchParams().get('view') === 'incidents';

  return (
    <QueryState loading={query.isLoading} error={query.error} onRetry={() => query.refetch()}>
      {data && (
        <div>
          <PageHeader title="Overview" updatedAt={data.serverTime} onRefresh={() => query.refetch()} refreshing={query.isFetching}>
            {data.totals.failed > 0 && (
              <Link href="/teams?state=failed" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--bad)]/50 px-2.5 text-sm font-medium text-[var(--bad)] hover:bg-[var(--bad)]/10">
                <TriangleAlert size={16} aria-hidden="true" />Show {data.totals.failed} failed {data.totals.failed === 1 ? 'team' : 'teams'}
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
              <CardTitle className="flex flex-wrap items-center justify-between gap-2">
                <nav aria-label="Overview view" className="flex gap-1">
                  <Link aria-current={!incidents ? 'page' : undefined} href="/overview" className={`rounded px-2 py-1 text-sm ${!incidents ? 'bg-[var(--panel-2)] text-[var(--accent)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>Teams × services</Link>
                  <Link aria-current={incidents ? 'page' : undefined} href="/overview?view=incidents" className={`rounded px-2 py-1 text-sm ${incidents ? 'bg-[var(--panel-2)] text-[var(--accent)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>Incidents <span className="tabular-nums">({data.grid.filter(t => teamSeverity(t) > 0).length})</span></Link>
                </nav>
                <span className="text-xs font-normal tabular-nums text-[var(--text-subtle)]">
                  {data.services.failingReachability} reachability and {data.services.failingFunctional} functional failures
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-3">
              {incidents ? <IncidentList grid={data.grid} serviceActions={!!meta.data?.capabilities.serviceLevelReset} simulated={meta.data?.sources.health === 'mock'} /> : <ServiceMatrix grid={data.grid} />}
            </CardContent>
          </Card>

          <section className="grid gap-4 xl:grid-cols-2">
            <Card className="console-surface">
              <CardHeader className="border-b border-[var(--border)]">
                <CardTitle className="flex items-center justify-between">
                  <span>Alerts</span>
                  <span className="text-xs font-normal tabular-nums text-[var(--text-subtle)]">{data.openAlertCount} unacknowledged</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-2">
                <AlertsPanel alerts={data.recentAlerts} />
              </CardContent>
            </Card>

            <Card className="console-surface">
              <CardHeader className="border-b border-[var(--border)]">
                <CardTitle className="flex items-center justify-between">
                  <span>Recent activity</span>
                  <Link href="/audit" className="inline-flex items-center gap-1 text-xs font-normal text-[var(--accent)] hover:underline">Open audit log <ArrowRight size={16} aria-hidden="true" /></Link>
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
