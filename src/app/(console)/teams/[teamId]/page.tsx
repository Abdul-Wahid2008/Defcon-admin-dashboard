'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { RotateCw, ArrowLeft, CheckCircle2, Copy, ExternalLink, Play, RotateCcw, ShieldAlert, Square, Trash2, UserPlus, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { useAddParticipant, useAudit, useDeleteTeam, useLifecycleAction, useMeta, useParticipants, useRemoveParticipant, useRotateCredentials, useRunHealthChecks, useTeam, useUpdateTeam } from '@/lib/queries';
import type { IssuedCredential } from '@/lib/schemas';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { HealthBadge } from '@/components/status/HealthBadge';
import { FlagstoreDots } from '@/components/status/FlagstoreDots';
import { StateBadge } from '@/components/status/StateBadge';
import { ActivityList, CheckStatus, PageHeader, QueryState, ResourceBars } from '@/components/console/DashboardPrimitives';
import { CredentialsReveal } from '@/components/teams/CredentialsReveal';
import { RelativeTime } from '@/components/ui/relative-time';
import { formatTimestamp } from '@/lib/format';
import { isResetConfirmed, resetCopy } from '@/lib/reset-copy';
import { ResetFields } from '@/components/teams/ResetFields';
import { apiSaveNotes, apiServiceAction } from '@/lib/api-admin';
import { ApiError } from '@/lib/api-client';
import { pushRecentTeam } from '@/lib/recent-teams';
import { useQueryClient } from '@tanstack/react-query';

type ActionKind = 'start' | 'stop' | 'reset';

/**
 * Notes save on blur. The request carries the notes this editor last loaded; if someone else changed them meanwhile the
 * server answers CONFLICT with their text and nothing is overwritten until the organizer chooses.
 */
