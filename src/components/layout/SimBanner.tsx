'use client';

import { useState } from 'react';
import { X, FlaskConical } from 'lucide-react';
import { useMeta } from '@/lib/queries';

export function SimBanner() {
  const { data } = useMeta();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || !data || data.adapter !== 'mock') return null;

  return (
    <div
      role="banner"
      className="flex items-center justify-between gap-4 px-4 py-2 text-xs border-b"
      style={{
        background: 'rgba(245,158,11,0.08)',
        borderColor: 'rgba(245,158,11,0.3)',
        color: 'var(--warn)',
      }}
    >
      <span className="flex items-center gap-2">
        <FlaskConical size={12} aria-hidden="true" />
        <strong>Simulation mode</strong>
        {' — '}
        actions change demo data only. No real containers are controlled.
      </span>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss simulation banner"
        className="shrink-0 rounded p-0.5 hover:bg-[var(--warn)]/20 transition-colors"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
