'use client';

import { useState } from 'react';
import { X, FlaskConical } from 'lucide-react';
import { useMeta } from '@/lib/queries';
import { RelativeTime } from '@/components/ui/relative-time';
import { describeSourceError } from '@/components/status/SourceFreshness';

export function SimBanner() {
  const { data } = useMeta();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || !data || data.badge === 'LIVE') return null;

  const { health, sources } = data;
  const lifecycle = sources.lifecycle === 'mock' ? 'simulated' : sources.lifecycle === 'docker-compose' ? 'partly real (docker-compose)' : 'real';
  const healthText = sources.health === 'mock'
    ? 'simulated'
    : health.state === 'ok'
      ? <>live ({sources.health}{health.lastRound !== null ? `, round ${health.lastRound}` : ''}, updated <RelativeTime ts={health.lastOkAt} />)</>
      : <>{sources.health}: {health.state === 'error' ? `error, ${describeSourceError(health.lastError)}` : health.state}</>;

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
        <span>Health: {healthText} · Lifecycle: {lifecycle}.{sources.lifecycle === 'mock' && ' Start, stop and reset change demo data only.'}</span>
      </span>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss data source banner"
        className="shrink-0 rounded p-0.5 hover:bg-[var(--warn)]/20 transition-colors"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
