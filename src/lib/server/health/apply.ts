import 'server-only';
import crypto from 'node:crypto';
import { dbHelper } from '../db';
import { appendAudit } from '../audit';
import type { FlagstoreKey, FlagstoreVerdict } from '../adapters/types';
import { deriveChecks, normalizeVerdict } from './verdicts';

export type HealthSourceName = 'scoreboard' | 'ingest';

export interface HealthRow {
  externalTeamId: string;
  serviceKey: string;
  flagstore: string;
  verdict: unknown;
  message?: string | null;
  round?: number | null;
  /** ISO time the checker produced the result. Absent → "now" for a new round, unchanged for a repeated round. */
  checkedAt?: string | null;
}

export interface ApplyResult {
  accepted: number;
  unchanged: number;
  rejected: { index: number; reason: string }[];
}

const FLAGSTORES: ReadonlySet<string> = new Set(['flag0', 'flag1', 'flag2']);
const MAX_MESSAGE = 200;

interface Stored { verdict: FlagstoreVerdict; round: number | null; checked_at: string | null }

/** One SQLite transaction: any throw rolls the whole batch back. Never throws for bad rows — they are rejected. */
export function applyHealthBatch(rows: HealthRow[], source: HealthSourceName, now = new Date().toISOString()): ApplyResult {
  return dbHelper.transaction(() => {
    const result: ApplyResult = { accepted: 0, unchanged: 0, rejected: [] };
    const teams = new Map<string, { id: string; archived: boolean } | null>();
    const services = new Map<string, boolean>();
    const touched = new Map<string, { teamId: string; serviceKey: string }>();

    rows.forEach((row, index) => {
      const reject = (reason: string) => { result.rejected.push({ index, reason }); };

      if (!teams.has(row.externalTeamId)) {
        const t = dbHelper.get<{ id: string; archived_at: string | null }>(
          `SELECT id, archived_at FROM teams WHERE external_team_id = ?`, row.externalTeamId);
        teams.set(row.externalTeamId, t ? { id: t.id, archived: t.archived_at !== null } : null);
      }
      const team = teams.get(row.externalTeamId);
      if (!team) return reject('unknown_team');
      if (team.archived) return reject('team_archived');

      const svcKey = `${team.id}:${row.serviceKey}`;
      if (!services.has(svcKey)) {
        services.set(svcKey, !!dbHelper.get(`SELECT 1 AS x FROM services WHERE team_id = ? AND key = ?`, team.id, row.serviceKey));
      }
      if (!services.get(svcKey)) return reject('unknown_service');
      if (!FLAGSTORES.has(row.flagstore)) return reject('unknown_flagstore');

      const round = row.round ?? null;
      if (round !== null && (!Number.isInteger(round) || round < 0)) return reject('invalid_round');
      const given = row.checkedAt ?? null;
      // a time in the future would never go stale and would block every later row; allow 60 s of clock skew
      if (given !== null && (Number.isNaN(Date.parse(given)) || Date.parse(given) > Date.parse(now) + 60_000)) return reject('invalid_checked_at');
      const checkedAtGiven = given === null ? null : new Date(given).toISOString();

      const stored = dbHelper.get<Stored>(
        `SELECT verdict, round, checked_at FROM flagstore_results WHERE team_id = ? AND service_key = ? AND flagstore = ?`,
        team.id, row.serviceKey, row.flagstore);

      if (stored && stored.checked_at !== null) {
        if (round !== null && stored.round !== null && round !== stored.round) {
          if (round < stored.round) return reject('older_than_stored');
        } else if (checkedAtGiven !== null) {
          if (checkedAtGiven < stored.checked_at) return reject('older_than_stored');
          if (checkedAtGiven === stored.checked_at && round === stored.round) { result.unchanged++; return; }
        } else if (round !== null && round === stored.round) {
          result.unchanged++; // same round re-polled: keep the original checked_at so staleness stays honest
          return;
        }
        // else: newer round, or nothing to compare → treated as checked now
      }

      const verdict = normalizeVerdict(row.verdict);
      const message = row.message ? String(row.message).slice(0, MAX_MESSAGE) : null;
      dbHelper.run(
        `INSERT INTO flagstore_results (team_id, service_key, flagstore, verdict, message, round, checked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(team_id, service_key, flagstore) DO UPDATE SET
           verdict = excluded.verdict, message = excluded.message, round = excluded.round, checked_at = excluded.checked_at`,
        team.id, row.serviceKey, row.flagstore as FlagstoreKey, verdict, message, round, checkedAtGiven ?? now);
      result.accepted++;
      touched.set(svcKey, { teamId: team.id, serviceKey: row.serviceKey });
    });

    const touchedTeams = new Set<string>();
    for (const { teamId, serviceKey } of touched.values()) {
      touchedTeams.add(teamId);
      recomputeService(teamId, serviceKey, source, now);
    }
    for (const teamId of touchedTeams) {
      dbHelper.run(`UPDATE environments SET last_health_check_at = ? WHERE team_id = ?`, now, teamId);
    }
    return result;
  });
}

