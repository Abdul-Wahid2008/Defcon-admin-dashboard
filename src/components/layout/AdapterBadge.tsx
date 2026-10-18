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
  mock: {
    label: 'SIMULATED',
    icon: FlaskConical,
    className: 'text-[var(--warn)] border-[var(--warn)] bg-[var(--warn)]/10',
    tooltip: 'Data and actions are simulated by the built-in mock backend. No real containers are controlled.',
  },
  real: {
    label: 'LIVE',
    icon: Radio,
    className: 'text-[var(--ok)] border-[var(--ok)] bg-[var(--ok)]/10',
    tooltip: 'Connected to the DEFCON orchestrator.',
  },
  'docker-compose': {
    label: 'PARTIAL',
    icon: CircleDashed,
    className: 'text-[var(--warn)] border-[var(--warn)] bg-[var(--warn)]/10',
    tooltip: 'Partial real control via docker-compose. Start/stop/delete and reachability are real. Patch restore and functional checks are not.',
  },
} as const;

export function AdapterBadge() {
  const { data } = useMeta();
  const adapter = data?.adapter ?? 'mock';
  const config = BADGE_CONFIG[adapter] ?? BADGE_CONFIG.mock;
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
            aria-label={`Adapter mode: ${config.label}`}
          >
            <Icon size={12} aria-hidden="true" />
            {config.label}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-xs">
          {config.tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
