'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FlaskConical, Info, Save, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { useDemoFailNext, useDemoInject, useDemoReseed, useMeta, useSettings, useTeam, useTeams, useUpdateSettings } from '@/lib/queries';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader, QueryState } from '@/components/console/DashboardPrimitives';
import { Input } from '@/components/ui/input';
import { apiMe } from '@/lib/api-client';
import { apiSetFrozen } from '@/lib/api-admin';
import { OrganizerAccounts } from '@/components/settings/OrganizerAccounts';

const STATUS_OPTIONS = [
  ['not_started', 'Not started'],
  ['running', 'Running'],
  ['paused', 'Paused'],
  ['ended', 'Ended'],
] as const;

export default function SettingsPage() {
  const meta = useMeta();
  const settings = useSettings();
  const update = useUpdateSettings();
  const teams = useTeams({ pageSize: 100 });
  const [demoTeamId, setDemoTeamId] = useState('');
  const selectedTeam = useTeam(demoTeamId || undefined);
  const demoInject = useDemoInject();
  const demoFailNext = useDemoFailNext();
  const demoReseed = useDemoReseed();
  const [demoAction, setDemoAction] = useState('reset');
  const [demoCheck, setDemoCheck] = useState<'reachability' | 'functional'>('reachability');
  const [status, setStatus] = useState<string | null>(null);
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: apiMe, staleTime: 60_000 });
  const isAdmin = me.data?.user.role === 'organizer_admin';
  const [freezeText, setFreezeText] = useState('');
  const freeze = useMutation({
    mutationFn: (frozen: boolean) => apiSetFrozen(frozen, frozen ? freezeText : undefined),
    onSuccess: (r) => { setFreezeText(''); toast.success(r.frozen ? 'Mutations frozen' : 'Mutations unfrozen'); void qc.invalidateQueries({ queryKey: ['meta'] }); },
  });
  const selectedStatus = status ?? settings.data?.competitionStatus ?? 'not_started';

  return (
    <QueryState loading={meta.isLoading || settings.isLoading} error={meta.error ?? settings.error} onRetry={() => { void meta.refetch(); void settings.refetch(); }}>
      {meta.data && settings.data && (
        <div>
          <PageHeader title="Settings" description="Runtime context and the small set of organizer-facing controls." />
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
            <Card className="console-surface">
              <CardHeader className="border-b border-[var(--border)]">
                <CardTitle className="flex items-center gap-2"><Settings2 size={17} className="text-[var(--accent)]" />Competition display status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5 pt-5">
                <div>
                  <label htmlFor="competition-status" className="text-sm font-medium">Status shown to organizers</label>
                  <p className="mt-1 max-w-xl text-sm text-[var(--muted)]">This is a dashboard label only. It does not start or stop environments and is recorded in the append-only audit log.</p>
                  <select id="competition-status" value={selectedStatus} onChange={(event) => setStatus(event.target.value)} className="mt-3 h-10 w-full max-w-sm rounded-lg border border-[var(--border-strong)] bg-[var(--surface-inset)] px-3 text-sm text-[var(--text)] focus:border-[var(--accent)] focus:outline-none">
                    {STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
                {update.error && <p role="alert" className="rounded-lg border border-[var(--bad)]/40 bg-[var(--bad)]/10 p-3 text-sm text-[var(--bad)]">{update.error.message}</p>}
                <div className="flex items-center gap-3">
                  <Button disabled={update.isPending || selectedStatus === settings.data.competitionStatus} onClick={() => update.mutate({ competitionStatus: selectedStatus }, { onSuccess: () => { setStatus(null); toast.success('Competition status saved'); } })}><Save size={15} />{update.isPending ? 'Saving…' : 'Save status'}</Button>
                  {selectedStatus === settings.data.competitionStatus && <span className="flex items-center gap-1.5 text-xs text-[var(--ok)]"><CheckCircle2 size={14} />Saved</span>}
                </div>
              </CardContent>
            </Card>

            <div className="space-y-4">
              {isAdmin && <Card className="console-surface">
                <CardHeader className="border-b border-[var(--border)]"><CardTitle>Mutation freeze</CardTitle></CardHeader>
                <CardContent className="space-y-3 pt-4 text-sm">
                  <p className="text-[var(--muted)]">{meta.data.frozen ? 'Mutations are frozen. Team edits, start, stop, reset, credential changes and settings are refused. Reads and the audit log still work.' : 'While frozen, every change is refused with MUTATIONS_FROZEN. Use it for the last minutes of the event or during an incident.'}</p>
                  {meta.data.frozen ? (
                    <Button variant="outline" disabled={freeze.isPending} onClick={() => freeze.mutate(false)}>{freeze.isPending ? 'Unfreezing…' : 'Unfreeze mutations'}</Button>
                  ) : (
                    <div className="flex items-end gap-2">
                      <label className="grid flex-1 gap-1 text-xs font-medium" htmlFor="freeze-confirm">Type FREEZE to confirm<Input id="freeze-confirm" value={freezeText} onChange={(e) => setFreezeText(e.target.value)} autoComplete="off" /></label>
                      <Button variant="destructive" disabled={freezeText !== 'FREEZE' || freeze.isPending} onClick={() => freeze.mutate(true)}>{freeze.isPending ? 'Freezing…' : 'Freeze mutations'}</Button>
                    </div>
                  )}
                  {freeze.error && <p role="alert" className="text-[var(--bad)]">{freeze.error.message}</p>}
                </CardContent>
              </Card>}
              <Card className="console-surface">
                <CardHeader className="border-b border-[var(--border)]"><CardTitle className="flex items-center gap-2"><Info size={17} className="text-[var(--accent)]" />Runtime metadata</CardTitle></CardHeader>
                <CardContent className="space-y-3 pt-4 text-sm">
                  <div className="flex items-center justify-between gap-4"><span className="text-[var(--muted)]">Adapter</span><span className="font-mono text-[var(--warn)]">{meta.data.adapter}</span></div>
                  <div className="flex items-center justify-between gap-4"><span className="text-[var(--muted)]">Console version</span><span className="font-mono">{meta.data.version}</span></div>
                  <div className="flex items-center justify-between gap-4"><span className="text-[var(--muted)]">Soft team cap</span><span className="font-mono">{meta.data.limits.softTeamCap}</span></div>
                </CardContent>
              </Card>
              <Card className="console-surface border-amber-300/30">
                <CardHeader className="border-b border-amber-300/20"><CardTitle className="flex items-center gap-2 text-[var(--warn)]"><FlaskConical size={17} />Simulation boundary</CardTitle></CardHeader>
                <CardContent className="pt-4 text-sm leading-6 text-[var(--muted)]">The default SQLite adapter is deliberately simulated. Actions update demo state and never control real containers. Docker Compose, when explicitly selected, remains a partial adapter and is never reported as live.</CardContent>
              </Card>
              {meta.data.demoControls && <Card className="console-surface border-amber-300/30">
                <CardHeader className="border-b border-amber-300/20"><CardTitle className="flex items-center gap-2 text-[var(--warn)]"><FlaskConical size={17} />Demo controls</CardTitle></CardHeader>
                <CardContent className="space-y-3 pt-4 text-sm">
                  <p className="text-[var(--muted)]">Simulation only. Every demo action is audited and never controls real containers.</p>
                  <select aria-label="Demo team" value={demoTeamId} onChange={(event) => setDemoTeamId(event.target.value)} className="h-8 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface-inset)] px-2 text-sm"><option value="">Choose a team</option>{teams.data?.items.map((team) => <option key={team.id} value={team.id}>{team.id} · {team.name}</option>)}</select>
                  <div className="grid grid-cols-2 gap-2"><select aria-label="Demo check type" value={demoCheck} onChange={(event) => setDemoCheck(event.target.value as 'reachability' | 'functional')} className="h-8 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-inset)] px-2 text-sm"><option value="reachability">Reachability</option><option value="functional">Functional</option></select><select aria-label="Demo service" disabled={!selectedTeam.data} className="h-8 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-inset)] px-2 text-sm" onChange={(event) => { if (demoTeamId) demoInject.mutate({ teamId: demoTeamId, serviceKey: event.target.value, checkType: demoCheck, mode: 'fail', detail: 'Forced demo failure' }); }}><option value="">Inject failure…</option>{selectedTeam.data?.environment.services.map((service) => <option key={service.key} value={service.key}>{service.name}</option>)}</select></div>
                  <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!demoTeamId || demoFailNext.isPending} onClick={() => demoFailNext.mutate({ teamId: demoTeamId, action: demoAction })}>Make next {demoAction} fail</Button><select aria-label="Demo failure action" value={demoAction} onChange={(event) => setDemoAction(event.target.value)} className="h-8 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-inset)] px-2 text-sm"><option value="start">start</option><option value="stop">stop</option><option value="reset">reset</option><option value="provision">provision</option></select><Button size="sm" variant="destructive" disabled={demoReseed.isPending} onClick={() => { if (window.confirm('Reseed demo data? This clears mock data but keeps the audit log.')) demoReseed.mutate(); }}>Reseed demo</Button></div>
                  {demoInject.error && <p role="alert" className="text-[var(--bad)]">{demoInject.error.message}</p>}
                </CardContent>
              </Card>}
            </div>
          </div>
          {isAdmin && <div className="mt-4 grid gap-4 lg:grid-cols-2"><OrganizerAccounts currentUserId={me.data?.user.id} /></div>}
        </div>
      )}
    </QueryState>
  );
}
