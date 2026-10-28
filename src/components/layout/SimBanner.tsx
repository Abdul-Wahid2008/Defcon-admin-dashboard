'use client';

import { useState } from 'react';
import { X, FlaskConical } from 'lucide-react';
import { useMeta } from '@/lib/queries';
import { RelativeTime } from '@/components/ui/relative-time';
import { describeSourceError } from '@/components/status/SourceFreshness';

export function SimBanner() {
  const { data } = useMeta();
  const [dismissed, setDismissed] = useState(false);

  // Reserve the banner's height while the meta request is in flight so the page does not jump when it arrives.
  if (!data && !dismissed) return <div aria-hidden="true" className="h-[37px] border-b border-transparent" />;
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
      className="border-b text-xs"
      style={{
        background: 'color-mix(in srgb, var(--warn) 8%, var(--bg))',
        borderColor: 'rgba(245,158,11,0.3)',
        color: 'var(--warn)',
      }}
    >
      <div className="page-container flex items-center justify-between gap-4 py-2" data-qa="banner-inner">
        <span className="flex min-w-0 items-center gap-2">
          <FlaskConical size={16} className="shrink-0" aria-hidden="true" />
          <span>Health: {healthText} · Lifecycle: {lifecycle}.{sources.lifecycle === 'mock' && ' Start, stop and reset change demo data only.'}</span>
        </span>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss data source banner"
          className="shrink-0 rounded p-0.5 hover:bg-[var(--warn)]/20 transition-colors"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
