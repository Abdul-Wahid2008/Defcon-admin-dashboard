import 'server-only';
import { dbHelper } from '../db';
import { loadConfig, type HealthSourceMode } from '../../config';
import { appendAudit } from '../audit';
import { applyHealthBatch, type ApplyResult } from './apply';
import { fetchScoreboardJson, parseScoreboard, SourceError, type ScoreboardParser } from './scoreboard-source';

const FORCE_MIN_GAP_MS = 5000;
const ROUND_CHANGED_KEY = 'health_round_changed_at';

interface StateRow {
  source: string;
  last_round: number | null;
  last_fetch_at: string | null;
  last_ok_at: string | null;
  last_error: string | null;
}

export type SourceState = 'mock' | 'disabled' | 'never' | 'ok' | 'error' | 'stale' | 'frozen';

export interface HealthSourceStatus {
  source: HealthSourceMode;
  state: SourceState;
  lastRound: number | null;
  lastFetchAt: string | null;
  lastOkAt: string | null;
  /** Short error code only (e.g. timeout, http_502, SOURCE_SHAPE_UNKNOWN); never a URL or response text. */
  lastError: string | null;
  staleAfterSec: number;
  roundSec: number;
}

function setting(key: string): string | undefined {
  return dbHelper.get<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, key)?.value;
}

