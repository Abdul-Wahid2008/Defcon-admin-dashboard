'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Download, Search } from 'lucide-react';
import { useAudit } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader, AuditEntryDetails, OutcomeBadge, QueryState } from '@/components/console/DashboardPrimitives';
import { RelativeTime } from '@/components/ui/relative-time';
import { formatTimestamp } from '@/lib/format';

const ACTION_GROUPS = ['auth', 'team', 'env', 'credential', 'settings', 'demo'];

export default function AuditPage() {
  const [search, setSearch] = useState('');
  const [outcome, setOutcome] = useState('');
  const [action, setAction] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const query = useAudit({ q: search || undefined, outcome: outcome || undefined, action: action || undefined, pageSize: 50 });
  const page = query.data;
  const exportCsv = () => { window.open('/api/audit/export.csv', '_self'); };
  return <QueryState loading={query.isLoading} error={query.error} onRetry={() => query.refetch()}>
    <PageHeader title="Audit log" description="Append-only record of organizer activity" onRefresh={() => query.refetch()} refreshing={query.isFetching}><Button variant="outline" onClick={exportCsv}><Download size={15} />Export CSV</Button></PageHeader>
    <div className="mb-4 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-3 text-sm text-[var(--muted)]">Audit entries are append-only and cannot be edited or deleted.</div>
    <Card className="console-surface"><CardContent className="p-4"><div className="mb-4 flex flex-wrap gap-3"><div className="relative min-w-[220px] flex-1"><Search size={15} className="absolute left-3 top-2.5 text-[var(--muted)]" /><Input className="pl-9" placeholder="Search audit log" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search audit log" /></div><select aria-label="Filter by action" value={action} onChange={(e) => setAction(e.target.value)} className="h-8 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-inset)] px-3 text-sm"><option value="">All actions</option>{ACTION_GROUPS.map((group) => <option key={group} value={group}>{group}</option>)}</select><select aria-label="Filter by outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} className="h-8 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-inset)] px-3 text-sm"><option value="">All outcomes</option>{['requested', 'success', 'failure', 'denied', 'noop'].map((item) => <option key={item} value={item}>{item}</option>)}</select></div>{!page?.items.length ? <div className="py-12 text-center text-sm text-[var(--muted)]">No entries match these filters.</div> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead className="w-8" /><TableHead>Time</TableHead><TableHead>Actor</TableHead><TableHead>Action</TableHead><TableHead>Target</TableHead><TableHead>Outcome</TableHead><TableHead>Message</TableHead></TableRow></TableHeader><TableBody>{page.items.map((entry) => <><TableRow key={entry.id} className="console-table-row cursor-pointer" onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}><TableCell>{expanded === entry.id ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</TableCell><TableCell><span className="font-mono text-xs" title={entry.ts}>{formatTimestamp(entry.ts)}</span><div className="text-xs text-[var(--muted)]"><RelativeTime ts={entry.ts} /></div></TableCell><TableCell><div>{entry.actorName}</div><div className="text-xs text-[var(--muted)]">{entry.actorRole}</div></TableCell><TableCell className="font-mono text-xs">{entry.action}</TableCell><TableCell className="font-mono text-xs">{entry.targetId ?? '—'}</TableCell><TableCell><OutcomeBadge outcome={entry.outcome} /></TableCell><TableCell className="max-w-[360px] truncate">{entry.message}</TableCell></TableRow>{expanded === entry.id && <TableRow key={`${entry.id}-details`}><TableCell colSpan={7} className="p-0"><AuditEntryDetails entry={entry} /></TableCell></TableRow>}</>)}</TableBody></Table></div>}</CardContent></Card>
  </QueryState>;
}
