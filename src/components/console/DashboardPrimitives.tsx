'use client';

import Link from 'next/link';
import type React from 'react';
import { AlertCircle, CheckCircle2, Clock3, Minus, RefreshCw, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { HealthBadge } from '@/components/status/HealthBadge';
import { StateBadge } from '@/components/status/StateBadge';
import { RelativeTime } from '@/components/ui/relative-time';
import { formatTimestamp } from '@/lib/format';
import type { AuditEntry, Health, LifecycleState } from '@/lib/schemas';

export function QueryState({ loading, error, onRetry, children }: { loading: boolean; error?: Error | null; onRetry?: () => void; children: React.ReactNode }) {
  if (loading) return <div className="space-y-3" aria-label="Loading"><div className="h-20 animate-pulse rounded-xl bg-[var(--panel)]" /><div className="h-40 animate-pulse rounded-xl bg-[var(--panel)]" /></div>;
  if (error) return <Card><CardContent className="flex items-center justify-between gap-4 py-8 text-[var(--bad)]"><span>Unable to load data. {error.message}</span>{onRetry && <Button variant="outline" onClick={onRetry}>Retry</Button>}</CardContent></Card>;
  return <>{children}</>;
}

export function StatCard({ label, value, caption, href }: { label: string; value: number; caption: string; href?: string }) {
  const content = <Card className="h-full"><CardContent className="py-4"><div className="text-xs uppercase tracking-wider text-[var(--muted)]">{label}</div><div className="mt-1 font-mono text-3xl font-semibold">{value}</div><div className="text-xs text-[var(--muted)]">{caption}</div></CardContent></Card>;
  return href ? <Link href={href} className="block transition hover:-translate-y-0.5">{content}</Link> : content;
}

export function OutcomeBadge({ outcome }: { outcome: AuditEntry['outcome'] }) {
  const config = {
    success: ['text-[var(--ok)]', CheckCircle2, 'Success'],
    failure: ['text-[var(--bad)]', XCircle, 'Failure'],
    denied: ['text-[var(--bad)]', AlertCircle, 'Denied'],
    requested: ['text-[var(--warn)]', Clock3, 'Requested'],
    noop: ['text-[var(--idle)]', Minus, 'No-op'],
  } as const;
  const [color, Icon, label] = config[outcome];
  return <span className={`inline-flex items-center gap-1 text-xs ${color}`}><Icon size={13} />{label}</span>;
}

export function ActivityList({ entries, limit = 10 }: { entries: AuditEntry[]; limit?: number }) {
  if (!entries.length) return <div className="py-8 text-center text-sm text-[var(--muted)]">No recent activity</div>;
  return <div className="divide-y divide-[var(--border)]">{entries.slice(0, limit).map((entry) => <div key={entry.id} className="flex items-center justify-between gap-3 py-2.5"><div className="min-w-0"><div className="truncate text-sm"><span className="font-medium">{entry.actorName}</span> <span className="text-[var(--muted)]">· {entry.action}</span></div><div className="truncate text-xs text-[var(--muted)]">{entry.message}</div></div><div className="flex shrink-0 items-center gap-3"><OutcomeBadge outcome={entry.outcome} /><RelativeTime ts={entry.ts} className="text-xs text-[var(--muted)]" /></div></div>)}</div>;
}

export function EnvironmentTile({ team }: { team: { teamId: string; name: string; lifecycleState: LifecycleState; health: Health; pending: boolean } }) {
  return <Link href={`/teams/${team.teamId}`} className={`block rounded-lg border border-l-4 border-[var(--border)] border-l-[var(--accent)] bg-[var(--panel)] p-3 transition hover:bg-[var(--panel-2)] ${team.pending ? 'badge-pending' : ''}`}><div className="truncate font-medium">{team.name}</div><div className="mt-2 flex items-center justify-between gap-2"><StateBadge state={team.lifecycleState} size="sm" /><HealthBadge health={team.health} size="sm" /></div></Link>;
}

export function PageHeader({ title, description, updatedAt, onRefresh, refreshing, children }: { title: string; description?: React.ReactNode; updatedAt?: string; onRefresh?: () => void; refreshing?: boolean; children?: React.ReactNode }) {
  return <div className="mb-6 flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold">{title}</h1>{description && <p className="mt-1 text-sm text-[var(--muted)]">{description}</p>}{updatedAt && <p className="mt-1 text-xs text-[var(--muted)]">Updated <RelativeTime ts={updatedAt} /></p>}</div><div className="flex items-center gap-2">{children}{onRefresh && <Button variant="outline" size="icon" aria-label="Refresh" onClick={onRefresh} disabled={refreshing}><RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /></Button>}</div></div>;
}

export function AuditEntryDetails({ entry }: { entry: AuditEntry }) {
  return <div className="space-y-3 bg-[var(--bg)] p-3 text-xs"><pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[var(--muted)]">{entry.details ? JSON.stringify(entry.details, null, 2) : 'No details'}</pre><div className="flex flex-wrap gap-4 text-[var(--muted)]"><span>Request: <code>{entry.requestId ?? '—'}</code></span><span>Correlation: <code>{entry.correlationId ?? '—'}</code></span><span title={entry.ts}>ISO: {formatTimestamp(entry.ts)}</span></div></div>;
}