function numSetting(key: string, fallback: number): number {
  const n = Number(setting(key));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function staleAfterSec(): number {
  return numSetting('stale_after_sec', 270);
}

function readState(source: string): StateRow | undefined {
  return dbHelper.get<StateRow>(`SELECT * FROM health_source_state WHERE source = ?`, source);
}

function patchState(source: string, patch: Partial<Omit<StateRow, 'source'>>): void {
  dbHelper.run(`INSERT OR IGNORE INTO health_source_state (source) VALUES (?)`, source);
  const cols = Object.keys(patch) as (keyof typeof patch)[];
  if (cols.length === 0) return;
  dbHelper.run(
    `UPDATE health_source_state SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE source = ?`,
    ...cols.map(c => patch[c] ?? null), source);
}

export function getHealthSourceStatus(nowMs = Date.now()): HealthSourceStatus {
  const cfg = loadConfig();
  const base = { staleAfterSec: staleAfterSec(), roundSec: numSetting('round_sec', 90) };
  if (cfg.healthSource === 'mock') {
    return { source: 'mock', state: 'mock', lastRound: null, lastFetchAt: null, lastOkAt: null, lastError: null, ...base };
  }
  const st = readState(cfg.healthSource);
  const out = {
    source: cfg.healthSource,
    lastRound: st?.last_round ?? null,
    lastFetchAt: st?.last_fetch_at ?? null,
    lastOkAt: st?.last_ok_at ?? null,
    lastError: st?.last_error ?? null,
    ...base,
  };
  let state: SourceState;
  if (cfg.healthSource === 'ingest' && !cfg.ingestToken) state = 'disabled';
  else if (!st?.last_ok_at) state = st?.last_error ? 'error' : 'never';
  else if (st.last_error) state = 'error';
  else if (nowMs - Date.parse(st.last_ok_at) > base.staleAfterSec * 1000) state = 'stale';
  else {
    const changed = setting(ROUND_CHANGED_KEY);
    state = cfg.healthSource === 'scoreboard' && changed && nowMs - Date.parse(changed) > 2 * base.roundSec * 1000
      ? 'frozen' : 'ok';
  }
  return { ...out, state };
}

/** Records a successful push (ingest) so freshness is visible next to the data. */
export function recordIngestOk(result: ApplyResult, maxRound: number | null, nowIso = new Date().toISOString()): void {
  const prev = readState('ingest');
  if (result.accepted + result.unchanged === 0 && result.rejected.length > 0) {
    patchState('ingest', { last_fetch_at: nowIso, last_error: 'all_rows_rejected' });
    return;
  }
  patchState('ingest', {
    last_fetch_at: nowIso,
    last_ok_at: nowIso,
    last_error: null,
    last_round: maxRound !== null ? Math.max(maxRound, prev?.last_round ?? 0) : prev?.last_round ?? null,
  });
}

/**
 * First batch from a real source: seeded/simulated check results (e.g. round 42 from the seed) must not outrank real
 * data through the monotonic rule, so they are cleared to unknown once, before the first real batch is applied.
 */
export function adoptRealSource(source: 'scoreboard' | 'ingest', nowIso: string): void {
  if (readState(source)?.last_ok_at) return;
  dbHelper.transaction(() => {
    dbHelper.run(`UPDATE flagstore_results SET verdict = 'UNKNOWN', message = NULL, round = NULL, checked_at = NULL`);
    dbHelper.run(`UPDATE checks SET status = 'unknown', detail = NULL, last_checked_at = NULL`);
    const r = dbHelper.run(
      `UPDATE alerts SET resolved_at = ? WHERE resolved_at IS NULL AND kind IN ('service_down', 'service_degraded')`, nowIso);
    appendAudit({
      ts: nowIso, actorName: 'system', actorRole: 'system', action: 'health.run', targetType: 'system',
      outcome: 'success', message: `Real health source (${source}) adopted: simulated check results cleared, ${r.changes} simulated alerts closed.`,
    });
  });
}

export interface PullDeps {
  force?: boolean;
  fetchImpl?: typeof fetch;
  nowMs?: number;
  parser?: ScoreboardParser;
}

let inflight: Promise<void> | null = null; // ponytail: per-process lock; fine for one `next start` process

/** Lazy single-flight pull: no timers. Never throws; failures are recorded and old data ages into "stale". */
export function pullIfDue(deps: PullDeps = {}): Promise<void> {
  const cfg = loadConfig();
  if (cfg.healthSource !== 'scoreboard' || !cfg.healthScoreboardUrl) return Promise.resolve();
  if (inflight) return inflight;
  const nowMs = deps.nowMs ?? Date.now();
  const last = readState('scoreboard')?.last_fetch_at;
  const gap = deps.force ? FORCE_MIN_GAP_MS : cfg.healthPollSec * 1000;
  if (last && nowMs - Date.parse(last) < gap) return Promise.resolve();
  inflight = doPull(cfg.healthScoreboardUrl, cfg.healthAllowedHosts, nowMs, deps).finally(() => { inflight = null; });
  return inflight;
}

async function doPull(url: string, hosts: string[], nowMs: number, deps: PullDeps): Promise<void> {
  const nowIso = new Date(nowMs).toISOString();
  patchState('scoreboard', { last_fetch_at: nowIso }); // before the fetch, so a slow or failing source is not hammered
  try {
    const json = await fetchScoreboardJson(url, hosts, deps.fetchImpl);
    const snap = (deps.parser ?? parseScoreboard)(json);
    adoptRealSource('scoreboard', nowIso);
    const result = applyHealthBatch(snap.rows, 'scoreboard', nowIso);
    const prev = readState('scoreboard');
    if (snap.currentRound !== null && snap.currentRound !== prev?.last_round) {
      dbHelper.run(
        `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        ROUND_CHANGED_KEY, nowIso);
    }
    const nothingApplied = result.accepted + result.unchanged === 0 && result.rejected.length > 0;
    patchState('scoreboard', {
      last_ok_at: nowIso,
      last_round: snap.currentRound,
      last_error: nothingApplied ? 'all_rows_rejected' : null,
    });
  } catch (e) {
    patchState('scoreboard', { last_error: e instanceof SourceError ? e.code : 'internal_error' });
  }
}

/** Read-time staleness: a check older than the threshold is "unknown/stale", never green. */
export function isStale(lastCheckedAt: string | null, nowMs: number, thresholdSec = staleAfterSec()): boolean {
  return !lastCheckedAt || nowMs - Date.parse(lastCheckedAt) > thresholdSec * 1000;
}

export function resetPullStateForTests(): void {
  inflight = null;
}
