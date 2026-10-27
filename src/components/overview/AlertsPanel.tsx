'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertCircle, BellOff } from 'lucide-react';
import type { Alert } from '@/lib/schemas';
import { apiAckAlert } from '@/lib/api-admin';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RelativeTime } from '@/components/ui/relative-time';

const tone = (a: Alert) =>
  a.resolvedAt ? 'text-[var(--idle)]' : a.severity === 'critical' ? 'text-[var(--bad)]' : a.severity === 'warning' ? 'text-[var(--warn)]' : 'text-[var(--text-subtle)]';

export function AlertsPanel({ alerts }: { alerts: Alert[] }) {
  const qc = useQueryClient();
  const [target, setTarget] = useState<Alert | null>(null);
  const [note, setNote] = useState('');
  const ack = useMutation({
    mutationFn: (resolve: boolean) => apiAckAlert(target!.id, { note: note.trim() || undefined, resolve }),
    onSuccess: (r) => {
      if (r.status === 'resolved') toast.success('Alert resolved');
      else if (r.status === 'acknowledged') toast.success('Alert acknowledged');
      else toast(r.status === 'already_resolved' ? 'Already resolved by a health update; nothing changed' : 'Already acknowledged; nothing changed');
      setTarget(null); setNote('');
      void qc.invalidateQueries({ queryKey: ['overview'] });
      void qc.invalidateQueries({ queryKey: ['alerts'] });
      void qc.invalidateQueries({ queryKey: ['audit'] });
    },
  });
  if (!alerts.length) return <p className="py-6 text-sm text-[var(--muted)]">No open alerts.</p>;
  return (
    <>
      <ul className="divide-y divide-[var(--border)]">
        {alerts.map((alert) => (
          <li key={alert.id} className="flex gap-3 py-2.5">
            <AlertCircle size={16} className={`mt-0.5 shrink-0 ${tone(alert)}`} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="text-sm">{alert.message}{alert.resolvedAt && <span className="ml-2 text-xs text-[var(--text-subtle)]">resolved</span>}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[var(--text-subtle)]">
                {alert.teamId ? <Link className="font-mono text-[var(--accent)] hover:underline" href={`/teams/${alert.teamId}`}>{alert.teamId}</Link> : 'System'}
                <span aria-hidden="true">·</span><RelativeTime ts={alert.createdAt} />
                {alert.ackedAt && !alert.resolvedAt && <span className="inline-flex items-center gap-1 text-[var(--text-subtle)]"><BellOff size={11} aria-hidden="true" />acknowledged by {alert.ackedBy ?? 'an organizer'}{alert.ackNote ? `: ${alert.ackNote}` : ''}</span>}
              </div>
            </div>
            {!alert.resolvedAt && (
              <Button size="sm" variant="ghost" onClick={() => { setNote(''); setTarget(alert); }}>{alert.ackedAt ? 'Resolve' : 'Acknowledge'}</Button>
            )}
          </li>
        ))}
      </ul>

      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{target?.ackedAt ? 'Resolve alert?' : 'Acknowledge alert?'}</DialogTitle>
            <DialogDescription>
              Acknowledging keeps the alert open and removes it from the unacknowledged count; repeats of the same failure do not create a new alert.
              Resolving closes it by hand; if the failure is still present when the next health result arrives, a new alert opens (with simulated health, results never arrive, so it stays closed). Either action is recorded in the audit log.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm">{target?.message}</p>
          <label className="grid gap-1 text-sm font-medium" htmlFor="ack-note">
            <span>Note (optional, up to 300 characters)</span>
            <textarea id="ack-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className="min-h-16 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-inset)] p-2 text-sm" />
          </label>
          {ack.error && <p role="alert" className="text-sm text-[var(--bad)]">{ack.error.message}</p>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            {!target?.ackedAt && <Button variant="outline" disabled={ack.isPending} onClick={() => ack.mutate(false)}>Acknowledge</Button>}
            <Button disabled={ack.isPending} onClick={() => ack.mutate(true)}>{ack.isPending ? 'Saving…' : 'Resolve'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
