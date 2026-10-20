'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, ChevronLeft, ChevronRight, Download, Search } from 'lucide-react';
import { useAudit, useTeams } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader, AuditEntryDetails, OutcomeBadge, QueryState } from '@/components/console/DashboardPrimitives';
import { RelativeTime } from '@/components/ui/relative-time';
import { formatTimestamp } from '@/lib/format';

// Action filter values are group prefixes (`env` matches every `env.*` code —
// the service matches bare tokens as `<group>.*`, docs/03 §3.7).
const ACTION_GROUPS = ['auth', 'team', 'env', 'participant', 'credential', 'health', 'settings', 'demo', 'audit'] as const;
const OUTCOMES = ['requested', 'success', 'failure', 'denied', 'noop'] as const;
const PAGE_SIZE = 50;

const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Login',
  'auth.login_failed': 'Failed login',
  'auth.logout': 'Logout',
  'audit.access_denied': 'Access denied',
  'team.create': 'Create team',
  'team.update': 'Update team',
  'team.suspend': 'Suspend team',
  'team.reactivate': 'Reactivate team',
  'team.delete': 'Delete team',
  'env.provision': 'Provision environment',
  'env.start': 'Start environment',
  'env.stop': 'Stop environment',
  'env.reset': 'Reset environment',
  'env.delete': 'Delete environment',
  'participant.add': 'Add participant',
  'participant.remove': 'Remove participant',
  'credential.issue': 'Issue credential',
  'credential.rotate': 'Rotate credential',
  'health.run': 'Run health checks',
  'settings.update': 'Settings update',
  'demo.inject': 'Inject service fault',
  'demo.fail_next': 'Make next action fail',
  'demo.reseed': 'Reseed demo data',
};

function friendlyAction(code: string): string {
  const known = ACTION_LABELS[code];
  if (known) return known;
  const tail = code.includes('.') ? code.split('.').slice(1).join(' ') : code;
  const pretty = tail.replace(/[._]/g, ' ');
  return pretty.charAt(0).toUpperCase() + pretty.slice(1);
}

type Range = 'all' | 'hour' | '24h';

function rangeFromTs(range: Range): string | undefined {
  if (range === 'hour') return new Date(Date.now() - 60 * 60 * 1000).toISOString();
  if (range === '24h') return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  return undefined;
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs transition ${active ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]' : 'border-[var(--border-strong)] text-[var(--muted)] hover:text-[var(--text)]'}`}
    >
      {children}
    </button>
  );
}

const SELECT_CLASS = 'h-8 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-inset)] px-3 text-sm';

