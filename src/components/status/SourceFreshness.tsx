import { CircleAlert, CircleCheck, CircleDashed, Clock } from 'lucide-react';
import type { OverviewData } from '@/lib/schemas';
import { RelativeTime } from '@/components/ui/relative-time';

const ERROR_TEXT: Record<string, string> = {
  timeout: 'the source did not answer within 5 s',
  network_error: 'the source could not be reached',
  redirect_refused: 'the source redirected (redirects are refused)',
  too_large: 'the source response was larger than 2 MB',
  invalid_json: 'the source did not return valid JSON',
  host_not_allowed: 'the configured URL is not on the allow-list',
  bad_url: 'the configured URL is invalid',
  SOURCE_SHAPE_UNKNOWN: 'the scoreboard file format is not recognised (parser needs updating)',
  all_rows_rejected: 'no scoreboard row matched a dashboard team or service (check external team ids)',
  internal_error: 'an internal error occurred while applying the data',
};

export function describeSourceError(code: string | null): string {
  if (!code) return '';
  if (code.startsWith('http_')) return `the source answered HTTP ${code.slice(5)}`;
  return ERROR_TEXT[code] ?? code;
}

/** Plain statement of where health data comes from and how fresh it is. */
export function SourceFreshness({ source }: { source: OverviewData['healthSource'] }) {
  if (source.source === 'mock') {
    return <div className="flex items-center gap-2 text-sm text-[var(--muted)]"><CircleDashed size={15} aria-hidden="true" />Health data is simulated (HEALTH_SOURCE=mock).</div>;
  }
  const name = source.source === 'scoreboard' ? 'Scoreboard' : 'Ingest';
  const round = source.lastRound !== null ? `, round ${source.lastRound}` : '';
  const problem = {
    error: { Icon: CircleAlert, tone: 'text-[var(--bad)]', text: `${name} source error: ${describeSourceError(source.lastError)}. Showing the last data received; it becomes unknown after ${source.staleAfterSec} s.` },
    stale: { Icon: Clock, tone: 'text-[var(--warn)]', text: `${name} data is older than ${source.staleAfterSec} s. Service status is shown as unknown.` },
    frozen: { Icon: Clock, tone: 'text-[var(--warn)]', text: `${name} source is reachable but the round has not advanced for more than ${2 * source.roundSec} s (frozen).` },
    never: { Icon: CircleDashed, tone: 'text-[var(--idle)]', text: `${name} source has not delivered data yet.` },
    disabled: { Icon: CircleAlert, tone: 'text-[var(--bad)]', text: 'Ingest is selected but INGEST_TOKEN is not set; the ingest route is disabled.' },
  }[source.state as 'error' | 'stale' | 'frozen' | 'never' | 'disabled'];
  if (problem) {
    return <div role="status" className={`flex items-start gap-2 text-sm ${problem.tone}`}><problem.Icon size={15} className="mt-0.5 shrink-0" aria-hidden="true" /><span>{problem.text}</span></div>;
  }
  return (
    <div className="flex items-center gap-2 text-sm text-[var(--ok)]">
      <CircleCheck size={15} aria-hidden="true" />
      <span>{name} live{round}, updated <RelativeTime ts={source.lastOkAt} /></span>
    </div>
  );
}
