'use client';

import { FlaskConical, Radio, CircleDashed } from 'lucide-react';
import { useMeta } from '@/lib/queries';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

const BADGE_CONFIG = {
  SIMULATED: {
    icon: FlaskConical,
    className: 'text-[var(--warn)] border-[var(--warn)] bg-[var(--warn)]/10',
    tooltip: 'Health data and lifecycle actions are both simulated by the built-in mock backend. No real containers are controlled.',
  },
  PARTIAL: {
    icon: CircleDashed,
    className: 'text-[var(--warn)] border-[var(--warn)] bg-[var(--warn)]/10',
    tooltip: 'Mixed: at least one source is real and at least one is simulated. See the banner for which.',
  },
  LIVE: {
    icon: Radio,
    className: 'text-[var(--ok)] border-[var(--ok)] bg-[var(--ok)]/10',
    tooltip: 'Health and lifecycle are both real.',
  },
} as const;

export function AdapterBadge() {
  const { data } = useMeta();
  const badge = data?.badge ?? 'SIMULATED';
  const config = BADGE_CONFIG[badge];
  const Icon = config.icon;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs font-mono font-semibold cursor-default select-none',
              config.className,
            )}
            aria-label={`Data mode: ${badge}`}
          >
            <Icon size={16} aria-hidden="true" />
            {badge}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-xs">
          {config.tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
