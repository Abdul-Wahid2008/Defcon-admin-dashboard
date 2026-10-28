'use client';

import { Snowflake } from 'lucide-react';
import { useMeta } from '@/lib/queries';

export function FrozenBanner() {
  const { data } = useMeta();
  if (!data?.frozen) return null;
  return (
    <div role="alert" className="border-b border-[var(--bad)]/40 text-xs text-[var(--bad)]" style={{ background: 'color-mix(in srgb, var(--bad) 10%, var(--bg))' }}>
      <div className="page-container flex items-center gap-2 py-2" data-qa="banner-inner">
      <Snowflake size={16} aria-hidden="true" />
      <span><strong>Mutations are frozen.</strong> Start, stop, reset, team edits and credential changes are refused. Reads and the audit log still work. An administrator can unfreeze in Settings.</span>
      </div>
    </div>
  );
}
