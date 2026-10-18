'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Copy, ExternalLink, Play, RotateCcw, ShieldAlert, Square, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAudit, useDeleteTeam, useLifecycleAction, useParticipants, useRemoveParticipant, useRunHealthChecks, useTeam, useUpdateTeam } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { HealthBadge } from '@/components/status/HealthBadge';
import { StateBadge } from '@/components/status/StateBadge';
import { ActivityList, PageHeader, QueryState } from '@/components/console/DashboardPrimitives';
import { RelativeTime } from '@/components/ui/relative-time';
import { formatTimestamp } from '@/lib/format';

type ActionKind = 'start' | 'stop' | 'reset';

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
  const [actionDialog, setActionDialog] = useState<ActionKind | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [awaitingAction, setAwaitingAction] = useState<ActionKind | null>(null);
  const team = query.data;

  useEffect(() => {
    if (!team || !awaitingAction || team.environment.pending) return;
    if (team.lifecycleState === 'failed') {
      toast.error(`${team.id} ${awaitingAction} failed: ${team.environment.failureReason ?? 'The adapter reported a failure.'}`, { duration: Infinity });
    } else {
      toast.success(`${team.id} ${awaitingAction} complete — ${team.lifecycleState}`);
    }
    window.setTimeout(() => setAwaitingAction(null), 0);
  }, [team, awaitingAction]);

  const actionCopy = useMemo(() => {
    if (!actionDialog) return null;
    if (actionDialog === 'stop') return { title: 'Stop environment?', body: 'The environment will be stopped and its services will be unreachable. The environment is retained and can be started again. Active terminal sessions will end.', button: 'Stop environment' };
    if (actionDialog === 'reset') return { title: 'Reset environment?', body: `The environment will be restored to the latest accepted patch (v${team?.environment.acceptedPatchVersion ?? 1}), not the original vulnerable baseline. Preserved: flags and challenge state · scores and submissions · accepted patches · audit and deployment history · application data. Anything not captured in an accepted patch is discarded.`, button: 'Reset environment' };
    return { title: 'Start environment?', body: 'The retained environment will be started.', button: 'Start environment' };
  }, [actionDialog, team]);

  const submitAction = async () => {
    if (!team || !actionDialog) return;
    setAwaitingAction(actionDialog);
    setActionDialog(null);
    try {
      await action.mutateAsync({ teamId: team.id, action: actionDialog, idempotencyKey: crypto.randomUUID() });
      toast(` ${actionDialog.charAt(0).toUpperCase() + actionDialog.slice(1)} requested for ${team.id}`, { icon: <CheckCircle2 size={16} className="text-[var(--accent)]" /> });
    } catch {
      setAwaitingAction(null);
    }
  };

  const deleteTeam = async () => {
    if (!team || confirmName !== team.name) return;
    try {
      await deleteMutation.mutateAsync({ teamId: team.id, confirmName, idempotencyKey: crypto.randomUUID() });
      setDeleteOpen(false);
      router.push('/teams');
    } catch {
      // Mutation error remains visible in the dialog.
    }
  };

  return <QueryState loading={query.isLoading} error={query.error} onRetry={() => query.refetch()}>
    {team && <div>
      <PageHeader title={team.name} description={<span className="font-mono text-xs">{team.id}</span>}>
        <Button variant="outline" onClick={() => router.push('/teams')}><ArrowLeft size={15} />Back to teams</Button>
      </PageHeader>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2"><StateBadge state={team.lifecycleState} /><HealthBadge health={team.health} /><span className={`rounded border px-2 py-1 text-xs ${team.accountStatus === 'active' ? 'border-[var(--ok)]/30 text-[var(--ok)]' : 'border-[var(--warn)]/30 text-[var(--warn)]'}`}>{team.accountStatus}</span></div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setActionDialog(team.lifecycleState === 'running' ? 'stop' : 'start')} disabled={!!team.environment.pending || team.lifecycleState === 'deleted'}>{team.lifecycleState === 'running' ? <><Square size={14} />Stop</> : <><Play size={14} />Start</>}</Button>
          <Button size="sm" variant="outline" onClick={() => setActionDialog('reset')} disabled={!!team.environment.pending || !['running', 'failed'].includes(team.lifecycleState)}><RotateCcw size={14} />Reset</Button>
          <Button size="sm" variant="destructive" onClick={() => { setConfirmName(''); setDeleteOpen(true); }} disabled={!!team.environment.pending || team.lifecycleState === 'deleted'}><Trash2 size={14} />Delete</Button>
        </div>
      </div>

      {team.environment.pending && <div role="status" className="mb-5 flex items-center gap-3 rounded-lg border border-[var(--warn)]/40 bg-[var(--warn)]/10 p-3 text-sm text-[var(--warn)]"><ShieldAlert size={16} /><span><strong>{team.environment.pending.action}</strong> is in progress. The final state will be confirmed by polling.</span></div>}
      {team.environment.failureReason && <div className="mb-5 flex items-start gap-3 rounded-lg border border-[var(--bad)]/40 bg-[var(--bad)]/10 p-3 text-sm text-[var(--bad)]"><ShieldAlert size={17} className="mt-0.5" /><div><strong>Environment needs attention.</strong><p className="mt-1">{team.environment.failureReason}</p></div></div>}

      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-[var(--border)]" role="tablist" aria-label="Team detail sections">{['overview', 'participants', 'activity', 'details'].map((name) => <button key={name} role="tab" aria-selected={tab === name} onClick={() => setTab(name)} className={`border-b-2 px-3 py-2.5 text-sm capitalize ${tab === name ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'}`}>{name}</button>)}</div>

      {tab === 'overview' && <div className="grid gap-4 xl:grid-cols-3">
        <Card className="console-surface"><CardHeader className="border-b border-[var(--border)]"><CardTitle>Environment</CardTitle></CardHeader><CardContent className="space-y-3 pt-4 text-sm">
          <div className="flex justify-between"><span className="text-[var(--muted)]">Lifecycle</span><StateBadge state={team.environment.lifecycleState} size="sm" /></div>
          <div className="flex justify-between"><span className="text-[var(--muted)]">Accepted patch</span><span className="font-mono">v{team.environment.acceptedPatchVersion}</span></div>
          <div className="flex justify-between"><span className="text-[var(--muted)]">Last action</span><RelativeTime ts={team.environment.lastActionAt} /></div>
          <div className="flex justify-between"><span className="text-[var(--muted)]">Last health check</span><RelativeTime ts={team.environment.lastHealthCheckAt} /></div>
          {team.environment.lastDeploy && <div className="flex justify-between"><span className="text-[var(--muted)]">Last deploy</span><span className="font-mono text-xs">{team.environment.lastDeploy.result} · v{team.environment.lastDeploy.version}</span></div>}
          {team.environment.terminal?.url ? <a className="flex items-center gap-1 break-all border-t border-[var(--border)] pt-3 font-mono text-xs text-[var(--accent)] hover:underline" href={team.environment.terminal.url} target="_blank" rel="noreferrer">{team.environment.terminal.url}<ExternalLink size={13} /></a> : <p className="border-t border-[var(--border)] pt-3 text-xs text-[var(--muted)]">Terminal endpoint unavailable while this environment is not running.</p>}
        </CardContent></Card>
        <Card className="console-surface xl:col-span-2"><CardHeader className="border-b border-[var(--border)]"><CardTitle className="flex items-center justify-between">Services <Button size="sm" variant="outline" onClick={() => health.mutate(team.id)} disabled={health.isPending || team.lifecycleState !== 'running'}>{health.isPending ? 'Checking…' : 'Run health checks'}</Button></CardTitle></CardHeader><CardContent className="overflow-x-auto pt-4"><Table><TableHeader><TableRow><TableHead>Service</TableHead><TableHead>Reachability</TableHead><TableHead>Functional</TableHead><TableHead>Verdict</TableHead><TableHead>Last checked</TableHead></TableRow></TableHeader><TableBody>{team.environment.services.map((service) => { const reach = service.checks.find((c) => c.type === 'reachability'); const functional = service.checks.find((c) => c.type === 'functional'); const failing = reach?.status === 'fail' || functional?.status === 'fail'; return <TableRow key={service.key} className={failing ? 'bg-[var(--bad)]/5' : undefined}><TableCell><div className="font-medium">{service.name}</div><div className="font-mono text-xs text-[var(--muted)]">:{service.port}{service.placeholder ? ' · placeholder' : ''}</div></TableCell><TableCell><span className={reach?.status === 'fail' ? 'text-[var(--bad)]' : reach?.status === 'pass' ? 'text-[var(--ok)]' : 'text-[var(--muted)]'}>{reach?.status ?? 'unknown'}</span></TableCell><TableCell><span className={functional?.status === 'fail' ? 'text-[var(--bad)]' : functional?.status === 'pass' ? 'text-[var(--ok)]' : 'text-[var(--muted)]'}>{functional?.status ?? 'unknown'}</span></TableCell><TableCell className="max-w-[260px] truncate text-xs text-[var(--muted)]" title={reach?.detail ?? functional?.detail ?? ''}>{reach?.detail ?? functional?.detail ?? 'No checker detail'}</TableCell><TableCell><RelativeTime ts={reach?.lastCheckedAt ?? functional?.lastCheckedAt} /></TableCell></TableRow>; })}</TableBody></Table></CardContent></Card>
      </div>}

      {tab === 'participants' && <Card className="console-surface"><CardHeader className="border-b border-[var(--border)]"><CardTitle>Participants</CardTitle></CardHeader><CardContent className="overflow-x-auto pt-4">{participants.data?.length ? <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Username</TableHead><TableHead>Credential</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader><TableBody>{participants.data.map((person) => <TableRow key={person.id}><TableCell>{person.name}</TableCell><TableCell className="font-mono text-xs">{person.username} <button aria-label={`Copy ${person.username}`} className="ml-1 text-[var(--muted)] hover:text-[var(--accent)]" onClick={() => navigator.clipboard.writeText(person.username)}><Copy size={12} className="inline" /></button></TableCell><TableCell>v{person.credentialVersion} · <RelativeTime ts={person.credentialIssuedAt} /></TableCell><TableCell><span className={person.active ? 'text-[var(--ok)]' : 'text-[var(--muted)]'}>{person.active ? 'Active' : 'Inactive'}</span></TableCell><TableCell><Button size="sm" variant="ghost" onClick={() => remove.mutate({ teamId: team.id, participantId: person.id })}>Remove</Button></TableCell></TableRow>)}</TableBody></Table> : <p className="py-8 text-center text-sm text-[var(--muted)]">No participants have been issued credentials.</p>}</CardContent></Card>}
      {tab === 'activity' && <Card className="console-surface"><CardHeader className="border-b border-[var(--border)]"><CardTitle>Activity</CardTitle></CardHeader><CardContent className="pt-2"><ActivityList entries={audit.data?.items ?? []} /></CardContent></Card>}
      {tab === 'details' && <Card className="console-surface"><CardHeader className="border-b border-[var(--border)]"><CardTitle>Team details</CardTitle></CardHeader><CardContent className="max-w-xl space-y-4 pt-5"><label className="block text-sm font-medium" htmlFor="team-name">Team name<Input id="team-name" value={editName || team.name} onChange={(e) => setEditName(e.target.value)} /></label><p className="text-xs text-[var(--muted)]">Created {formatTimestamp(team.createdAt)} · Updated {formatTimestamp(team.updatedAt)}</p><Button onClick={() => update.mutate({ teamId: team.id, patch: { name: editName || team.name } })} disabled={!editName.trim() || update.isPending}>Save changes</Button><div className="rounded-lg border border-[var(--bad)]/30 p-4"><h3 className="font-medium text-[var(--bad)]">Danger zone</h3><p className="mt-1 text-sm text-[var(--muted)]">Archive this team and remove its environment resources. Audit history is kept.</p><Button className="mt-3" variant="destructive" onClick={() => setDeleteOpen(true)}>Delete team</Button></div></CardContent></Card>}

      <Dialog open={!!actionDialog} onOpenChange={(open) => !open && setActionDialog(null)}>
        <DialogContent><DialogHeader><DialogTitle>{actionCopy?.title}</DialogTitle><DialogDescription>{actionCopy?.body}</DialogDescription></DialogHeader><DialogFooter><DialogClose render={<Button variant="outline" />}>Cancel</DialogClose><Button onClick={submitAction} disabled={action.isPending}>{action.isPending ? 'Working…' : actionCopy?.button}</Button></DialogFooter></DialogContent>
      </Dialog>
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent><DialogHeader><DialogTitle>Delete team and environment?</DialogTitle><DialogDescription>This removes the team&apos;s assigned resources and archives the team. Audit history is kept. This cannot be undone. Type <strong>{team.name}</strong> to confirm.</DialogDescription></DialogHeader><label className="grid gap-2 text-sm font-medium" htmlFor="delete-confirm">Team name<Input id="delete-confirm" value={confirmName} onChange={(event) => setConfirmName(event.target.value)} autoFocus /></label>{deleteMutation.error && <p role="alert" className="text-sm text-[var(--bad)]">{deleteMutation.error.message}</p>}<DialogFooter><DialogClose render={<Button variant="outline" />}>Cancel</DialogClose><Button variant="destructive" onClick={deleteTeam} disabled={confirmName !== team.name || deleteMutation.isPending}>{deleteMutation.isPending ? 'Deleting…' : 'Delete team'}</Button></DialogFooter></DialogContent>
      </Dialog>
    </div>}
  </QueryState>;
}
