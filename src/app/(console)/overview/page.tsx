'use client';

import Link from 'next/link';
import { AlertCircle, ArrowRight, CheckCircle2, CircleDashed, TriangleAlert } from 'lucide-react';
import { useOverview } from '@/lib/queries';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ActivityList, EnvironmentTile, PageHeader, QueryState, StatCard } from '@/components/console/DashboardPrimitives';
import { RelativeTime } from '@/components/ui/relative-time';
import { SourceFreshness } from '@/components/status/SourceFreshness';

export default function OverviewPage() {
  const query = useOverview();
  const data = query.data;

  return (
    <QueryState loading={query.isLoading} error={query.error} onRetry={() => query.refetch()}>
      {data && (
        <div>
          <PageHeader
            title="Operations overview"
            description="A calm read on team environments, service health, and the next intervention."
            updatedAt={data.serverTime}
            onRefresh={() => query.refetch()}
            refreshing={query.isFetching}
          >
            {data.totals.failed > 0 && (
              <Link href="/teams?state=failed" className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-[var(--bad)]/40 px-2.5 text-sm font-medium text-[var(--bad)] transition-colors hover:bg-[var(--bad)]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"><TriangleAlert size={15} />Review failures</Link>
            )}
          </PageHeader>

          <div className="mb-4 rounded-lg border border-[var(--border)] px-3 py-2" aria-label="Health data source"><SourceFreshness source={data.healthSource} /></div>

          <section aria-labelledby="overview-metrics" className="mb-5">
            <h2 id="overview-metrics" className="sr-only">Operational metrics</h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <StatCard label="Teams" value={data.totals.teams} caption="active teams in directory" href="/teams" />
              <StatCard label="Running" value={data.totals.running} caption="environments serving" href="/teams?state=running" tone="ok" />
              <StatCard label="Stopped" value={data.totals.stopped} caption="retained environments" href="/teams?state=stopped" />
              <StatCard label="Failed" value={data.totals.failed} caption="requires intervention" href="/teams?state=failed" tone="bad" />
              <StatCard label="Active sessions" value={data.activeSessions} caption="simulated runtime value" tone="warn" />
            </div>
          </section>

          <section className="mb-5 grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.8fr)]">
            <Card className="console-surface">
              <CardHeader className="border-b border-[var(--border)]">
                <CardTitle className="flex items-center justify-between">
                  <span>Health posture</span>
                  <span className="font-mono text-xs font-normal text-[var(--muted)]">{data.services.total} checks</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="grid grid-cols-2 gap-2">
                  {([
                    ['healthy', data.healthTotals.healthy, CheckCircle2, 'text-[var(--ok)]'],
                    ['degraded', data.healthTotals.degraded, TriangleAlert, 'text-[var(--warn)]'],
                    ['down', data.healthTotals.down, AlertCircle, 'text-[var(--bad)]'],
                    ['unknown', data.healthTotals.unknown, CircleDashed, 'text-[var(--idle)]'],
                  ] as const).map(([label, value, Icon, color]) => (
                    <div key={label} className="console-inset rounded-lg p-3">
                      <div className={`flex items-center gap-2 text-xs capitalize ${color}`}><Icon size={14} />{label}</div>
                      <div className="mt-2 font-mono text-2xl">{value}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 border-t border-[var(--border)] pt-3 text-sm text-[var(--muted)]">
                  <span className="text-[var(--bad)]">{data.services.failingReachability}</span> reachability failures
                  <span className="mx-2 text-[var(--border-strong)]">·</span>
                  <span className="text-[var(--warn)]">{data.services.failingFunctional}</span> functional failures
                </div>
              </CardContent>
            </Card>

            <Card className="console-surface">
              <CardHeader className="border-b border-[var(--border)]">
                <CardTitle className="flex items-center justify-between">
                  <span>Environment watch</span>
                  <Link href="/teams" className="inline-flex items-center gap-1 text-xs font-normal text-[var(--accent)] hover:underline">Open directory <ArrowRight size={13} /></Link>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {data.grid.map((team) => <EnvironmentTile key={team.teamId} team={team} />)}
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <Card className="console-surface">
              <CardHeader className="border-b border-[var(--border)]">
                <CardTitle className="flex items-center gap-2"><TriangleAlert size={16} className="text-[var(--warn)]" />Attention queue</CardTitle>
              </CardHeader>
              <CardContent className="pt-2">
                {data.recentAlerts.length ? (
                  <div className="divide-y divide-[var(--border)]">
                    {data.recentAlerts.slice(0, 10).map((alert) => (
                      <div key={alert.id} className="flex gap-3 py-3">
                        <AlertCircle size={16} className={`mt-0.5 shrink-0 ${alert.severity === 'critical' ? 'text-[var(--bad)]' : 'text-[var(--warn)]'}`} aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm">{alert.message}</div>
                          <div className="mt-1 flex items-center gap-2 text-xs text-[var(--muted)]">
                            {alert.teamId ? <Link className="font-mono text-[var(--accent)] hover:underline" href={`/teams/${alert.teamId}`}>{alert.teamId}</Link> : 'System'}
                            <span>·</span><RelativeTime ts={alert.createdAt} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-3 py-8 text-sm text-[var(--muted)]"><CheckCircle2 size={18} className="text-[var(--ok)]" />No open alerts. Operations are quiet.</div>
                )}
              </CardContent>
            </Card>

            <Card className="console-surface">
              <CardHeader className="border-b border-[var(--border)]">
                <CardTitle className="flex items-center justify-between">
                  <span>Recent activity</span>
                  <Link href="/audit" className="inline-flex items-center gap-1 text-xs font-normal text-[var(--accent)] hover:underline">Audit log <ArrowRight size={13} /></Link>
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
