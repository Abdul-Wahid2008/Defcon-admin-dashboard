'use client';

import { useOverview } from '@/lib/queries';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ActivityList, EnvironmentTile, PageHeader, QueryState, StatCard } from '@/components/console/DashboardPrimitives';
import { RelativeTime } from '@/components/ui/relative-time';
import { AlertCircle, TriangleAlert } from 'lucide-react';
import Link from 'next/link';

export default function OverviewPage() {
  const query = useOverview();
  const data = query.data;
  return <QueryState loading={query.isLoading} error={query.error} onRetry={() => query.refetch()}>
    {data && <div>
      <PageHeader title="Overview" description="Competition status at a glance" updatedAt={data.serverTime} onRefresh={() => query.refetch()} refreshing={query.isFetching} />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-5">
        <StatCard label="Total teams" value={data.totals.teams} caption={`of ${data.totals.teams} registered`} href="/teams" />
        <StatCard label="Running" value={data.totals.running} caption="environments" href="/teams?state=running" />
        <StatCard label="Stopped" value={data.totals.stopped} caption="environments" href="/teams?state=stopped" />
        <StatCard label="Failed" value={data.totals.failed} caption="needs attention" href="/teams?state=failed" />
        <StatCard label="Active sessions" value={data.activeSessions} caption="simulated" />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-4"><CardHeader><CardTitle>Health summary</CardTitle></CardHeader><CardContent><div className="grid grid-cols-2 gap-3">{Object.entries(data.healthTotals).map(([key, value]) => <div key={key} className="rounded-lg bg-[var(--panel-2)] p-3"><div className="text-xs capitalize text-[var(--muted)]">{key}</div><div className="font-mono text-xl">{value}</div></div>)}</div><p className="mt-4 text-sm text-[var(--muted)]">Services failing: <span className="text-[var(--bad)]">{data.services.failingReachability}</span> reachability · <span className="text-[var(--bad)]">{data.services.failingFunctional}</span> functional</p></CardContent></Card>
        <Card className="xl:col-span-8"><CardHeader><CardTitle>Environment grid</CardTitle></CardHeader><CardContent><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{data.grid.map((team) => <EnvironmentTile key={team.teamId} team={team} />)}</div></CardContent></Card>
        <Card className="xl:col-span-6"><CardHeader><CardTitle className="flex items-center gap-2"><TriangleAlert size={16} className="text-[var(--warn)]" />Alerts</CardTitle></CardHeader><CardContent>{data.recentAlerts.length ? <div className="divide-y divide-[var(--border)]">{data.recentAlerts.slice(0, 10).map((alert) => <div key={alert.id} className="flex gap-3 py-2.5"><AlertCircle size={16} className={alert.severity === 'critical' ? 'text-[var(--bad)]' : 'text-[var(--warn)]'} /><div className="min-w-0 flex-1"><div className="text-sm">{alert.message}</div><div className="mt-1 text-xs text-[var(--muted)]">{alert.teamId ? <Link className="text-[var(--accent)] hover:underline" href={`/teams/${alert.teamId}`}>{alert.teamId}</Link> : 'System'} · <RelativeTime ts={alert.createdAt} /></div></div></div>)}</div> : <div className="py-8 text-center text-sm text-[var(--muted)]">No open alerts</div>}</CardContent></Card>
        <Card className="xl:col-span-6"><CardHeader><CardTitle>Recent activity</CardTitle></CardHeader><CardContent><ActivityList entries={data.recentActivity} /><Link href="/audit" className="mt-3 block text-sm text-[var(--accent)] hover:underline">View audit log →</Link></CardContent></Card>
      </div>
    </div>}
  </QueryState>;
}
