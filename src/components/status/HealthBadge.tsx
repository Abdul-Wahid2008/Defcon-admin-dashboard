'use client';

import { ShieldCheck, TriangleAlert, ShieldX, CircleHelp, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type Health = 'healthy' | 'degraded' | 'down' | 'unknown';

const HEALTH_CONFIG: Record<Health, {
  label: string;
  icon: LucideIcon;
  color: string;
}> = {
  healthy:  { label: 'Healthy',  icon: ShieldCheck,    color: 'text-[var(--ok)] border-[var(--ok)]/30 bg-[var(--ok)]/10' },
  degraded: { label: 'Degraded', icon: TriangleAlert,  color: 'text-[var(--warn)] border-[var(--warn)]/30 bg-[var(--warn)]/10' },
  down:     { label: 'Down',     icon: ShieldX,        color: 'text-[var(--bad)] border-[var(--bad)]/30 bg-[var(--bad)]/10' },
  unknown:  { label: 'Unknown',  icon: CircleHelp,     color: 'text-[var(--idle)] border-[var(--idle)]/30 bg-[var(--idle)]/10' },
};

interface HealthBadgeProps {
  health: Health;
  size?: 'sm' | 'md';
}

export function HealthBadge({ health, size = 'md' }: HealthBadgeProps) {
  const config = HEALTH_CONFIG[health] ?? HEALTH_CONFIG.unknown;
  const Icon = config.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border font-medium',
        size === 'sm' ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-1 text-xs',
        config.color,
      )}
      aria-label={`Health: ${config.label}`}
    >
      <Icon size={16} aria-hidden="true" />
      {config.label}
    </span>
  );
}
