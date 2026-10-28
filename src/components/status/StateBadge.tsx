'use client';

import {
  CircleCheck, Square, LoaderCircle, OctagonAlert, Trash2,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type LifecycleState =
  | 'provisioning' | 'running' | 'stopping' | 'stopped'
  | 'starting' | 'resetting' | 'deleting' | 'deleted' | 'failed';

const STATE_CONFIG: Record<LifecycleState, {
  label: string;
  icon: LucideIcon;
  color: string;
  pending?: boolean;
}> = {
  running:      { label: 'Running',      icon: CircleCheck,   color: 'text-[var(--ok)] border-[var(--ok)]/30 bg-[var(--ok)]/10' },
  stopped:      { label: 'Stopped',      icon: Square,        color: 'text-[var(--idle)] border-[var(--idle)]/30 bg-[var(--idle)]/10' },
  provisioning: { label: 'Provisioning…', icon: LoaderCircle,  color: 'text-[var(--warn)] border-[var(--warn)]/30 bg-[var(--warn)]/10', pending: true },
  starting:     { label: 'Starting…',    icon: LoaderCircle,  color: 'text-[var(--warn)] border-[var(--warn)]/30 bg-[var(--warn)]/10', pending: true },
  stopping:     { label: 'Stopping…',    icon: LoaderCircle,  color: 'text-[var(--warn)] border-[var(--warn)]/30 bg-[var(--warn)]/10', pending: true },
  resetting:    { label: 'Resetting…',   icon: LoaderCircle,  color: 'text-[var(--warn)] border-[var(--warn)]/30 bg-[var(--warn)]/10', pending: true },
  deleting:     { label: 'Deleting…',    icon: LoaderCircle,  color: 'text-[var(--bad)] border-[var(--bad)]/30 bg-[var(--bad)]/10', pending: true },
  failed:       { label: 'Failed',       icon: OctagonAlert,  color: 'text-[var(--bad)] border-[var(--bad)]/30 bg-[var(--bad)]/10' },
  deleted:      { label: 'Deleted',      icon: Trash2,        color: 'text-[var(--idle)] border-[var(--idle)]/30 bg-[var(--idle)]/10' },
};

interface StateBadgeProps {
  state: LifecycleState;
  size?: 'sm' | 'md';
}

export function StateBadge({ state, size = 'md' }: StateBadgeProps) {
  const config = STATE_CONFIG[state] ?? STATE_CONFIG.failed;
  const Icon = config.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border font-medium',
        size === 'sm' ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-1 text-xs',
        config.color,
        config.pending && 'badge-pending',
      )}
      aria-label={`State: ${config.label}`}
    >
      <Icon
        size={16}
        className={config.pending ? 'animate-spin' : ''}
        aria-hidden="true"
      />
      {config.label}
    </span>
  );
}
