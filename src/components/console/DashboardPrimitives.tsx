'use client';

import Link from 'next/link';
import type React from 'react';
import { AlertCircle, CheckCircle2, Clock3, Minus, RefreshCw, XCircle, CircleHelp, CircleX, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { HealthBadge } from '@/components/status/HealthBadge';
import { StateBadge } from '@/components/status/StateBadge';
import { RelativeTime } from '@/components/ui/relative-time';
import { formatTimestamp } from '@/lib/format';
import type { AuditEntry, Health, LifecycleState, ResourceUsage } from '@/lib/schemas';

export function QueryState({ loading, error, onRetry, children }: { loading: boolean; error?: Error | null; onRetry?: () => void; children: React.ReactNode }) {
  if (loading) return <div className="space-y-3" aria-label="Loading"><div className="h-20 animate-pulse rounded-xl bg-[var(--panel)]" /><div className="h-40 animate-pulse rounded-xl bg-[var(--panel)]" /></div>;
  if (error) return <Card role="alert"><CardContent className="flex flex-wrap items-center justify-between gap-4 py-8"><div><p className="font-medium text-[var(--bad)]">Unable to load this view.</p><p className="mt-1 text-sm text-[var(--muted)]">{error.message}</p></div>{onRetry && <Button variant="outline" onClick={onRetry}>Retry</Button>}</CardContent></Card>;
  return <>{children}</>;
}

export function CheckStatus({ status, detail }: { status: 'pass' | 'fail' | 'unknown'; detail?: string | null }) {
  const config = {
    pass: { label: 'Pass', Icon: ShieldCheck, color: 'text-[var(--ok)]' },
    fail: { label: 'Fail', Icon: CircleX, color: 'text-[var(--bad)]' },
    unknown: { label: 'Unknown', Icon: CircleHelp, color: 'text-[var(--idle)]' },
  }[status];
  return <span className={`inline-flex items-center gap-1.5 ${config.color}`} title={detail ?? undefined}><config.Icon size={14} aria-hidden="true" />{config.label}</span>;
}

export function ResourceBars({ resources }: { resources: ResourceUsage | null }) {
  if (!resources) return <div className="rounded-lg border border-dashed border-[var(--border-strong)] p-4 text-sm text-[var(--muted)]">No resource data while this environment is not running.</div>;
  const values = [
    { label: 'CPU', used: `${resources.cpu.usedPct.toFixed(0)}%`, ratio: resources.cpu.usedPct / 100, limit: `${resources.cpu.limitCores} cores` },
    { label: 'Memory', used: `${resources.memory.usedMb} MB`, ratio: resources.memory.usedMb / resources.memory.limitMb, limit: `${resources.memory.limitMb} MB` },
    { label: 'Processes', used: String(resources.processes.used), ratio: resources.processes.used / resources.processes.limit, limit: String(resources.processes.limit) },
    { label: 'Storage', used: `${resources.storage.usedMb} MB`, ratio: resources.storage.usedMb / resources.storage.limitMb, limit: `${resources.storage.limitMb} MB` },
  ];
  return <div className="space-y-4" title={resources.isMock ? 'Simulated values' : undefined}>{values.map((item) => {
    const ratio = Math.min(1, Math.max(0, item.ratio));
    return <div key={item.label}><div className="mb-1 flex items-center justify-between gap-3 text-xs"><span>{item.label}</span><span className="font-mono text-[var(--muted)]">{item.used} / {item.limit}</span></div><div className="h-2 overflow-hidden rounded-full bg-[var(--surface-inset)]"><div className={`h-full rounded-full ${ratio >= 0.85 ? 'bg-[var(--bad)]' : ratio >= 0.7 ? 'bg-[var(--warn)]' : 'bg-[var(--ok)]'}`} style={{ width: `${ratio * 100}%` }} /></div></div>;
  })}</div>;
}

export function StatCard({ label, value, caption, href, tone = 'neutral' }: { label: string; value: number; caption: string; href?: string; tone?: 'neutral' | 'ok' | 'warn' | 'bad' }) {
  const toneClass = { neutral: 'border-[var(--border)]', ok: 'border-[var(--ok)]/40', warn: 'border-[var(--warn)]/40', bad: 'border-[var(--bad)]/40' }[tone];
  const content = <Card className={`h-full border ${toneClass}`}><CardContent className="py-4"><div className="console-label">{label}</div><div className="mt-2 font-mono text-3xl font-semibold tracking-tight">{value}</div><div className="mt-1 text-xs text-[var(--muted)]">{caption}</div></CardContent></Card>;
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
  return <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-[var(--border)] pb-5"><div className="min-w-0"><h1 className="text-2xl font-semibold tracking-tight">{title}</h1>{description && <p className="mt-1 text-sm text-[var(--muted)]">{description}</p>}{updatedAt && <p className="mt-2 text-xs text-[var(--muted)]">Last sync <RelativeTime ts={updatedAt} /></p>}</div><div className="flex items-center gap-2">{children}{onRefresh && <Button variant="outline" size="icon" aria-label="Refresh" onClick={onRefresh} disabled={refreshing}><RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /></Button>}</div></div>;
}

export function AuditEntryDetails({ entry }: { entry: AuditEntry }) {
  return <div className="space-y-3 bg-[var(--bg)] p-3 text-xs"><pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[var(--muted)]">{entry.details ? JSON.stringify(entry.details, null, 2) : 'No details'}</pre><div className="flex flex-wrap gap-4 text-[var(--muted)]"><span>Request: <code>{entry.requestId ?? '—'}</code></span><span>Correlation: <code>{entry.correlationId ?? '—'}</code></span><span title={entry.ts}>ISO: {formatTimestamp(entry.ts)}</span></div></div>;
}
