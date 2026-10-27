import 'server-only';
import { z } from 'zod';
import type { HealthRow } from './apply';
import { readCapped } from './limits';

export const FETCH_TIMEOUT_MS = 5000;
export const MAX_SCOREBOARD_BYTES = 2 * 1024 * 1024;

/** Error whose `code` is safe to store and show (never contains the URL, a token or response text). */
export class SourceError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'SourceError';
  }
}

export interface ScoreboardSnapshot {
  currentRound: number | null;
  rows: HealthRow[];
}

/** The only place that knows the scoreboard file format. Swap this when the club sends a real sample. */
export type ScoreboardParser = (json: unknown) => ScoreboardSnapshot;

// PROVISIONAL (docs/12 A21, UNCONFIRMED): this shape is NOT the EnoEngine format. It exists so the pipeline can be built
// and tested. Any file that does not match throws SOURCE_SHAPE_UNKNOWN; nothing is guessed.
// Needs confirming against a real /data/scoreboard.json: round field name, team id field, per-service key, per-flagstore
// verdict (or only a per-service verdict?), verdict strings, whether a per-row check time exists.
const ProvisionalScoreboard = z.object({
  currentRound: z.number().int().nonnegative(),
  teams: z.array(z.object({
    teamId: z.union([z.string(), z.number()]),
    services: z.array(z.object({
      key: z.string(),
      flagstores: z.array(z.object({
        key: z.string(),
        verdict: z.string(),
        message: z.string().nullish(),
      })),
    })),
  })),
});

export const parseScoreboard: ScoreboardParser = (json) => {
  const parsed = ProvisionalScoreboard.safeParse(json);
  if (!parsed.success) throw new SourceError('SOURCE_SHAPE_UNKNOWN');
  const { currentRound, teams } = parsed.data;
  const rows: HealthRow[] = [];
  for (const team of teams) {
    for (const service of team.services) {
      for (const fs of service.flagstores) {
        rows.push({
          externalTeamId: String(team.teamId),
          serviceKey: service.key,
          flagstore: fs.key,
          verdict: fs.verdict,
          message: fs.message ?? null,
          round: currentRound,
        });
      }
    }
  }
  return { currentRound, rows };
};

/** Server-side GET with timeout, no redirects, no cookies, size cap and host allow-list. Errors are SourceError codes only. */
export async function fetchScoreboardJson(
  url: string,
  allowedHosts: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new SourceError('bad_url'); }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !allowedHosts.includes(parsed.host.toLowerCase())) {
    throw new SourceError('host_not_allowed');
  }

  let res: Response;
  try {
    res = await fetchImpl(parsed, {
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    const err = e as { name?: string; cause?: { message?: string } };
    if (err.name === 'TimeoutError' || err.name === 'AbortError') throw new SourceError('timeout');
    if (/redirect/i.test(err.cause?.message ?? '')) throw new SourceError('redirect_refused');
    throw new SourceError('network_error');
  }

  if (res.status >= 300 && res.status < 400) throw new SourceError('redirect_refused');
  if (!res.ok) throw new SourceError(`http_${res.status}`);
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_SCOREBOARD_BYTES) throw new SourceError('too_large');

  let text: string;
  try {
    text = await readCapped(res.body, MAX_SCOREBOARD_BYTES);
  } catch (e) {
    throw new SourceError((e as Error).message === 'TOO_LARGE' ? 'too_large' : 'network_error');
  }
  try { return JSON.parse(text); } catch { throw new SourceError('invalid_json'); }
}
