'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Search } from 'lucide-react';
import { useCreateTeam, useTeams } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { HealthBadge } from '@/components/status/HealthBadge';
import { StateBadge } from '@/components/status/StateBadge';
import { PageHeader, QueryState } from '@/components/console/DashboardPrimitives';
import { RelativeTime } from '@/components/ui/relative-time';

export default function TeamsPage() {
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [state, setState] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const create = useCreateTeam();
  useEffect(() => { const id = window.setTimeout(() => setTerm(search), 250); return () => window.clearTimeout(id); }, [search]);
  const query = useTeams({ q: term || undefined, state: state || undefined });
  const page = query.data;
  const submit = async () => { if (!name.trim()) return; await create.mutateAsync({ body: { name: name.trim(), notes: notes.trim() || undefined, autoProvision: true } }); setName(''); setNotes(''); setShowCreate(false); };
  return <QueryState loading={query.isLoading} error={query.error} onRetry={() => query.refetch()}>
    <PageHeader title="Teams" description={page ? `Showing ${page.items.length ? 1 : 0}–${page.items.length} of ${page.total}` : undefined} onRefresh={() => query.refetch()} refreshing={query.isFetching}><Button onClick={() => setShowCreate(true)}><Plus size={15} />Create team</Button></PageHeader>
    <Card><CardContent className="p-4">
      <div className="mb-4 flex flex-wrap gap-3"><div className="relative min-w-[240px] flex-1"><Search size={15} className="absolute left-3 top-2.5 text-[var(--muted)]" /><Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by team name or ID" /></div><select value={state} onChange={(e) => setState(e.target.value)} className="h-8 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 text-sm"><option value="">All states</option><option value="running">Running</option><option value="stopped">Stopped</option><option value="failed">Failed</option><option value="starting">Starting</option><option value="stopping">Stopping</option></select></div>
      {!page?.items.length ? <div className="py-12 text-center text-sm text-[var(--muted)]">{term || state ? 'No teams match these filters' : 'No teams yet'}</div> : <Table><TableHeader><TableRow><TableHead>Team</TableHead><TableHead>State</TableHead><TableHead>Health</TableHead><TableHead>Participants</TableHead><TableHead>Account</TableHead><TableHead>Updated</TableHead></TableRow></TableHeader><TableBody>{page.items.map((team) => <TableRow key={team.id}><TableCell><Link href={`/teams/${team.id}`} className="block hover:text-[var(--accent)]"><div className="font-mono text-xs text-[var(--muted)]">{team.id}</div><div className="font-medium">{team.name}</div></Link></TableCell><TableCell><StateBadge state={team.lifecycleState} size="sm" /></TableCell><TableCell><HealthBadge health={team.health} size="sm" /></TableCell><TableCell>{team.participantCount}</TableCell><TableCell><span className={team.accountStatus === 'active' ? 'text-[var(--ok)]' : 'text-[var(--warn)]'}>{team.accountStatus === 'active' ? 'Active' : 'Suspended'}</span></TableCell><TableCell><RelativeTime ts={team.updatedAt} className="text-xs text-[var(--muted)]" /></TableCell></TableRow>)}</TableBody></Table>}
    </CardContent></Card>
    {showCreate && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true"><Card className="w-full max-w-lg"><CardContent className="space-y-4 p-6"><h2 className="text-lg font-semibold">Create team</h2><label className="block text-sm">Team name<Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus /></label><label className="block text-sm">Notes<textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} className="mt-1 min-h-20 w-full rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-2" /></label><p className="text-xs text-[var(--muted)]">The environment will be provisioned after creation.</p>{create.error && <p className="text-sm text-[var(--bad)]">{create.error.message}</p>}<div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button><Button onClick={submit} disabled={!name.trim() || create.isPending}>{create.isPending ? 'Creating…' : 'Create team'}</Button></div></CardContent></Card></div>}
    </QueryState>;
}
