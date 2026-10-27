'use client';

import { Snowflake } from 'lucide-react';
import { useMeta } from '@/lib/queries';

export function FrozenBanner() {
  const { data } = useMeta();
  if (!data?.frozen) return null;
  return (
    <div role="alert" className="flex items-center gap-2 border-b border-[var(--bad)]/40 bg-[var(--bad)]/10 px-4 py-2 text-xs text-[var(--bad)]">
      <Snowflake size={13} aria-hidden="true" />
      <span><strong>Mutations are frozen.</strong> Start, stop, reset, team edits and credential changes are refused. Reads and the audit log still work. An administrator can unfreeze in Settings.</span>
    </div>
  );
}