export default function AuditPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [range, setRange] = useState<Range>((params.get('range') as Range) ?? 'all');
  const [fromTs, setFromTs] = useState<string | undefined>(() => rangeFromTs((params.get('range') as Range) ?? 'all'));
  const [actor, setActor] = useState(params.get('actor') ?? '');
  const [teamFilter, setTeamFilter] = useState(params.get('team') ?? '');
  const [actions, setActions] = useState<string[]>(() => (params.get('action') ?? '').split(',').filter(Boolean));
  const [outcomes, setOutcomes] = useState<string[]>(() => (params.get('outcome') ?? '').split(',').filter(Boolean));
  const [hideRequested, setHideRequested] = useState(params.get('hideRequested') === '1');
  const [page, setPage] = useState(() => Math.max(1, parseInt(params.get('page') ?? '1', 10) || 1));
  const [expanded, setExpanded] = useState<number | null>(null);

  // Effective outcome list: chips minus `requested` when the toggle is on.
  // With no chips selected the filter is open — unless the toggle hides
  // `requested`, in which case the other four outcomes are sent explicitly.
  const effectiveOutcomes = useMemo(() => {
    const selected = outcomes.filter((o) => !(hideRequested && o === 'requested'));
    if (selected.length > 0) return selected;
    if (hideRequested) return OUTCOMES.filter((o) => o !== 'requested');
    return undefined;
  }, [outcomes, hideRequested]);

  const auditParams = useMemo(() => ({
    q: search || undefined,
    actor: actor || undefined,
    team: teamFilter || undefined,
    action: actions.length ? actions : undefined,
    outcome: effectiveOutcomes,
    from: fromTs,
    page,
    pageSize: PAGE_SIZE,
  }), [actions, actor, effectiveOutcomes, fromTs, page, search, teamFilter]);

  const query = useAudit(auditParams);
  const result = query.data;

  // Actor options can't come from a users endpoint (none exists), so they are
  // derived from a wide unfiltered sample of the log plus the current page.
  const facet = useAudit({ pageSize: 200 });
  const teams = useTeams({ pageSize: 100 });
  const actorOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of [...(facet.data?.items ?? []), ...(result?.items ?? [])]) {
      const value = entry.actorId ?? (entry.actorRole === 'system' ? 'system' : null);
      if (!value || map.has(value)) continue;
      map.set(value, `${entry.actorName} · ${entry.actorRole}`);
    }
    return [...map.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => (a.value === 'system' ? 1 : b.value === 'system' ? -1 : a.label.localeCompare(b.label)));
  }, [facet.data, result]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (search) next.set('q', search);
    if (range !== 'all') next.set('range', range);
    if (actor) next.set('actor', actor);
    if (teamFilter) next.set('team', teamFilter);
    if (actions.length) next.set('action', actions.join(','));
    if (outcomes.length) next.set('outcome', outcomes.join(','));
    if (hideRequested) next.set('hideRequested', '1');
    if (page > 1) next.set('page', String(page));
    router.replace(`${pathname}${next.toString() ? `?${next.toString()}` : ''}`, { scroll: false });
  }, [actions, actor, hideRequested, outcomes, page, pathname, range, router, search, teamFilter]);

  const changePage = (next: number) => {
    setPage(Math.max(1, next));
    setExpanded(null);
  };
  const toggleAction = (group: string) => {
    setActions((prev) => (prev.includes(group) ? prev.filter((g) => g !== group) : [...prev, group]));
    setPage(1);
  };
  const toggleOutcome = (outcome: string) => {
    setOutcomes((prev) => (prev.includes(outcome) ? prev.filter((o) => o !== outcome) : [...prev, outcome]));
    setPage(1);
  };
  const hasFilters = Boolean(search || actor || teamFilter || actions.length || outcomes.length || hideRequested || range !== 'all');
  const resetFilters = () => {
    setSearch('');
    setRange('all');
    setFromTs(undefined);
    setActor('');
    setTeamFilter('');
    setActions([]);
    setOutcomes([]);
    setHideRequested(false);
    setPage(1);
  };

  const exportCsv = () => {
    const next = new URLSearchParams();
    if (search) next.set('q', search);
    if (fromTs) next.set('from', fromTs);
    if (actor) next.set('actor', actor);
    if (teamFilter) next.set('team', teamFilter);
    if (actions.length) next.set('action', actions.join(','));
    if (effectiveOutcomes) next.set('outcome', effectiveOutcomes.join(','));
    window.open(`/api/audit/export.csv${next.toString() ? `?${next.toString()}` : ''}`, '_self');
  };

  const total = result?.total ?? 0;
  const firstShown = total === 0 || !result ? 0 : (result.page - 1) * result.pageSize + 1;
  const lastShown = result ? Math.min(result.page * result.pageSize, total) : 0;

  return <QueryState loading={query.isLoading} error={query.error} onRetry={() => query.refetch()}>
    <PageHeader title="Audit log" description="Append-only record of organizer activity" onRefresh={() => query.refetch()} refreshing={query.isFetching}><Button variant="outline" onClick={exportCsv}><Download size={15} />Export CSV</Button></PageHeader>
    <div className="mb-4 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-3 text-sm text-[var(--muted)]">Audit entries are append-only and cannot be edited or deleted.</div>
    <Card className="console-surface"><CardContent className="p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-[220px] flex-1"><Search size={15} className="absolute left-3 top-2.5 text-[var(--muted)]" /><Input className="pl-9" placeholder="Search audit log" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search audit log" /></div>
        <label className="grid gap-1 text-xs text-[var(--muted)]">Date range
          <select aria-label="Date range" value={range} onChange={(e) => { const v = e.target.value as Range; setRange(v); setFromTs(rangeFromTs(v)); setPage(1); }} className={SELECT_CLASS}>
            <option value="all">All time</option>
            <option value="hour">Last hour</option>
            <option value="24h">Last 24 h</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs text-[var(--muted)]">Actor
          <select aria-label="Filter by actor" value={actor} onChange={(e) => { setActor(e.target.value); setPage(1); }} className={SELECT_CLASS}>
            <option value="">All actors</option>
            {actorOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-[var(--muted)]">Team
          <select aria-label="Filter by team" value={teamFilter} onChange={(e) => { setTeamFilter(e.target.value); setPage(1); }} className={SELECT_CLASS}>
            <option value="">All teams</option>
            {(teams.data?.items ?? []).map((team) => <option key={team.id} value={team.id}>{team.id} · {team.name}</option>)}
          </select>
        </label>
        {hasFilters && <Button variant="ghost" size="sm" onClick={resetFilters}>Clear filters</Button>}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="console-label mr-1">Actions</span>
        {ACTION_GROUPS.map((group) => <Chip key={group} active={actions.includes(group)} onClick={() => toggleAction(group)}>{group}</Chip>)}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="console-label mr-1">Outcomes</span>
        {OUTCOMES.map((outcome) => <Chip key={outcome} active={outcomes.includes(outcome)} onClick={() => toggleOutcome(outcome)}>{outcome}</Chip>)}
        <label className="ml-2 flex cursor-pointer items-center gap-2 text-xs text-[var(--muted)]">
          <input type="checkbox" checked={hideRequested} onChange={(e) => { setHideRequested(e.target.checked); setPage(1); }} className="accent-[var(--accent)]" />
          Hide <code className="font-mono">requested</code> rows
        </label>
      </div>
      {!result?.items.length
        ? <div className="py-12 text-center text-sm text-[var(--muted)]">No entries match these filters.</div>
        : <>
          <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead className="w-8" /><TableHead>Time</TableHead><TableHead>Actor</TableHead><TableHead>Action</TableHead><TableHead>Target</TableHead><TableHead>Outcome</TableHead><TableHead>Message</TableHead></TableRow></TableHeader><TableBody>{result.items.map((entry) => <Fragment key={entry.id}><TableRow className="console-table-row cursor-pointer" onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}><TableCell>{expanded === entry.id ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</TableCell><TableCell><span className="font-mono text-xs" title={entry.ts}>{formatTimestamp(entry.ts)}</span><div className="text-xs text-[var(--muted)]"><RelativeTime ts={entry.ts} /></div></TableCell><TableCell><div>{entry.actorName}</div><span className="mt-0.5 inline-block rounded border border-[var(--border-strong)] px-1 py-px text-[10px] uppercase tracking-wide text-[var(--muted)]">{entry.actorRole}</span></TableCell><TableCell className="font-mono text-xs">{entry.action}<div className="font-sans text-[10px] text-[var(--muted)]">{friendlyAction(entry.action)}</div></TableCell><TableCell className="font-mono text-xs">{entry.targetType === 'team' && entry.targetId ? <Link href={`/teams/${entry.targetId}`} className="text-[var(--accent)] hover:underline" onClick={(e) => e.stopPropagation()}>{entry.targetId}</Link> : entry.targetId ?? '—'}</TableCell><TableCell><OutcomeBadge outcome={entry.outcome} /></TableCell><TableCell className="max-w-[360px] truncate">{entry.message}</TableCell></TableRow>{expanded === entry.id && <TableRow><TableCell colSpan={7} className="p-0"><AuditEntryDetails entry={entry} /></TableCell></TableRow>}</Fragment>)}</TableBody></Table></div>
          <div className="mt-4 flex items-center justify-between gap-3 text-sm text-[var(--muted)]">
            <span>Showing {firstShown}–{lastShown} of {total} entries</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => changePage(page - 1)} disabled={page <= 1 || query.isFetching}><ChevronLeft size={14} />Previous</Button>
              <Button variant="outline" size="sm" onClick={() => changePage(page + 1)} disabled={lastShown >= total || query.isFetching}>Next<ChevronRight size={14} /></Button>
            </div>
          </div>
        </>}
    </CardContent></Card>
  </QueryState>;
}
