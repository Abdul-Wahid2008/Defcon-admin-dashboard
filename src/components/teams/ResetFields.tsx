import { Input } from '@/components/ui/input';
import { MIN_REASON_CHARS } from '@/lib/reset-copy';

/** Reason + typed team id, shown when a reset or service reset needs explicit confirmation. */
export function ResetFields({
  teamId,
  reason,
  typedTeamId,
  onReason,
  onTypedTeamId,
  idPrefix,
}: {
  teamId: string;
  reason: string;
  typedTeamId: string;
  onReason: (v: string) => void;
  onTypedTeamId: (v: string) => void;
  idPrefix: string;
}) {
  return (
    <div className="grid gap-3">
      <label className="grid gap-1 text-sm font-medium" htmlFor={`${idPrefix}-reason`}>
        <span>Reason (at least {MIN_REASON_CHARS} characters, recorded in the audit log)</span>
        <textarea
          id={`${idPrefix}-reason`}
          value={reason}
          onChange={(e) => onReason(e.target.value)}
          maxLength={500}
          className="min-h-20 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-inset)] p-2 text-sm"
        />
      </label>
      <label className="grid gap-1 text-sm font-medium" htmlFor={`${idPrefix}-team`}>
        <span>Type <strong className="font-mono">{teamId}</strong> to confirm</span>
        <Input className="border-[var(--border-strong)] bg-[var(--surface-inset)]" id={`${idPrefix}-team`} value={typedTeamId} onChange={(e) => onTypedTeamId(e.target.value)} autoComplete="off" />
      </label>
    </div>
  );
}
