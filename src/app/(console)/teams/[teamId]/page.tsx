'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Copy, ExternalLink, Play, RotateCcw, ShieldAlert, Square, Trash2, UserPlus, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { useAddParticipant, useAudit, useDeleteTeam, useLifecycleAction, useParticipants, useRemoveParticipant, useRotateCredentials, useRunHealthChecks, useTeam, useUpdateTeam } from '@/lib/queries';
import type { IssuedCredential } from '@/lib/schemas';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { HealthBadge } from '@/components/status/HealthBadge';
import { StateBadge } from '@/components/status/StateBadge';
import { ActivityList, CheckStatus, PageHeader, QueryState, ResourceBars } from '@/components/console/DashboardPrimitives';
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
  const add = useAddParticipant();
  const rotate = useRotateCredentials();
  const deleteMutation = useDeleteTeam();
  const health = useRunHealthChecks();
  const update = useUpdateTeam();
  const audit = useAudit({ teamId });
  const [tab, setTab] = useState('overview');
  const [editName, setEditName] = useState('');
  const [actionDialog, setActionDialog] = useState<ActionKind | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [participantName, setParticipantName] = useState('');
  const [participantDialog, setParticipantDialog] = useState(false);
  const [credentialDialog, setCredentialDialog] = useState<IssuedCredential[] | null>(null);
  const [statusDialog, setStatusDialog] = useState<'active' | 'suspended' | null>(null);
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

  const addParticipant = async () => {
    if (!team || !participantName.trim()) return;
    try {
      const result = await add.mutateAsync({ teamId: team.id, name: participantName.trim() });
      setCredentialDialog([result.credential]);
      setParticipantName('');
      setParticipantDialog(false);
    } catch {
      // Mutation error remains visible in the dialog.
    }
  };

  const rotateCredentials = async (participantId?: string) => {
    if (!team) return;
    try {
      const result = await rotate.mutateAsync({ teamId: team.id, participantId });
      setCredentialDialog(result.credentials);
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
          {team.environment.terminal?.url ? <div className="border-t border-[var(--border)] pt-3"><div className="mb-1 text-xs text-[var(--muted)]">Simulated terminal endpoint</div><div className="flex items-center gap-2"><a className="min-w-0 flex-1 break-all font-mono text-xs text-[var(--accent)] hover:underline" href={team.environment.terminal.url} target="_blank" rel="noreferrer">{team.environment.terminal.url}</a><button type="button" className="rounded p-1.5 text-[var(--muted)] hover:bg-[var(--panel-2)] hover:text-[var(--accent)]" aria-label="Copy terminal endpoint" onClick={() => navigator.clipboard.writeText(team.environment.terminal?.url ?? '')}><Copy size={14} /></button><ExternalLink size={13} className="shrink-0 text-[var(--muted)]" /></div></div> : <p className="border-t border-[var(--border)] pt-3 text-xs text-[var(--muted)]">Terminal endpoint unavailable while this environment is not running.</p>}
        </CardContent></Card>
        <div className="space-y-4 xl:col-span-2"><Card className="console-surface"><CardHeader className="border-b border-[var(--border)]"><CardTitle className="flex items-center justify-between">Services <Button size="sm" variant="outline" onClick={() => health.mutate(team.id)} disabled={health.isPending || team.lifecycleState !== 'running'}>{health.isPending ? 'Checking…' : 'Run health checks'}</Button></CardTitle></CardHeader><CardContent className="overflow-x-auto pt-4"><Table><TableHeader><TableRow><TableHead>Service</TableHead><TableHead>Reachability</TableHead><TableHead>Functional</TableHead><TableHead>Verdict</TableHead><TableHead>Last checked</TableHead></TableRow></TableHeader><TableBody>{team.environment.services.map((service) => { const reach = service.checks.find((c) => c.type === 'reachability'); const functional = service.checks.find((c) => c.type === 'functional'); const failing = reach?.status === 'fail' || functional?.status === 'fail'; return <TableRow key={service.key} className={failing ? 'bg-[var(--bad)]/5' : undefined}><TableCell><div className="font-medium">{service.name}</div><div className="font-mono text-xs text-[var(--muted)]">:{service.port}{service.placeholder ? ' · placeholder' : ''}</div></TableCell><TableCell><CheckStatus status={reach?.status ?? 'unknown'} detail={reach?.detail} /></TableCell><TableCell><CheckStatus status={functional?.status ?? 'unknown'} detail={functional?.detail} /></TableCell><TableCell className="max-w-[260px] truncate text-xs text-[var(--muted)]" title={reach?.detail ?? functional?.detail ?? ''}>{reach?.detail ?? functional?.detail ?? 'No checker detail'}</TableCell><TableCell><RelativeTime ts={reach?.lastCheckedAt ?? functional?.lastCheckedAt} /></TableCell></TableRow>; })}</TableBody></Table></CardContent></Card><Card className="console-surface"><CardHeader className="border-b border-[var(--border)]"><CardTitle className="flex items-center justify-between">Resource usage <span className="text-xs font-normal text-[var(--muted)]">{team.environment.resources?.isMock ? 'Simulated values' : 'Runtime values'}</span></CardTitle></CardHeader><CardContent className="pt-4"><ResourceBars resources={team.environment.resources} /></CardContent></Card></div>
      </div>}

      {tab === 'participants' && <Card className="console-surface"><CardHeader className="flex-row items-center justify-between border-b border-[var(--border)]"><CardTitle>Participants</CardTitle><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => rotateCredentials()} disabled={rotate.isPending || !participants.data?.length}><KeyRound size={14} />Rotate all</Button><Button size="sm" onClick={() => setParticipantDialog(true)} disabled={(participants.data?.length ?? 0) >= 8}><UserPlus size={14} />Add participant</Button></div></CardHeader><CardContent className="overflow-x-auto pt-4">{participants.data?.length ? <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Username</TableHead><TableHead>Credential</TableHead><TableHead>Status</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader><TableBody>{participants.data.map((person) => <TableRow key={person.id}><TableCell>{person.name}</TableCell><TableCell className="font-mono text-xs">{person.username} <button aria-label={`Copy ${person.username}`} className="ml-1 rounded p-1 text-[var(--muted)] hover:text-[var(--accent)]" onClick={() => navigator.clipboard.writeText(person.username)}><Copy size={12} className="inline" /></button></TableCell><TableCell>v{person.credentialVersion} · <RelativeTime ts={person.credentialIssuedAt} /></TableCell><TableCell><span className={person.active ? 'text-[var(--ok)]' : 'text-[var(--muted)]'}>{person.active ? 'Active' : 'Inactive'}</span></TableCell><TableCell><div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => rotateCredentials(person.id)} disabled={rotate.isPending}>Rotate</Button><Button size="sm" variant="ghost" onClick={() => remove.mutate({ teamId: team.id, participantId: person.id })} disabled={remove.isPending}>Remove</Button></div></TableCell></TableRow>)}</TableBody></Table> : <p className="py-8 text-center text-sm text-[var(--muted)]">No participants have been issued credentials.</p>}</CardContent></Card>}
      {tab === 'activity' && <Card className="console-surface"><CardHeader className="border-b border-[var(--border)]"><CardTitle>Activity</CardTitle></CardHeader><CardContent className="pt-2"><ActivityList entries={audit.data?.items ?? []} /></CardContent></Card>}
      {tab === 'details' && <Card className="console-surface"><CardHeader className="border-b border-[var(--border)]"><CardTitle>Team details</CardTitle></CardHeader><CardContent className="max-w-xl space-y-4 pt-5"><label className="block text-sm font-medium" htmlFor="team-name">Team name<Input id="team-name" value={editName || team.name} onChange={(e) => setEditName(e.target.value)} /></label><label className="block text-sm font-medium" htmlFor="team-notes">Notes<textarea id="team-notes" defaultValue={team.notes} className="mt-1 min-h-24 w-full rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-2 text-sm" /></label><p className="text-xs text-[var(--muted)]">Created {formatTimestamp(team.createdAt)} · Updated {formatTimestamp(team.updatedAt)}</p><div className="flex flex-wrap gap-2"><Button onClick={() => update.mutate({ teamId: team.id, patch: { name: editName || team.name } })} disabled={!editName.trim() || update.isPending}>Save name</Button><Button variant="outline" onClick={() => setStatusDialog(team.accountStatus === 'active' ? 'suspended' : 'active')}>{team.accountStatus === 'active' ? 'Suspend account' : 'Reactivate account'}</Button></div><div className="rounded-lg border border-[var(--bad)]/30 p-4"><h3 className="font-medium text-[var(--bad)]">Danger zone</h3><p className="mt-1 text-sm text-[var(--muted)]">Archive this team and remove its environment resources. Audit history is kept.</p><Button className="mt-3" variant="destructive" onClick={() => setDeleteOpen(true)}>Delete team</Button></div></CardContent></Card>}

      <Dialog open={!!actionDialog} onOpenChange={(open) => !open && setActionDialog(null)}>
        <DialogContent><DialogHeader><DialogTitle>{actionCopy?.title}</DialogTitle><DialogDescription>{actionCopy?.body}</DialogDescription></DialogHeader><DialogFooter><DialogClose render={<Button variant="outline" />}>Cancel</DialogClose><Button onClick={submitAction} disabled={action.isPending}>{action.isPending ? 'Working…' : actionCopy?.button}</Button></DialogFooter></DialogContent>
      </Dialog>
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent><DialogHeader><DialogTitle>Delete team and environment?</DialogTitle><DialogDescription>This removes the team&apos;s assigned resources and archives the team. Audit history is kept. This cannot be undone. Type <strong>{team.name}</strong> to confirm.</DialogDescription></DialogHeader><label className="grid gap-2 text-sm font-medium" htmlFor="delete-confirm">Team name<Input id="delete-confirm" value={confirmName} onChange={(event) => setConfirmName(event.target.value)} autoFocus /></label>{deleteMutation.error && <p role="alert" className="text-sm text-[var(--bad)]">{deleteMutation.error.message}</p>}<DialogFooter><DialogClose render={<Button variant="outline" />}>Cancel</DialogClose><Button variant="destructive" onClick={deleteTeam} disabled={confirmName !== team.name || deleteMutation.isPending}>{deleteMutation.isPending ? 'Deleting…' : 'Delete team'}</Button></DialogFooter></DialogContent>
      </Dialog>
      <Dialog open={participantDialog} onOpenChange={setParticipantDialog}>
        <DialogContent><DialogHeader><DialogTitle>Add participant</DialogTitle><DialogDescription>A new one-time password will be shown after the participant is created.</DialogDescription></DialogHeader><label className="grid gap-2 text-sm font-medium" htmlFor="participant-name">Participant name<Input id="participant-name" value={participantName} onChange={(event) => setParticipantName(event.target.value)} autoFocus /></label>{add.error && <p role="alert" className="text-sm text-[var(--bad)]">{add.error.message}</p>}<DialogFooter><DialogClose render={<Button variant="outline" />}>Cancel</DialogClose><Button onClick={addParticipant} disabled={!participantName.trim() || add.isPending}>{add.isPending ? 'Adding…' : 'Add participant'}</Button></DialogFooter></DialogContent>
      </Dialog>
      <Dialog open={!!statusDialog} onOpenChange={(open) => !open && setStatusDialog(null)}>
        <DialogContent><DialogHeader><DialogTitle>{statusDialog === 'suspended' ? 'Suspend team account?' : 'Reactivate team account?'}</DialogTitle><DialogDescription>{statusDialog === 'suspended' ? 'Suspended teams are marked inactive. The terminal gateway will enforce this once integrated.' : 'Reactivate this team account for organizer-managed access.'}</DialogDescription></DialogHeader>{update.error && <p role="alert" className="text-sm text-[var(--bad)]">{update.error.message}</p>}<DialogFooter><DialogClose render={<Button variant="outline" />}>Cancel</DialogClose><Button onClick={() => { if (statusDialog) update.mutate({ teamId: team.id, patch: { accountStatus: statusDialog } }, { onSuccess: () => setStatusDialog(null) }); }} disabled={update.isPending}>{update.isPending ? 'Saving…' : statusDialog === 'suspended' ? 'Suspend' : 'Reactivate'}</Button></DialogFooter></DialogContent>
      </Dialog>
      <Dialog open={!!credentialDialog} onOpenChange={(open) => !open && setCredentialDialog(null)}>
        <DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>Save credentials now</DialogTitle><DialogDescription>These passwords are shown once and cannot be retrieved later.</DialogDescription></DialogHeader><div className="overflow-x-auto rounded border border-[var(--border)]"><Table><TableHeader><TableRow><TableHead>Participant</TableHead><TableHead>Username</TableHead><TableHead>Password</TableHead></TableRow></TableHeader><TableBody>{credentialDialog?.map((credential) => <TableRow key={credential.participantId}><TableCell>{credential.participantId}</TableCell><TableCell className="font-mono">{credential.username}</TableCell><TableCell className="font-mono">{credential.password}</TableCell></TableRow>)}</TableBody></Table></div><DialogFooter><DialogClose render={<Button>Close</Button>} /></DialogFooter></DialogContent>
      </Dialog>
    </div>}
  </QueryState>;
}
