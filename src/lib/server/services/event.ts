import 'server-only';
import { dbHelper } from '../db';
import type { EventClock, EventPhase } from '../adapters/types';

// UNCONFIRMED (docs/12 C8, event-flow draft): 45 / 165 / 30 minutes. Overridable per settings key.
const DEFAULT_MINUTES = { peace: 45, battle: 165, freeze: 30 };

function setting(key: string): string | undefined {
  return dbHelper.get<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, key)?.value;
}

function minutes(key: string, fallback: number): number {
  const n = Number(setting(key));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Pure phase calculation so it can be tested without a database. */
export function phaseAt(startIso: string | null, nowMs: number, m: EventClock['phaseMinutes']): EventPhase | null {
  if (!startIso) return null;
  const start = Date.parse(startIso);
  if (Number.isNaN(start)) return null;
  const min = (nowMs - start) / 60_000;
  if (min < 0) return 'not_started';
  if (min < m.peace) return 'peace';
  if (min < m.peace + m.battle) return 'battle';
  if (min < m.peace + m.battle + m.freeze) return 'freeze';
  return 'ended';
}

export function getEventClock(
  nowMs: number,
  source: { source: 'mock' | 'scoreboard' | 'ingest'; lastRound: number | null; roundSec: number },
): EventClock {
  const startedAt = setting('event_start_iso') || null;
  const phaseMinutes = {
    peace: minutes('phase_peace_min', DEFAULT_MINUTES.peace),
    battle: minutes('phase_battle_min', DEFAULT_MINUTES.battle),
    freeze: minutes('phase_freeze_min', DEFAULT_MINUTES.freeze),
  };
  return {
    phase: phaseAt(startedAt, nowMs, phaseMinutes),
    currentRound: source.source === 'mock' ? null : source.lastRound,
    roundSec: source.roundSec,
    startedAt,
    source: source.source === 'mock' ? 'none' : source.source,
    phaseMinutes,
  };
}
