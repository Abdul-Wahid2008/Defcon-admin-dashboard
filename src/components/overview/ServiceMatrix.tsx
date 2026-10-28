'use client';

import { memo, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, CircleHelp, Clock, X, type LucideIcon } from 'lucide-react';
import type { OverviewData } from '@/lib/schemas';
import { StateBadge } from '@/components/status/StateBadge';
import { HealthBadge } from '@/components/status/HealthBadge';
import { cn } from '@/lib/utils';

type Team = OverviewData['grid'][number];
type Svc = Team['services'][number];
type Check = 'pass' | 'fail' | 'unknown';

const CHECK: Record<Check, { Icon: LucideIcon; color: string; word: string }> = {
  pass: { Icon: Check, color: 'text-[var(--ok)]', word: 'pass' },
  fail: { Icon: X, color: 'text-[var(--bad)]', word: 'fail' },
  unknown: { Icon: CircleHelp, color: 'text-[var(--idle)]', word: 'unknown' },
};

const DOT: Record<Svc['flagstores'][number], string> = {
  OK: 'bg-[var(--ok)]',
  MUMBLE: 'bg-[var(--warn)]',
  OFFLINE: 'bg-[var(--bad)]',
  INTERNAL_ERROR: 'bg-[var(--idle)] ring-1 ring-[var(--text-subtle)]',
  UNKNOWN: 'bg-transparent ring-1 ring-[var(--idle)]',
};

/** Higher = look at it first. Failed environments, then failing reachability, then functional, then unknown/stale. */
export function teamSeverity(t: Team): number {
  if (t.lifecycleState === 'failed') return 4;
  if (t.services.some(s => !s.stale && s.reachability === 'fail')) return 3;
  if (t.services.some(s => !s.stale && s.functional === 'fail')) return 2;
  if (t.lifecycleState === 'running' && t.services.some(s => s.stale || s.reachability === 'unknown' || s.functional === 'unknown')) return 1;
  return 0;
}

function cellLabel(s: Svc): string {
  const flags = s.flagstores.length ? s.flagstores.map((v, i) => `flag${i}: ${v}`).join(', ') : 'no flagstore data';
  return `${s.name}: reachability ${s.stale ? 'unknown (stale)' : CHECK[s.reachability].word}, functional ${s.stale ? 'unknown (stale)' : CHECK[s.functional].word}; ${flags}`;
}

function Glyph({ label, status, stale }: { label: string; status: Check; stale: boolean }) {
  const shown: Check = stale ? 'unknown' : status;
  const { Icon, color } = CHECK[shown];
  return <span className={cn('inline-flex items-center gap-0.5', color)}><span className="font-mono text-[10px] text-[var(--text-subtle)]">{label}</span>{stale ? <Clock size={12} aria-hidden="true" className="text-[var(--warn)]" /> : <Icon size={12} aria-hidden="true" />}</span>;
}

const Cell = memo(function Cell({ s }: { s: Svc }) {
  return (
    <td className="px-2 py-1 align-middle" title={cellLabel(s)}>
      <span className="sr-only">{cellLabel(s)}</span>
      <span aria-hidden="true" className="flex items-center gap-2 whitespace-nowrap">
        <Glyph label="R" status={s.reachability} stale={s.stale} />
        <Glyph label="F" status={s.functional} stale={s.stale} />
        <span className="flex gap-0.5">
          {(s.flagstores.length ? s.flagstores : ['UNKNOWN', 'UNKNOWN', 'UNKNOWN'] as const).map((v, i) => (
            <span key={i} className={cn('size-2 rounded-full', DOT[s.stale ? 'UNKNOWN' : v])} />
          ))}
        </span>
      </span>
    </td>
  );
});

const Row = memo(function Row({ team, onOpen }: { team: Team; onOpen: (id: string) => void }) {
  return (
    <tr
      tabIndex={0}
      onClick={() => onOpen(team.teamId)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(team.teamId); } }}
      className="h-9 cursor-pointer border-t border-[var(--border)] hover:bg-[var(--panel-2)] focus-visible:bg-[var(--panel-2)]"
      aria-label={`Open ${team.teamId} ${team.name}`}
    >
      <td className="whitespace-nowrap px-2 py-1">
        <span className="font-mono text-xs text-[var(--text-subtle)]">{team.teamId}</span>{' '}
        <span className="font-medium">{team.name}</span>
      </td>
      <td className="px-2 py-1"><StateBadge state={team.lifecycleState} size="sm" /></td>
      <td className="px-2 py-1"><HealthBadge health={team.health} size="sm" /></td>
      {team.services.map(s => <Cell key={s.key} s={s} />)}
    </tr>
  );
});

/** Teams × services, worst first. Rows are memoised so a 5 s poll only re-renders rows whose data changed. */
export function ServiceMatrix({ grid }: { grid: Team[] }) {
  const router = useRouter();
  const [problemsOnly, setProblemsOnly] = useState(false);
  const sorted = useMemo(
    () => [...grid].sort((a, b) => teamSeverity(b) - teamSeverity(a) || a.teamId.localeCompare(b.teamId)),
    [grid],
  );
  const rows = problemsOnly ? sorted.filter(t => teamSeverity(t) > 0) : sorted;
  const columns = grid[0]?.services ?? [];
  const open = useMemo(() => (id: string) => router.push(`/teams/${id}`), [router]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--text-subtle)]">
        <span>R = reachability, F = functional, dots = flag0 flag1 flag2. Sorted worst first.</span>
        <label className="flex items-center gap-2"><input type="checkbox" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} />Show only teams with a problem</label>
      </div>
      <div data-qa-scroll className="max-h-[560px] overflow-auto rounded-lg border border-[var(--border)]">
        <table className="w-full min-w-[820px] border-collapse text-[13px] tabular-nums">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--text-subtle)]">
              <th scope="col" className="sticky top-0 z-10 bg-[var(--panel)] px-2 py-2">Team</th>
              <th scope="col" className="sticky top-0 z-10 bg-[var(--panel)] px-2 py-2">State</th>
              <th scope="col" className="sticky top-0 z-10 bg-[var(--panel)] px-2 py-2">Health</th>
              {columns.map(c => <th key={c.key} scope="col" className="sticky top-0 z-10 bg-[var(--panel)] px-2 py-2 normal-case">{c.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(t => <Row key={t.teamId} team={t} onOpen={open} />)}
          </tbody>
        </table>
        {rows.length === 0 && <p className="py-8 text-center text-sm text-[var(--muted)]">{problemsOnly ? 'No team has a problem right now.' : 'No teams yet. Create one on the Teams page.'}</p>}
      </div>
    </div>
  );
}