function recomputeService(teamId: string, serviceKey: string, source: HealthSourceName, now: string): void {
  const fs = dbHelper.all<{ flagstore: string; verdict: FlagstoreVerdict; message: string | null; checked_at: string | null }>(
    `SELECT flagstore, verdict, message, checked_at FROM flagstore_results WHERE team_id = ? AND service_key = ? ORDER BY flagstore`,
    teamId, serviceKey);
  const derived = deriveChecks(fs.map(f => f.verdict));
  const lastChecked = fs.map(f => f.checked_at).filter((t): t is string => !!t).sort().pop() ?? now;
  const bad = fs.filter(f => f.verdict !== 'OK');
  const detail = bad.length
    ? bad.map(f => `${f.flagstore}: ${f.verdict}${f.message ? ` (${f.message})` : ''}`).join('; ').slice(0, 300)
    : null;

  const types = [
    ['reachability', derived.reachability, 'service_down', 'critical'],
    ['functional', derived.functional, 'service_degraded', 'warning'],
  ] as const;
  for (const [type, status, kind, severity] of types) {
    dbHelper.run(
      `UPDATE checks SET status = ?, detail = ?, last_checked_at = ? WHERE team_id = ? AND service_key = ? AND check_type = ?`,
      status, status === 'pass' ? null : detail, lastChecked, teamId, serviceKey, type);
    const dedupe = `${teamId}:${serviceKey}:${type}`;
    if (status === 'fail') {
      openAlert(teamId, dedupe, kind, severity, `${serviceKey} ${type} check failed${detail ? ` — ${detail}` : ''}`, source, now);
    } else if (status === 'pass') {
      resolveAlert(teamId, dedupe, source, now);
    }
  }
  const checkerKey = `${teamId}:${serviceKey}:checker_error`;
  if (derived.checkerError) {
    openAlert(teamId, checkerKey, 'checker_error', 'info', `${serviceKey} checker reported INTERNAL_ERROR (not counted against the team)`, source, now);
  } else {
    resolveAlert(teamId, checkerKey, source, now);
  }
}

function openAlert(teamId: string, dedupeKey: string, kind: string, severity: string, message: string, source: string, now: string): void {
  const r = dbHelper.run(
    `INSERT OR IGNORE INTO alerts (id, team_id, severity, kind, dedupe_key, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    `a_${crypto.randomBytes(4).toString('hex')}`, teamId, severity, kind, dedupeKey, message, now);
  if (r.changes > 0) {
    appendAudit({
      ts: now, actorName: 'system', actorRole: 'system', action: 'alert.open', targetType: 'team', targetId: teamId,
      outcome: 'success', message: `Alert opened: ${message}`.slice(0, 300), details: { dedupeKey, kind, source },
    });
  }
}

function resolveAlert(teamId: string, dedupeKey: string, source: string, now: string): void {
  const r = dbHelper.run(`UPDATE alerts SET resolved_at = ? WHERE dedupe_key = ? AND resolved_at IS NULL`, now, dedupeKey);
  if (r.changes > 0) {
    appendAudit({
      ts: now, actorName: 'system', actorRole: 'system', action: 'alert.resolve', targetType: 'team', targetId: teamId,
      outcome: 'success', message: `Alert resolved: ${dedupeKey}`, details: { dedupeKey, source },
    });
  }
}