function NotesCard({ teamId, serverNotes }: { teamId: string; serverNotes: string }) {
  const qc = useQueryClient();
  const [text, setText] = useState(serverNotes);
  const [base, setBase] = useState(serverNotes);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [conflict, setConflict] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Follow changes from other organizers only while this editor has no unsaved edits.
  const [seenServer, setSeenServer] = useState(serverNotes);
  if (serverNotes !== seenServer) {
    setSeenServer(serverNotes); // adjusting state during render, the documented pattern for "props changed"
    if (text === base && conflict === null) { setText(serverNotes); setBase(serverNotes); }
  }

  const save = async (value: string, expected: string) => {
    setState('saving'); setMessage(null);
    try {
      await apiSaveNotes(teamId, value.trim(), expected);
      setBase(value.trim()); setConflict(null); setState('saved');
      setText((current) => (current === value ? value.trim() : current)); // keep anything typed while the request was in flight
      void qc.invalidateQueries({ queryKey: ['team', teamId] });
      void qc.invalidateQueries({ queryKey: ['audit'] });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CONFLICT' && typeof e.details?.currentNotes === 'string') {
        setConflict(e.details.currentNotes); setState('idle');
      } else {
        setState('error'); setMessage((e as Error).message);
      }
    }
  };

  return (
    <Card className="console-surface">
      <CardHeader className="border-b border-[var(--border)]"><CardTitle className="flex items-center justify-between">Notes <span className="text-xs font-normal text-[var(--text-subtle)]" aria-live="polite">{state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : state === 'error' ? 'Not saved' : text !== base ? 'Unsaved, saves when you leave the box' : ''}</span></CardTitle></CardHeader>
      <CardContent className="space-y-2 pt-3">
        <label className="sr-only" htmlFor="team-notes-inline">Team notes</label>
        <textarea id="team-notes-inline" value={text} maxLength={500} onChange={(e) => { setText(e.target.value); setState('idle'); }}
          onBlur={() => { if (text.trim() !== base && conflict === null) void save(text, base); }}
          placeholder="Operational notes, contacts, what was tried" className="min-h-24 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface-inset)] p-2 text-sm" />
        {state === 'error' && <p role="alert" className="text-sm text-[var(--bad)]">{message}</p>}
        {conflict !== null && (
          <div role="alert" className="rounded-lg border border-[var(--warn)]/50 bg-[var(--warn)]/10 p-3 text-sm">
            <p className="font-medium text-[var(--warn)]">Someone else changed these notes.</p>
            <p className="mt-1 whitespace-pre-wrap text-[var(--muted)]">Their version: {conflict || '(empty)'}</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => { setText(conflict); setBase(conflict); setConflict(null); }}>Use their version</Button>
              <Button size="sm" onClick={() => void save(text, conflict)}>Overwrite with mine</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Failing services first: reachability fail, then functional fail, then unknown/stale. */
function serviceRank(service: { stale?: boolean; checks: { type: string; status: string }[] }): number {
  if (service.stale) return 1;
  if (service.checks.some((c) => c.type === 'reachability' && c.status === 'fail')) return 3;
  if (service.checks.some((c) => c.type === 'functional' && c.status === 'fail')) return 2;
  return service.checks.some((c) => c.status === 'unknown') ? 1 : 0;
}

function TeamDetailsForm({
  team,
  onUpdate,
  isUpdating,
  onOpenStatus,
  onOpenDelete,
}: {
  team: { id: string; name: string; notes: string; accountStatus: string; createdAt: string; updatedAt: string };
  onUpdate: (patch: { name?: string }) => void;
  isUpdating: boolean;
  onOpenStatus: () => void;
  onOpenDelete: () => void;
}) {
  const [name, setName] = useState(team.name);

  return (
    <Card className="console-surface">
      <CardHeader className="border-b border-[var(--border)]">
        <CardTitle>Team details</CardTitle>
      </CardHeader>
      <CardContent className="max-w-xl space-y-4 pt-5">
        <label className="block text-sm font-medium" htmlFor="team-name">
          Team name
          <Input
            id="team-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
          />
        </label>
        
        <p className="text-xs text-[var(--muted)]">
          Created {formatTimestamp(team.createdAt)} · Updated {formatTimestamp(team.updatedAt)}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => onUpdate({ name: name.trim() })}
            disabled={!name.trim() || isUpdating || name.trim() === team.name}
          >
            {isUpdating ? 'Saving…' : 'Save details'}
          </Button>
          <Button variant="outline" onClick={onOpenStatus}>
            {team.accountStatus === 'active' ? 'Suspend account' : 'Reactivate account'}
          </Button>
        </div>
        <div className="rounded-lg border border-[var(--bad)]/30 p-4">
          <h3 className="font-medium text-[var(--bad)]">Danger zone</h3>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Archive this team and remove its environment resources. Audit history is kept.
          </p>
          <Button className="mt-3" variant="destructive" onClick={onOpenDelete}>
            Delete team
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

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
  // The API reads the `team` query param (docs/03 §3.7); `teamId` was silently
  // ignored, so the Activity tab previously showed the global log.
  const audit = useAudit({ team: teamId });
  const [tab, setTab] = useState('overview');
  const [showTerminal, setShowTerminal] = useState(false); // the link is not in the DOM until an organizer asks for it
  const [actionDialog, setActionDialog] = useState<ActionKind | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [participantName, setParticipantName] = useState('');
  const [participantDialog, setParticipantDialog] = useState(false);
  const [credentialDialog, setCredentialDialog] = useState<IssuedCredential[] | null>(null);
  const [statusDialog, setStatusDialog] = useState<'active' | 'suspended' | null>(null);
  // startedAt comes from the 202 response; the toast waits until the polled team shows that action finished.
  const [awaitingAction, setAwaitingAction] = useState<{ kind: ActionKind; startedAt: string } | null>(null);
  const team = query.data;
  const metaQuery = useMeta();
  const staleAfter = metaQuery.data?.health.staleAfterSec;
  useEffect(() => { if (team) pushRecentTeam({ id: team.id, name: team.name }); }, [team?.id, team?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  const caps = metaQuery.data?.capabilities;
  const qc = useQueryClient();
  const [resetReason, setResetReason] = useState('');
  const [resetTyped, setResetTyped] = useState('');
  const [serviceDialog, setServiceDialog] = useState<{ key: string; name: string; kind: 'restart' | 'reset' } | null>(null);
  const [svcReason, setSvcReason] = useState('');
  const [svcTyped, setSvcTyped] = useState('');
  const [svcError, setSvcError] = useState<string | null>(null);
  const [svcBusy, setSvcBusy] = useState(false);
  const [awaitingService, setAwaitingService] = useState<{ correlationId: string; label: string } | null>(null);

  useEffect(() => {
    if (!team || !awaitingAction || team.environment.pending) return;
    // A stale cached team (from before the request) has an older lastActionAt: keep waiting for the refetch.
    if (!team.environment.lastActionAt || team.environment.lastActionAt < awaitingAction.startedAt) return;
    if (team.lifecycleState === 'failed') {
      toast.error(`${team.id} ${awaitingAction.kind} failed: ${team.environment.failureReason ?? 'The adapter reported a failure.'}`, { duration: Infinity });
    } else {
      toast.success(`${team.id} ${awaitingAction.kind} complete — ${team.lifecycleState}`);
    }
    window.setTimeout(() => setAwaitingAction(null), 0);
  }, [team, awaitingAction]);

  useEffect(() => {
    if (!team || !awaitingService || team.environment.pending) return;
    const done = team.environment.lastServiceAction;
    if (!done || done.correlationId !== awaitingService.correlationId) return; // wait until the result for THIS request is visible
    if (done.outcome === 'success') toast.success(`${team.id} ${awaitingService.label} complete`);
    else toast.error(`${team.id} ${awaitingService.label} failed: ${done.reason ?? 'The adapter reported a failure.'}`, { duration: Infinity });
    window.setTimeout(() => setAwaitingService(null), 0);
  }, [team, awaitingService]);

  const submitServiceAction = async () => {
    if (!team || !serviceDialog) return;
    setSvcBusy(true);
    setSvcError(null);
    try {
      const res = await apiServiceAction(team.id, serviceDialog.key, serviceDialog.kind, crypto.randomUUID(),
        serviceDialog.kind === 'reset' ? { reason: svcReason.trim(), confirmTeamId: svcTyped } : undefined);
      setAwaitingService({ correlationId: res.correlationId, label: `${serviceDialog.kind} of ${serviceDialog.name}` });
      toast(`${serviceDialog.kind === 'restart' ? 'Restart' : 'Reset'} of ${serviceDialog.name} requested for ${team.id}`);
      setServiceDialog(null);
      void qc.invalidateQueries({ queryKey: ['team', team.id] });
    } catch (e) {
      setSvcError((e as Error).message);
    } finally {
      setSvcBusy(false);
    }
  };

  const actionCopy = useMemo(() => {
    if (!actionDialog) return null;
    if (actionDialog === 'stop') return { title: 'Stop environment?', body: 'The environment will be stopped and its services will be unreachable. The environment is retained and can be started again. Active terminal sessions will end.', button: 'Stop environment' };
    if (actionDialog === 'reset') return resetCopy(caps?.resetKind ?? 'restore_patch', team?.environment.acceptedPatchVersion ?? 1);
    return { title: 'Start environment?', body: 'The retained environment will be started.', button: 'Start environment' };
  }, [actionDialog, team, caps]);

  const serviceActionable = team?.lifecycleState === 'running' && !team.environment.pending;
  const serviceBlockReason = team?.environment.pending ? 'Another action is in progress for this team.' : 'Service actions need a running environment.';
  const resetInfo = resetCopy(caps?.resetKind ?? 'restore_patch', team?.environment.acceptedPatchVersion ?? 1);
  const needsResetConfirmation = actionDialog === 'reset' && resetInfo.requiresConfirmation;

  const submitAction = async () => {
    if (!team || !actionDialog) return;
    try {
      const res = (await action.mutateAsync({
        teamId: team.id, action: actionDialog, idempotencyKey: crypto.randomUUID(),
        confirmation: needsResetConfirmation ? { reason: resetReason.trim(), confirmTeamId: resetTyped } : undefined,
      })) as { transition?: { startedAt: string }; noop?: boolean; reason?: string };
      setActionDialog(null);
      if (res.noop || !res.transition) {
        toast(`${team.id}: ${res.reason ?? 'nothing to do'}`);
        return;
      }
      setAwaitingAction({ kind: actionDialog, startedAt: res.transition.startedAt });
      toast(`${actionDialog.charAt(0).toUpperCase() + actionDialog.slice(1)} requested for ${team.id}`, { icon: <CheckCircle2 size={16} className="text-[var(--accent)]" /> });
    } catch {
      // The error stays visible in the open dialog (action.error).
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
          <Button size="sm" variant="outline" onClick={() => { setResetReason(''); setResetTyped(''); setActionDialog('reset'); }} disabled={!!team.environment.pending || !['running', 'failed'].includes(team.lifecycleState)}><RotateCcw size={14} />Reset</Button>
          <Button size="sm" variant="destructive" onClick={() => { setConfirmName(''); setDeleteOpen(true); }} disabled={!!team.environment.pending || team.lifecycleState === 'deleted'}><Trash2 size={14} />Delete</Button>
        </div>
      </div>

      {team.environment.pending && <div role="status" className="mb-5 flex items-center gap-3 rounded-lg border border-[var(--warn)]/40 bg-[var(--warn)]/10 p-3 text-sm text-[var(--warn)]"><ShieldAlert size={16} /><span><strong>{team.environment.pending.action.replace('service_', 'service ')}{team.environment.pending.serviceKey ? ` (${team.environment.pending.serviceKey})` : ''}</strong> is in progress. The final state will be confirmed by polling.</span></div>}
      {team.environment.failureReason && <div className="mb-5 flex items-start gap-3 rounded-lg border border-[var(--bad)]/40 bg-[var(--bad)]/10 p-3 text-sm text-[var(--bad)]"><ShieldAlert size={17} className="mt-0.5" /><div><strong>Environment needs attention.</strong><p className="mt-1">{team.environment.failureReason}</p></div></div>}

      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-[var(--border)]" role="tablist" aria-label="Team detail sections">{['overview', 'services', 'participants', 'activity', 'settings'].map((name) => <button key={name} role="tab" aria-selected={tab === name} onClick={() => setTab(name)} className={`border-b-2 px-3 py-2.5 text-sm capitalize ${tab === name ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'}`}>{name}</button>)}</div>

      {tab === 'overview' && <div className="grid gap-4 xl:grid-cols-3">
        <Card className="console-surface"><CardHeader className="border-b border-[var(--border)]"><CardTitle>Environment</CardTitle></CardHeader><CardContent className="space-y-3 pt-4 text-sm">
          <div className="flex justify-between"><span className="text-[var(--muted)]">Lifecycle</span><StateBadge state={team.environment.lifecycleState} size="sm" /></div>
          <div className="flex justify-between"><span className="text-[var(--muted)]">Accepted patch</span><span className="font-mono">v{team.environment.acceptedPatchVersion}</span></div>
          <div className="flex justify-between"><span className="text-[var(--muted)]">Last action</span><RelativeTime ts={team.environment.lastActionAt} /></div>
          <div className="flex justify-between"><span className="text-[var(--muted)]">Last health check</span><RelativeTime ts={team.environment.lastHealthCheckAt} /></div>
          {team.environment.lastDeploy && <div className="flex justify-between"><span className="text-[var(--muted)]">Last deploy</span><span className="font-mono text-xs">{team.environment.lastDeploy.result} · v{team.environment.lastDeploy.version}</span></div>}
          {team.environment.terminal?.url ? <div className="border-t border-[var(--border)] pt-3"><div className="mb-1 text-xs text-[var(--muted)]">{team.environment.terminal.isMock ? 'Terminal (simulated placeholder)' : 'Terminal'}: available, {team.environment.terminal.mode === 'per_team' ? 'per team' : 'shared'}, port {team.environment.terminal.port}</div>{showTerminal ? <div className="flex items-center gap-2"><a className="min-w-0 flex-1 break-all font-mono text-xs text-[var(--accent)] hover:underline" href={team.environment.terminal.url} target="_blank" rel="noreferrer noopener">{team.environment.terminal.url}</a><button type="button" className="rounded p-1.5 text-[var(--muted)] hover:bg-[var(--panel-2)] hover:text-[var(--accent)]" aria-label="Copy terminal link" onClick={() => navigator.clipboard.writeText(team.environment.terminal?.url ?? '')}><Copy size={14} /></button><ExternalLink size={13} className="shrink-0 text-[var(--muted)]" aria-hidden="true" /></div> : <Button size="sm" variant="outline" onClick={() => setShowTerminal(true)}>Show terminal link</Button>}</div> : <p className="border-t border-[var(--border)] pt-3 text-xs text-[var(--muted)]">Terminal is not available while this environment is not running.</p>}
        </CardContent></Card>
        <div className="space-y-4 xl:col-span-2"><Card className="console-surface"><CardHeader className="border-b border-[var(--border)]"><CardTitle className="flex items-center justify-between">Services <Button size="sm" variant="outline" onClick={() => setTab('services')}>Open services</Button></CardTitle></CardHeader><CardContent className="pt-3"><ul className="divide-y divide-[var(--border)] text-sm">{team.environment.services.map((service) => { const reach = service.checks.find((c) => c.type === 'reachability'); const functional = service.checks.find((c) => c.type === 'functional'); return <li key={service.key} className="flex flex-wrap items-center justify-between gap-2 py-2"><span className="font-medium">{service.name}</span><span className="flex items-center gap-3"><FlagstoreDots flagstores={service.flagstores} stale={service.stale} /><CheckStatus status={reach?.status ?? 'unknown'} detail={reach?.detail} /><CheckStatus status={functional?.status ?? 'unknown'} detail={functional?.detail} /></span></li>; })}</ul></CardContent></Card><Card className="console-surface"><CardHeader className="border-b border-[var(--border)]"><CardTitle className="flex items-center justify-between">Resource usage <span className="text-xs font-normal text-[var(--muted)]">{team.environment.resources?.isMock ? 'Simulated values' : 'Runtime values'}</span></CardTitle></CardHeader><CardContent className="pt-4"><ResourceBars resources={team.environment.resources} /></CardContent></Card><NotesCard teamId={team.id} serverNotes={team.notes} /></div>
      </div>}

      {tab === 'services' && <div><Card className="console-surface"><CardHeader className="border-b border-[var(--border)]"><CardTitle className="flex items-center justify-between">Services <Button size="sm" variant="outline" onClick={() => health.mutate(team.id)} disabled={health.isPending || team.lifecycleState !== 'running'}>{health.isPending ? 'Checking…' : 'Run check now'}</Button></CardTitle></CardHeader><CardContent className="overflow-x-auto pt-4"><Table className="text-[13px] [&_td]:px-2 [&_th]:px-2"><TableHeader><TableRow><TableHead>Service</TableHead><TableHead>Reachability</TableHead><TableHead>Functional</TableHead><TableHead>Flagstores</TableHead><TableHead>Detail</TableHead><TableHead>Last checked</TableHead>{caps?.serviceLevelReset && <TableHead>Actions</TableHead>}</TableRow></TableHeader><TableBody>{[...team.environment.services].sort((a, b) => serviceRank(b) - serviceRank(a)).map((service) => { const reach = service.checks.find((c) => c.type === 'reachability'); const functional = service.checks.find((c) => c.type === 'functional'); const failing = reach?.status === 'fail' || functional?.status === 'fail'; return <TableRow key={service.key} className={failing ? 'bg-[var(--bad)]/5' : undefined}><TableCell className="max-w-[200px] whitespace-normal"><div className="font-medium">{service.name}</div><div className="font-mono text-xs text-[var(--muted)]">:{service.port}{service.placeholder ? ' · placeholder' : ''}</div></TableCell><TableCell><CheckStatus status={reach?.status ?? 'unknown'} detail={reach?.detail} /></TableCell><TableCell><CheckStatus status={functional?.status ?? 'unknown'} detail={functional?.detail} /></TableCell><TableCell><FlagstoreDots flagstores={service.flagstores} stale={service.stale} />{service.stale && <div className="mt-1 text-xs text-[var(--warn)]">Stale (over {staleAfter ?? 270} s)</div>}</TableCell><TableCell className="max-w-[140px] truncate text-xs text-[var(--muted)]" title={reach?.detail ?? functional?.detail ?? ''}>{reach?.detail ?? functional?.detail ?? 'No checker detail'}</TableCell><TableCell><RelativeTime ts={reach?.lastCheckedAt ?? functional?.lastCheckedAt} /></TableCell>{caps?.serviceLevelReset && <TableCell><div className="flex gap-1"><Button size="sm" variant="ghost" disabled={!serviceActionable} title={serviceActionable ? undefined : serviceBlockReason} onClick={() => { setSvcError(null); setServiceDialog({ key: service.key, name: service.name, kind: 'restart' }); }}><RotateCw size={13} />Restart</Button><Button size="sm" variant="ghost" disabled={!serviceActionable} title={serviceActionable ? undefined : serviceBlockReason} onClick={() => { setSvcError(null); setSvcReason(''); setSvcTyped(''); setServiceDialog({ key: service.key, name: service.name, kind: 'reset' }); }}><RotateCcw size={13} />Reset</Button></div></TableCell>}</TableRow>; })}</TableBody></Table></CardContent></Card></div>}
      {tab === 'participants' && <Card className="console-surface"><CardHeader className="flex-row items-center justify-between border-b border-[var(--border)]"><CardTitle>Participants</CardTitle><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => rotateCredentials()} disabled={rotate.isPending || !participants.data?.length}><KeyRound size={14} />Rotate all</Button><Button size="sm" onClick={() => setParticipantDialog(true)} disabled={(participants.data?.length ?? 0) >= 8}><UserPlus size={14} />Add participant</Button></div></CardHeader><CardContent className="overflow-x-auto pt-4">{participants.data?.length ? <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Username</TableHead><TableHead>Credential</TableHead><TableHead>Status</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader><TableBody>{participants.data.map((person) => <TableRow key={person.id}><TableCell>{person.name}</TableCell><TableCell className="font-mono text-xs">{person.username} <button aria-label={`Copy ${person.username}`} className="ml-1 rounded p-1 text-[var(--muted)] hover:text-[var(--accent)]" onClick={() => navigator.clipboard.writeText(person.username)}><Copy size={12} className="inline" /></button></TableCell><TableCell>v{person.credentialVersion} · <RelativeTime ts={person.credentialIssuedAt} /></TableCell><TableCell><span className={person.active ? 'text-[var(--ok)]' : 'text-[var(--muted)]'}>{person.active ? 'Active' : 'Inactive'}</span></TableCell><TableCell><div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => rotateCredentials(person.id)} disabled={rotate.isPending}>Rotate</Button><Button size="sm" variant="ghost" onClick={() => remove.mutate({ teamId: team.id, participantId: person.id })} disabled={remove.isPending}>Remove</Button></div></TableCell></TableRow>)}</TableBody></Table> : <p className="py-8 text-center text-sm text-[var(--muted)]">No participants have been issued credentials.</p>}</CardContent></Card>}
      {tab === 'activity' && <Card className="console-surface"><CardHeader className="border-b border-[var(--border)]"><CardTitle>Activity</CardTitle></CardHeader><CardContent className="pt-2"><ActivityList entries={audit.data?.items ?? []} /></CardContent></Card>}
      {tab === 'settings' && <TeamDetailsForm
        key={team.id}
        team={team}
        onUpdate={(patch) => update.mutate({ teamId: team.id, patch }, { onSuccess: () => toast.success('Team details updated') })}
        isUpdating={update.isPending}
        onOpenStatus={() => setStatusDialog(team.accountStatus === 'active' ? 'suspended' : 'active')}
        onOpenDelete={() => setDeleteOpen(true)}
      />}

      <Dialog open={!!actionDialog} onOpenChange={(open) => !open && setActionDialog(null)}>
        <DialogContent><DialogHeader><DialogTitle>{actionCopy?.title}</DialogTitle><DialogDescription>{actionCopy?.body}</DialogDescription></DialogHeader>{needsResetConfirmation && <ResetFields idPrefix="env-reset" teamId={team.id} reason={resetReason} typedTeamId={resetTyped} onReason={setResetReason} onTypedTeamId={setResetTyped} />}{action.error && <p role="alert" className="text-sm text-[var(--bad)]">{action.error.message}</p>}<DialogFooter><DialogClose render={<Button variant="outline" />}>Cancel</DialogClose><Button onClick={submitAction} disabled={action.isPending || (actionDialog === 'reset' && !isResetConfirmed(resetInfo, resetReason, resetTyped, team.id))}>{action.isPending ? 'Working…' : actionCopy?.button}</Button></DialogFooter></DialogContent>
      </Dialog>
      <Dialog open={!!serviceDialog} onOpenChange={(open) => !open && setServiceDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{serviceDialog?.kind === 'restart' ? `Restart ${serviceDialog?.name}?` : `Reset ${serviceDialog?.name}?`}</DialogTitle>
            <DialogDescription>{serviceDialog?.kind === 'restart'
              ? 'Restarts only this service for this team. The service is unreachable while it restarts and the team may lose SLA points for the rounds it is down.'
              : 'Resets only this service for this team. Service data and player changes may be erased and the team may lose SLA points. Other services and game-server flags and scores are not touched.'}</DialogDescription>
          </DialogHeader>
          {serviceDialog?.kind === 'reset' && <ResetFields idPrefix="svc-reset" teamId={team.id} reason={svcReason} typedTeamId={svcTyped} onReason={setSvcReason} onTypedTeamId={setSvcTyped} />}
          {svcError && <p role="alert" className="text-sm text-[var(--bad)]">{svcError}</p>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button onClick={submitServiceAction} disabled={svcBusy || (serviceDialog?.kind === 'reset' && (svcReason.trim().length < 10 || svcTyped !== team.id))}>{svcBusy ? 'Working…' : serviceDialog?.kind === 'restart' ? 'Restart service' : 'Reset service'}</Button>
          </DialogFooter>
        </DialogContent>
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
      {credentialDialog && (
        <CredentialsReveal
          credentials={credentialDialog}
          onClose={() => setCredentialDialog(null)}
        />
      )}
    </div>}
  </QueryState>;
}
