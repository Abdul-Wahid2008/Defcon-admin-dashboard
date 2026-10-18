'use client';

import { useEffect, useState } from 'react';
import { formatTimestamp } from '@/lib/format';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface RelativeTimeProps {
  ts: string | null | undefined;
  className?: string;
}

export function RelativeTime({ ts, className }: RelativeTimeProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!ts) return <span className={className}>—</span>;

  const label = formatRelativeTimeAt(ts, now);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>
          <time dateTime={ts} className={className}>
            {label}
          </time>
        </TooltipTrigger>
        <TooltipContent>
          <span className="font-mono text-xs">{formatTimestamp(ts)}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function formatRelativeTimeAt(isoString: string, now: number): string {
  const then = new Date(isoString).getTime();
  const diffSec = Math.floor((now - then) / 1000);

  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}
