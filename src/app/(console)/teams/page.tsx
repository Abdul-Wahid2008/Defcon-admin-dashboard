'use client';

import type { ChangeEvent, ReactNode } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowDown, ArrowUp, ArrowUpDown, CheckCircle2, FileUp, MoreHorizontal, Plus, Search, ShieldAlert, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { apiListTeams } from '@/lib/api-client';
import { useRecentTeams } from '@/lib/recent-teams';
import { useBulkEnvironmentAction, useCreateTeam, useImportTeams, useTeams } from '@/lib/queries';
import type { BulkEnvActionResponse, IssuedCredential, TeamImportResponse, TeamSummary } from '@/lib/schemas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { HealthBadge } from '@/components/status/HealthBadge';
import { StateBadge } from '@/components/status/StateBadge';
import { PageHeader, QueryState } from '@/components/console/DashboardPrimitives';
import { CredentialsReveal } from '@/components/teams/CredentialsReveal';
import { RelativeTime } from '@/components/ui/relative-time';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

type ImportRow = { name: string; participantNames?: string[]; externalTeamId?: string };

function parseCsv(input: string): { rows: ImportRow[]; errors: string[] } {
  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') { field += '"'; i += 1; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(field.trim()); field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      row.push(field.trim()); field = '';
      if (row.some(Boolean)) records.push(row);
      row = [];
    } else field += char;
  }
  if (quoted) return { rows: [], errors: ['Unclosed quoted field.'] };
  row.push(field.trim());
  if (row.some(Boolean)) records.push(row);
  if (!records.length) return { rows: [], errors: ['CSV is empty.'] };
  const header = records[0].map((value) => value.toLowerCase());
  if (header[0] !== 'team_name' || (header.length > 1 && header[1] !== 'participants') || (header.length > 2 && header[2] !== 'external_team_id')) {
    return { rows: [], errors: ['CSV columns must be team_name, participants, external_team_id (the last two are optional).'] };
  }
  const rows: ImportRow[] = [];
  const errors: string[] = [];
  records.slice(1).forEach((record, index) => {
    const name = record[0]?.trim() ?? '';
    const participants = record[1]?.split(';').map((value) => value.trim()).filter(Boolean);
    if (name.length < 2 || name.length > 60) errors.push(`Row ${index + 2}: team_name must be 2–60 characters.`);
    else if (participants && participants.length > 8) errors.push(`Row ${index + 2}: at most 8 participants are allowed.`);
    else rows.push({ name, ...(participants?.length ? { participantNames: participants } : {}), ...(record[2]?.trim() ? { externalTeamId: record[2].trim() } : {}) });
  });
  return { rows, errors };
}

