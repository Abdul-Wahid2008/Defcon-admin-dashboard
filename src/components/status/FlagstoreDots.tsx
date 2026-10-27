import { Check, CircleHelp, TriangleAlert, Wrench, X, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FlagstoreResult } from '@/lib/schemas';

const VERDICT: Record<FlagstoreResult['verdict'], { label: string; Icon: LucideIcon; color: string }> = {
  OK: { label: 'OK', Icon: Check, color: 'text-[var(--ok)] border-[var(--ok)]/40' },
  MUMBLE: { label: 'MUMBLE', Icon: TriangleAlert, color: 'text-[var(--warn)] border-[var(--warn)]/40' },
  OFFLINE: { label: 'OFFLINE', Icon: X, color: 'text-[var(--bad)] border-[var(--bad)]/40' },
  INTERNAL_ERROR: { label: 'INTERNAL_ERROR', Icon: Wrench, color: 'text-[var(--idle)] border-[var(--idle)]/40' },
  UNKNOWN: { label: 'UNKNOWN', Icon: CircleHelp, color: 'text-[var(--idle)] border-[var(--idle)]/40' },
};

/** Three flagstore verdicts as icon + short label. A stale service shows every flagstore as unknown, never green. */
export function FlagstoreDots({ flagstores, stale }: { flagstores: FlagstoreResult[] | undefined; stale?: boolean }) {
  if (!flagstores?.length) return <span className="text-xs text-[var(--muted)]">No flagstore data</span>;
  return (
    <span className="inline-flex items-center gap-1" role="list" aria-label="Flagstore verdicts">
      {flagstores.map((f) => {
        const v = VERDICT[stale ? 'UNKNOWN' : f.verdict];
        const text = `${f.key}: ${stale ? 'stale (last ' + f.verdict + ')' : f.verdict}${f.message ? ` — ${f.message}` : ''}${f.round !== null ? ` · round ${f.round}` : ''}`;
        return (
          <span key={f.key} role="listitem" title={text} aria-label={text}
            className={cn('inline-flex items-center gap-0.5 rounded border px-1 py-0.5 font-mono text-[11px] leading-none', v.color)}>
            <v.Icon size={10} aria-hidden="true" />
            {f.key.replace('flag', 'F')}
          </span>
        );
      })}
    </span>
  );
}
