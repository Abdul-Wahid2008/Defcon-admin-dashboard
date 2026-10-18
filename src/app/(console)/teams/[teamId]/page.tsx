'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ExternalLink, Play, RotateCcw, Square, Trash2 } from 'lucide-react';
import { useAudit, useDeleteTeam, useLifecycleAction, useParticipants, useRemoveParticipant, useRunHealthChecks, useTeam, useUpdateTeam } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { HealthBadge } from '@/components/status/HealthBadge';
import { StateBadge } from '@/components/status/StateBadge';
import { ActivityList, PageHeader, QueryState } from '@/components/console/DashboardPrimitives';
import { RelativeTime } from '@/components/ui/relative-time';
import { formatTimestamp } from '@/lib/format';

export default function TeamDetailPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const router = useRouter();
  const query = useTeam(teamId);
  const participants = useParticipants(teamId);
  const action = useLifecycleAction();
  const remove = useRemoveParticipant();
  const deleteMutation = useDeleteTeam();
  const health = useRunHealthChecks();
  const update = useUpdateTeam();
  const audit = useAudit({ teamId });
  const [tab, setTab] = useState('overview');
  const [editName, setEditName] = useState('');
  const team = query.data;
  const run = async (kind: 'start' | 'stop' | 'reset') => { if (!team) return; const message = kind === 'reset' ? `Reset environment for ${team.id} · ${team.name}?` : `${kind === 'start' ? 'Start' : 'Stop'} environment for ${team.id} · ${team.name}?`; if (window.confirm(message)) await action.mutateAsync({ teamId: team.id, action: kind }); };
  const deleteTeam = async () => { if (!team) return; const confirmation = window.prompt(`This removes the team's assigned resources and archives the team. Audit history is kept. This cannot be undone. Type ${team.name} to confirm.`); if (confirmation === team.name) { await deleteMutation.mutateAsync({ teamId: team.id, confirmName: confirmation }); router.push('/teams'); } };
  return <QueryState loading={query.isLoading} error={query.error} onRetry={() => query.refetch()}>
    {team && <div>
      <PageHeader title={team.name} description={<span className="font-mono text-xs">{team.id}</span>}><Button variant="outline" onClick={() => router.push('/teams')}><ArrowLeft size={15} />Back</Button></PageHeader>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><StateBadge state={team.lifecycleState} /><HealthBadge health={team.health} /><span className={team.accountStatus === 'active' ? 'rounded border border-[var(--ok)]/30 px-2 py-1 text-xs text-[var(--ok)]' : 'rounded border border-[var(--warn)]/30 px-2 py-1 text-xs text-[var(--warn)]'}>{team.accountStatus}</span></div><div className="flex gap-2"><Button size="sm" onClick={() => run(team.lifecycleState === 'running' ? 'stop' : 'start')} disabled={!!team.environment.pending}>{team.lifecycleState === 'running' ? <><Square size={14} />Stop</> : <><Play size={14} />Start</>}</Button><Button size="sm" variant="outline" onClick={() => run('reset')} disabled={!!team.environment.pending}><RotateCcw size={14} />Reset</Button><Button size="sm" variant="destructive" onClick={deleteTeam}><Trash2 size={14} />Delete</Button></div></div>
      <div className="mb-4 flex gap-1 border-b border-[var(--border)]">{['overview', 'participants', 'activity', 'details'].map((name) => <button key={name} onClick={() => setTab(name)} className={`border-b-2 px-3 py-2 text-sm capitalize ${tab === name ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--muted)]'}`}>{name}</button>)}</div>
      {tab === 'overview' && <div className="grid gap-4 xl:grid-cols-3"><Card><CardHeader><CardTitle>Environment</CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><div className="flex justify-between"><span className="text-[var(--muted)]">Lifecycle</span><StateBadge state={team.environment.lifecycleState} size="sm" /></div>{team.environment.pending && <div className="rounded bg-[var(--warn)]/10 p-2 text-[var(--warn)]">Action in progress: {team.environment.pending.action}</div>}{team.environment.failureReason && <div className="rounded bg-[var(--bad)]/10 p-2 text-[var(--bad)]">{team.environment.failureReason}</div>}<div className="flex justify-between"><span className="text-[var(--muted)]">Accepted patch</span><span className="font-mono">v{team.environment.acceptedPatchVersion}</span></div><div className="flex justify-between"><span className="text-[var(--muted)]">Last action</span><RelativeTime ts={team.environment.lastActionAt} /></div><div className="flex justify-between"><span className="text-[var(--muted)]">Last health check</span><RelativeTime ts={team.environment.lastHealthCheckAt} /></div>{team.environment.terminal?.url && <a className="flex items-center gap-1 font-mono text-[var(--accent)] hover:underline" href={team.environment.terminal.url} target="_blank" rel="noreferrer">{team.environment.terminal.url}<ExternalLink size={13} /></a>}</CardContent></Card><Card className="xl:col-span-2"><CardHeader><CardTitle className="flex items-center justify-between">Services <Button size="sm" variant="outline" onClick={() => health.mutate(team.id)} disabled={health.isPending || team.lifecycleState !== 'running'}>{health.isPending ? 'Checking…' : 'Run health checks'}</Button></CardTitle></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Service</TableHead><TableHead>Reachability</TableHead><TableHead>Functional</TableHead><TableHead>Last checked</TableHead></TableRow></TableHeader><TableBody>{team.environment.services.map((service) => <TableRow key={service.key}><TableCell>{service.name} <span className="font-mono text-xs text-[var(--muted)]">:{service.port}</span></TableCell><TableCell className={service.checks.find((c) => c.type === 'reachability')?.status === 'fail' ? 'text-[var(--bad)]' : 'text-[var(--ok)]'}>{service.checks.find((c) => c.type === 'reachability')?.status ?? 'unknown'}</TableCell><TableCell className={service.checks.find((c) => c.type === 'functional')?.status === 'fail' ? 'text-[var(--bad)]' : 'text-[var(--ok)]'}>{service.checks.find((c) => c.type === 'functional')?.status ?? 'unknown'}</TableCell><TableCell><RelativeTime ts={service.checks[0]?.lastCheckedAt} /></TableCell></TableRow>)}</TableBody></Table></CardContent></Card></div>}
      {tab === 'participants' && <Card><CardHeader><CardTitle>Participants</CardTitle></CardHeader><CardContent>{participants.data?.length ? <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Username</TableHead><TableHead>Credential</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader><TableBody>{participants.data.map((person) => <TableRow key={person.id}><TableCell>{person.name}</TableCell><TableCell className="font-mono">{person.username}</TableCell><TableCell>v{person.credentialVersion} · <RelativeTime ts={person.credentialIssuedAt} /></TableCell><TableCell>{person.active ? 'Active' : 'Inactive'}</TableCell><TableCell><Button size="sm" variant="ghost" onClick={() => remove.mutate({ teamId: team.id, participantId: person.id })}>Remove</Button></TableCell></TableRow>)}</TableBody></Table> : <p className="py-8 text-center text-sm text-[var(--muted)]">No participants</p>}</CardContent></Card>}
      {tab === 'activity' && <Card><CardHeader><CardTitle>Activity</CardTitle></CardHeader><CardContent><ActivityList entries={audit.data?.items ?? []} /></CardContent></Card>}
      {tab === 'details' && <Card><CardHeader><CardTitle>Details</CardTitle></CardHeader><CardContent className="max-w-xl space-y-4"><label className="block text-sm">Team name<Input value={editName || team.name} onChange={(e) => setEditName(e.target.value)} /></label><p className="text-xs text-[var(--muted)]">Created {formatTimestamp(team.createdAt)}</p><Button onClick={() => update.mutate({ teamId: team.id, patch: { name: editName || team.name } })} disabled={!editName.trim() || update.isPending}>Save changes</Button><div className="rounded-lg border border-[var(--bad)]/30 p-4"><h3 className="font-medium text-[var(--bad)]">Danger zone</h3><p className="mt-1 text-sm text-[var(--muted)]">Archive this team and remove its environment resources.</p><Button className="mt-3" variant="destructive" onClick={deleteTeam}>Delete team</Button></div></CardContent></Card>}
    </div>}
  </QueryState>;
}