function Overlay({
  children,
  onClose,
  labelledBy,
  describedBy,
}: {
  children: ReactNode;
  onClose?: () => void;
  labelledBy: string;
  describedBy?: string;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const overlay = overlayRef.current;
    if (!overlay) return undefined;
    const focusableSelector = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');
    const focusFirst = () => {
      const first = overlay.querySelector<HTMLElement>(focusableSelector);
      first?.focus();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && onCloseRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(overlay.querySelectorAll<HTMLElement>(focusableSelector));
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    overlay.addEventListener('keydown', onKeyDown);
    window.requestAnimationFrame(focusFirst);
    return () => {
      document.body.style.overflow = previousOverflow;
      overlay.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, []);

  return <div ref={overlayRef} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby={labelledBy} aria-describedby={describedBy}>
    <Card className="max-h-[90vh] w-full max-w-3xl overflow-auto"><CardContent className="p-6">
      {onClose && <button type="button" aria-label="Close dialog" onClick={onClose} className="float-right rounded p-1 text-[var(--muted)] hover:bg-[var(--panel-2)] hover:text-[var(--text)]"><X size={16} /></button>}
      {children}
    </CardContent></Card>
  </div>;
}

function ImportDialog({ onClose, onCredentials }: { onClose: () => void; onCredentials: (response: TeamImportResponse) => void }) {
  const [csv, setCsv] = useState('team_name,participants\n');
  const [parsed, setParsed] = useState<{ rows: ImportRow[]; errors: string[] } | null>(null);
  const [preview, setPreview] = useState<TeamImportResponse | null>(null);
  const [autoProvision, setAutoProvision] = useState(true);
  const importTeams = useImportTeams();
  const parse = () => {
    const result = parseCsv(csv); setParsed(result); setPreview(null);
    if (result.errors.length) return;
    importTeams.mutate({ rows: result.rows, autoProvision, dryRun: true }, { onSuccess: setPreview });
  };
  const submit = () => {
    if (!parsed || parsed.errors.length || !parsed.rows.length) return;
    importTeams.mutate({ rows: parsed.rows, autoProvision }, { onSuccess: (result) => { onCredentials(result); onClose(); } });
  };
  const fileSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) file.text().then(setCsv).catch(() => setParsed({ rows: [], errors: ['Unable to read the selected file.'] }));
  };
  return <Overlay onClose={onClose} labelledBy="import-dialog-title" describedBy="import-dialog-description">
    <h2 id="import-dialog-title" className="mb-1 text-base font-semibold">Import registered teams</h2>
    <p id="import-dialog-description" className="mb-4 text-sm text-[var(--muted)]">CSV columns: <code>team_name,participants,external_team_id</code>. Separate participants with semicolons. <code>external_team_id</code> is the game engine&apos;s id for the team; health results are matched on it.</p>
    <div className="mb-3 flex items-center gap-2"><label className="inline-flex cursor-pointer items-center gap-2 rounded border border-[var(--border)] px-3 py-1.5 text-sm"><FileUp size={16} />Choose CSV<input type="file" accept=".csv,text/csv" className="hidden" onChange={fileSelected} /></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={autoProvision} onChange={(event) => setAutoProvision(event.target.checked)} />Provision environments</label></div>
    <textarea value={csv} onChange={(event) => { setCsv(event.target.value); setParsed(null); setPreview(null); }} className="min-h-40 w-full rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3 font-mono text-xs" spellCheck={false} />
    {parsed?.errors.length ? <div className="mt-3 space-y-1 text-sm text-[var(--bad)]">{parsed.errors.map((error) => <p key={error}>{error}</p>)}</div> : null}
    {preview && <div className="mt-4 rounded border border-[var(--border)] p-3 text-sm"><p className="font-medium">Preview: {preview.skipped.length ? `${preview.skipped.length} row(s) require attention` : 'all rows are valid'}</p>{preview.skipped.map((item, index) => <p key={`${item.row.name}-${index}`} className="mt-1 text-[var(--warn)]">{item.row.name}: {item.reason}</p>)}</div>}
    {importTeams.error && <p className="mt-3 text-sm text-[var(--bad)]">{importTeams.error.message}</p>}
    <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="outline" disabled={importTeams.isPending} onClick={parse}><Search size={16} />Dry run</Button><Button disabled={!parsed || !!parsed.errors.length || !parsed.rows.length || importTeams.isPending} onClick={submit}><Upload size={16} />{importTeams.isPending ? 'Importing…' : 'Import teams'}</Button></div>
  </Overlay>;
}

