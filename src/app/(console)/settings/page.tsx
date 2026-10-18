'use client';

import { useState } from 'react';
import { CheckCircle2, FlaskConical, Info, Save, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { useMeta, useSettings, useUpdateSettings } from '@/lib/queries';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader, QueryState } from '@/components/console/DashboardPrimitives';

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
  const [status, setStatus] = useState<string | null>(null);
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
            </div>
          </div>
        </div>
      )}
    </QueryState>
  );
}