function BulkDialog({ action, teams, onClose }: { action: 'start' | 'stop'; teams: TeamSummary[]; onClose: () => void }) {
  const [confirmation, setConfirmation] = useState('');
  const [result, setResult] = useState<BulkEnvActionResponse | null>(null);
  const [requestedAt, setRequestedAt] = useState(0);
  const announced = useRef(false);
  // Names are captured when the dialog opens: the list behind it refetches and the selection may no longer match its filter.
  const [names] = useState(() => new Map(teams.map((t) => [t.id, t.name])));
  const [ids] = useState(() => teams.map((t) => t.id)); // snapshot: the selection changes as teams leave a filtered list
  const bulk = useBulkEnvironmentAction();
  const expected = action === 'start' ? 'START ALL' : 'STOP ALL';
  const finalState = action === 'start' ? 'running' : 'stopped';
  const requiresConfirmation = teams.length >= 5;
  const submit = () => bulk.mutate({ action, teamIds: ids, ...(requiresConfirmation ? { confirm: confirmation } : {}) }, {
    onSuccess: (r) => { setRequestedAt(Date.now()); setResult(r); },
  });

  // After the request, follow every accepted team until its polled state matches the expected outcome.
  const progress = useQuery({
    queryKey: ['bulk-progress', action, ids],
    queryFn: () => apiListTeams({ pageSize: 100 }),
    enabled: !!result,
    refetchInterval: 2000,
  });
  const rows = useMemo(() => (result?.results ?? []).map((r) => {
    const live = progress.data?.items.find((t) => t.id === r.teamId);
    const fresh = (progress.dataUpdatedAt ?? 0) > requestedAt; // ignore a list fetched before the request
    let status: 'done' | 'working' | 'failed' | 'refused' | 'noop' | 'unknown' = 'working';
    if (r.status === 'rejected') status = 'refused';
    else if (r.status === 'noop') status = 'noop';
    else if (progress.isError || (fresh && progress.data && !live)) status = 'unknown'; // cannot confirm: never leave a row waiting forever
    else if (live && fresh && !live.pending) status = live.lifecycleState === finalState ? 'done' : live.lifecycleState === 'failed' ? 'failed' : 'working';
    return { ...r, name: names.get(r.teamId) ?? r.teamId, status };
  }), [result, progress.data, progress.dataUpdatedAt, progress.isError, requestedAt, finalState, names]);

  const settled = !!result && rows.every((r) => r.status !== 'working');
  useEffect(() => {
    if (!settled || announced.current) return;
    announced.current = true;
    const done = rows.filter((r) => r.status === 'done').length;
    const bad = rows.filter((r) => r.status === 'failed' || r.status === 'refused' || r.status === 'unknown');
    if (bad.length === 0) toast.success(`${done} environment${done === 1 ? '' : 's'} ${finalState}${rows.length - done ? `, ${rows.length - done} already were` : ''}`);
    else toast.error(`${bad.length} of ${rows.length} did not ${action}: ${bad.map((r) => r.teamId).join(', ')}`, { duration: Infinity });
  }, [settled, rows, finalState, action]);

  const label: Record<string, string> = { done: `Now ${finalState}`, working: 'In progress', failed: 'Failed. Open the team for the reason', unknown: 'Could not confirm. Check the team page', refused: 'Refused', noop: `Already ${finalState}` };
  return <Overlay onClose={onClose} labelledBy="bulk-dialog-title" describedBy="bulk-dialog-description">
    <h2 id="bulk-dialog-title" className="mb-2 text-base font-semibold">{action === 'start' ? 'Start' : 'Stop'} {teams.length === 1 ? teams[0].id : `${teams.length} environments`}?</h2>
    {!result ? <>
      <p id="bulk-dialog-description" className="text-sm text-[var(--muted)]">Each selected team is processed on its own with the single-team rules. Progress for every team is shown here.</p>
      {action === 'stop' && <p className="mt-2 text-sm text-[var(--warn)]">Environments are retained; active terminal sessions will end.</p>}
      {requiresConfirmation && <label className="mt-4 block text-sm">Type <strong>{expected}</strong> to confirm<Input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="mt-1 border-[var(--border-strong)] bg-[var(--surface-inset)]" /></label>}
      {bulk.error && <p role="alert" className="mt-3 text-sm text-[var(--bad)]">{bulk.error.message}</p>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={bulk.isPending || (requiresConfirmation && confirmation !== expected)} onClick={submit}>{bulk.isPending ? 'Sending…' : `${action === 'start' ? 'Start' : 'Stop'} ${teams.length === 1 ? 'environment' : 'environments'}`}</Button></div>
    </> : <>
      <p id="bulk-dialog-description" className="text-sm text-[var(--muted)]" aria-live="polite">{settled ? 'Finished.' : `Waiting for ${rows.filter((r) => r.status === 'working').length} of ${rows.length} to reach ${finalState}…`}</p>
      <ul className="mt-3 max-h-72 divide-y divide-[var(--border)] overflow-auto rounded border border-[var(--border)] text-sm" aria-label="Progress per team">
        {rows.map((r) => <li key={r.teamId} className="flex items-center justify-between gap-3 px-3 py-1.5"><span><span className="font-mono text-xs text-[var(--text-subtle)]">{r.teamId}</span> {r.name}</span><span className={r.status === 'done' ? 'text-[var(--ok)]' : r.status === 'failed' || r.status === 'refused' || r.status === 'unknown' ? 'text-[var(--bad)]' : 'text-[var(--muted)]'}>{label[r.status]}{r.status === 'refused' && r.code ? ` (${r.code})` : ''}</span></li>)}
      </ul>
      <div className="mt-4 flex justify-end"><Button onClick={onClose}>{settled ? 'Close' : 'Close and keep waiting in the background'}</Button></div>
    </>}
  </Overlay>;
}

function RecentStrip() {
  const recent = useRecentTeams();
  if (!recent.length) return null;
  return (
    <nav aria-label="Recently opened teams" className="mb-3 flex flex-wrap items-center gap-2 text-xs text-[var(--text-subtle)]">
      <span>Recent:</span>
      {recent.map((t) => <Link key={t.id} href={`/teams/${t.id}`} className="rounded border border-[var(--border)] px-2 py-0.5 hover:border-[var(--accent)] hover:text-[var(--accent)]"><span className="font-mono">{t.id}</span> {t.name}</Link>)}
    </nav>
  );
}

function SortHead({ field, label, sort, onSort }: { field: string; label: string; sort: string; onSort: (next: string) => void }) {
  const active = sort === field || sort === `-${field}`;
  const desc = sort === `-${field}`;
  const Icon = !active ? ArrowUpDown : desc ? ArrowDown : ArrowUp;
  return (
    <TableHead aria-sort={active ? (desc ? 'descending' : 'ascending') : 'none'}>
      <button type="button" className="inline-flex items-center gap-1 hover:text-[var(--accent)]" onClick={() => onSort(active && !desc ? `-${field}` : field)}>
        {label}<Icon size={16} aria-hidden="true" className={active ? 'text-[var(--accent)]' : 'text-[var(--text-subtle)]'} />
      </button>
    </TableHead>
  );
}

const TeamRow = memo(function TeamRow({ team, selected, onToggle, onOpen, onBulk }: {
  team: TeamSummary;
  selected: boolean;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onBulk: (action: 'start' | 'stop', team: TeamSummary) => void;
}) {
  const busy = !!team.pending;
  return (
    <TableRow
      tabIndex={0}
      data-state={selected ? 'selected' : undefined}
      className="cursor-pointer focus-visible:bg-[var(--panel-2)]"
      aria-label={`${team.id} ${team.name}`}
      onClick={() => onOpen(team.id)}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(team.id); } }}
    >
      <TableCell onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${team.id}`} checked={selected} onChange={() => onToggle(team.id)} /></TableCell>
      <TableCell className="whitespace-nowrap"><span className="font-mono text-xs text-[var(--text-subtle)]">{team.id}</span>{' '}<span className="font-medium">{team.name}</span></TableCell>
      <TableCell><StateBadge state={team.lifecycleState} size="sm" /></TableCell>
      <TableCell><HealthBadge health={team.health} size="sm" /></TableCell>
      <TableCell className="text-right tabular-nums">{team.participantCount}</TableCell>
      <TableCell><span className={`inline-flex items-center gap-1 ${team.accountStatus === 'active' ? 'text-[var(--ok)]' : 'text-[var(--warn)]'}`}>{team.accountStatus === 'active' ? <CheckCircle2 size={16} aria-hidden="true" /> : <ShieldAlert size={16} aria-hidden="true" />}{team.accountStatus === 'active' ? 'Active' : 'Suspended'}</span></TableCell>
      <TableCell><RelativeTime ts={team.updatedAt} className="text-xs text-[var(--text-subtle)]" /></TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger className="rounded p-1 text-[var(--muted)] hover:bg-[var(--panel-2)] hover:text-[var(--text)]" aria-label={`Actions for ${team.id}`}><MoreHorizontal size={16} aria-hidden="true" /></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={() => onOpen(team.id)}>Open team</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={busy || team.lifecycleState !== 'stopped'} onClick={() => onBulk('start', team)}>{team.lifecycleState === 'running' ? 'Start (already running)' : busy ? 'Start (action in progress)' : 'Start environment'}</DropdownMenuItem>
            <DropdownMenuItem disabled={busy || team.lifecycleState !== 'running'} onClick={() => onBulk('stop', team)}>{team.lifecycleState === 'stopped' ? 'Stop (already stopped)' : busy ? 'Stop (action in progress)' : 'Stop environment'}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => { void navigator.clipboard.writeText(team.id); toast.success(`Copied ${team.id}`); }}>Copy team id</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
});

export default function TeamsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [term, setTerm] = useState(params.get('q') ?? '');
  const [state, setState] = useState(params.get('state') ?? '');
  const [healthFilter, setHealthFilter] = useState(params.get('health') ?? '');
  const [accountFilter, setAccountFilter] = useState(params.get('account') ?? '');
  const [pageNumber, setPageNumber] = useState(Math.max(1, Math.floor(Number(params.get('page') ?? '1')) || 1));
  const [sort, setSort] = useState(/^-?(id|name|state|health|updated)$/.test(params.get('sort') ?? '') ? params.get('sort')! : 'id');
  const [selected, setSelected] = useState<string[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [bulkAction, setBulkAction] = useState<'start' | 'stop' | null>(null);
  const [rowTarget, setRowTarget] = useState<TeamSummary | null>(null); // set when the dialog was opened from one row's menu
  const [credentials, setCredentials] = useState<IssuedCredential[] | null>(null);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [participantNames, setParticipantNames] = useState('Participant 1\nParticipant 2\nParticipant 3\nParticipant 4');
  const [autoProvision, setAutoProvision] = useState(true);
  const create = useCreateTeam();
  // "/" focuses this page's search (capture phase, so the top-bar search does not also take it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (e.key !== '/' || tag === 'input' || tag === 'textarea' || tag === 'select') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      document.getElementById('teams-search')?.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  useEffect(() => { const id = window.setTimeout(() => setTerm(search), 250); return () => window.clearTimeout(id); }, [search]);
  useEffect(() => {
    const next = new URLSearchParams();
    if (term) next.set('q', term);
    if (state) next.set('state', state);
    if (healthFilter) next.set('health', healthFilter);
    if (accountFilter) next.set('account', accountFilter);
    if (pageNumber > 1) next.set('page', String(pageNumber));
    if (sort !== 'id') next.set('sort', sort);
    router.replace(`${pathname}${next.toString() ? `?${next.toString()}` : ''}`, { scroll: false });
  }, [accountFilter, healthFilter, pageNumber, pathname, router, sort, state, term]);
  const query = useTeams({ q: term || undefined, state: state || undefined, health: healthFilter || undefined, account: accountFilter || undefined, page: pageNumber, pageSize: 25, sort });
  const page = query.data;
  const selectedTeams = useMemo(() => page?.items.filter((team) => selected.includes(team.id)) ?? [], [page?.items, selected]);
  const allVisibleSelected = !!page?.items.length && page.items.every((team) => selected.includes(team.id));
  const toggleAll = () => setSelected(allVisibleSelected ? [] : (page?.items.map((team) => team.id) ?? []));
  const toggleTeam = useCallback((teamId: string) => setSelected((current) => current.includes(teamId) ? current.filter((id) => id !== teamId) : [...current, teamId]), []);
  const openTeam = useCallback((teamId: string) => router.push(`/teams/${teamId}`), [router]);
  const rowBulk = useCallback((action: 'start' | 'stop', team: TeamSummary) => { setRowTarget(team); setBulkAction(action); }, []);
  const onSort = useCallback((next: string) => { setSort(next); setPageNumber(1); }, []);
  const submit = async () => {
    if (!name.trim()) return;
    const names = participantNames.split(/\r?\n/).map((value) => value.trim()).filter(Boolean).slice(0, 8);
    const result = await create.mutateAsync({ body: { name: name.trim(), notes: notes.trim() || undefined, participantNames: names, autoProvision } });
    setCredentials(result.credentials); setName(''); setNotes(''); setParticipantNames('Participant 1\nParticipant 2\nParticipant 3\nParticipant 4'); setAutoProvision(true); setShowCreate(false);
  };
  const handleImport = (result: TeamImportResponse) => {
    if (result.created.length) setCredentials(result.created.flatMap((item) => item.credentials));
    if (result.skipped.length) toast.warning(`${result.skipped.length} row(s) skipped during import`);
  };
  return <QueryState loading={query.isLoading} error={query.error} onRetry={() => query.refetch()}>
    <PageHeader title="Teams" description={page ? `Showing ${page.total ? ((page.page - 1) * page.pageSize) + 1 : 0}–${Math.min(page.page * page.pageSize, page.total)} of ${page.total}` : undefined} onRefresh={() => query.refetch()} refreshing={query.isFetching}>
      <Button variant="outline" onClick={() => setShowImport(true)}><Upload size={16} />Import CSV</Button><Button onClick={() => setShowCreate(true)}><Plus size={16} />Create team</Button>
    </PageHeader>
    <RecentStrip />
    <Card className="console-surface"><CardContent className="p-4">
      <div className="mb-4 flex flex-wrap gap-3"><div className="relative min-w-[240px] flex-1"><Search size={16} className="absolute left-3 top-2.5 text-[var(--muted)]" /><Input className="pl-9" value={search} onChange={(e) => { setSearch(e.target.value); setPageNumber(1); }} id="teams-search" placeholder="Search by team name or ID ( / )" aria-label="Search teams" /></div><select aria-label="Filter by lifecycle state" value={state} onChange={(e) => { setState(e.target.value); setPageNumber(1); }} className="h-8 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-inset)] px-3 text-sm"><option value="">All states</option><option value="running">Running</option><option value="stopped">Stopped</option><option value="failed">Failed</option><option value="starting">Starting</option><option value="stopping">Stopping</option></select><select aria-label="Filter by health" value={healthFilter} onChange={(e) => { setHealthFilter(e.target.value); setPageNumber(1); }} className="h-8 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-inset)] px-3 text-sm"><option value="">All health</option><option value="healthy">Healthy</option><option value="degraded">Degraded</option><option value="down">Down</option><option value="unknown">Unknown</option></select><select aria-label="Filter by account status" value={accountFilter} onChange={(e) => { setAccountFilter(e.target.value); setPageNumber(1); }} className="h-8 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-inset)] px-3 text-sm"><option value="">All accounts</option><option value="active">Active</option><option value="suspended">Suspended</option></select>{(search || state || healthFilter || accountFilter || sort !== 'id' || pageNumber > 1) && <Button size="sm" variant="ghost" onClick={() => { setSearch(''); setTerm(''); setState(''); setHealthFilter(''); setAccountFilter(''); setSort('id'); setPageNumber(1); }}>Clear filters</Button>}</div>
      {selectedTeams.length > 0 && <div className="mb-4 flex items-center justify-between rounded border border-[var(--accent)] bg-[var(--panel-2)] p-3 text-sm"><span aria-live="polite">{selectedTeams.length} of {page?.total ?? 0} selected</span><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setBulkAction('start')}>Start selected</Button><Button size="sm" variant="outline" onClick={() => setBulkAction('stop')}>Stop selected</Button><Button size="sm" variant="ghost" onClick={() => setSelected([])}>Clear</Button></div></div>}
      {!page?.items.length ? <div className="py-12 text-center text-sm text-[var(--muted)]">{term || state || healthFilter || accountFilter ? 'No teams match these filters' : 'No teams yet'}</div> : <><Table containerClassName="max-h-[calc(100dvh-18rem)] min-h-64" className="sticky-cols tabular-nums [&_td]:py-1.5 [&_td]:px-1.5 [&_th]:px-1.5"><TableHeader><TableRow><TableHead><input type="checkbox" aria-label="Select visible teams" checked={allVisibleSelected} onChange={toggleAll} /></TableHead><SortHead field="id" label="Team" sort={sort} onSort={onSort} /><SortHead field="state" label="State" sort={sort} onSort={onSort} /><SortHead field="health" label="Health" sort={sort} onSort={onSort} /><TableHead className="text-right">Participants</TableHead><TableHead>Account</TableHead><SortHead field="updated" label="Updated" sort={sort} onSort={onSort} /><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader><TableBody>{page.items.map((team) => <TeamRow key={team.id} team={team} selected={selected.includes(team.id)} onToggle={toggleTeam} onOpen={openTeam} onBulk={rowBulk} />)}</TableBody></Table><div className="mt-4 flex items-center justify-between border-t border-[var(--border)] pt-3 text-xs text-[var(--muted)]"><span>Page {page.page} of {Math.max(1, Math.ceil(page.total / page.pageSize))}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page.page <= 1} onClick={() => setPageNumber((value) => Math.max(1, value - 1))}>Previous</Button><Button size="sm" variant="outline" disabled={page.page * page.pageSize >= page.total} onClick={() => setPageNumber((value) => value + 1)}>Next</Button></div></div></>}
    </CardContent></Card>
    {showCreate && <Overlay onClose={() => setShowCreate(false)} labelledBy="create-dialog-title" describedBy="create-dialog-description"><h2 id="create-dialog-title" className="text-base font-semibold">Create team</h2><p id="create-dialog-description" className="mt-1 text-sm text-[var(--muted)]">Credentials are shown once after the team is created.</p><label className="mt-4 block text-sm">Team name<Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus /></label><label className="mt-3 block text-sm">Notes<textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} className="mt-1 min-h-20 w-full rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-2" /></label><label className="mt-3 block text-sm">Participants <span className="text-xs text-[var(--muted)]">(one name per line, up to 8)</span><textarea value={participantNames} onChange={(e) => setParticipantNames(e.target.value)} className="mt-1 min-h-24 w-full rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-2 text-sm" /></label><label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={autoProvision} onChange={(e) => setAutoProvision(e.target.checked)} /> Provision environment now</label>{create.error && <p role="alert" className="mt-3 text-sm text-[var(--bad)]">{create.error.message}</p>}<div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button><Button onClick={submit} disabled={!name.trim() || create.isPending}>{create.isPending ? 'Creating…' : 'Create team'}</Button></div></Overlay>}
    {showImport && <ImportDialog onClose={() => setShowImport(false)} onCredentials={handleImport} />}
    {bulkAction && <BulkDialog action={bulkAction} teams={rowTarget ? [rowTarget] : selectedTeams} onClose={() => { setBulkAction(null); setRowTarget(null); if (!rowTarget) setSelected([]); }} />}
    {credentials && <CredentialsReveal credentials={credentials} onClose={() => setCredentials(null)} />}
  </QueryState>;
}
