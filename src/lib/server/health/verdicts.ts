import type { CheckStatus, FlagstoreVerdict } from '../adapters/types';

const KNOWN: ReadonlySet<string> = new Set(['OK', 'MUMBLE', 'OFFLINE', 'INTERNAL_ERROR']);

/** Unrecognised strings become UNKNOWN. Nothing ever defaults to OK (docs/12 §7; A25 UNCONFIRMED). */
export function normalizeVerdict(raw: unknown): FlagstoreVerdict {
  if (typeof raw !== 'string') return 'UNKNOWN';
  const v = raw.trim().toUpperCase();
  return KNOWN.has(v) ? (v as FlagstoreVerdict) : 'UNKNOWN';
}

export interface ServiceChecks {
  reachability: CheckStatus;
  functional: CheckStatus;
  checkerError: boolean;
}

/** Worst-of over a service's flagstore verdicts. OFFLINE → reach fail; MUMBLE → reach pass, func fail. */
export function deriveChecks(verdicts: FlagstoreVerdict[]): ServiceChecks {
  const has = (v: FlagstoreVerdict) => verdicts.includes(v);
  const reachability: CheckStatus = has('OFFLINE') ? 'fail' : has('OK') || has('MUMBLE') ? 'pass' : 'unknown';
  const functional: CheckStatus = has('MUMBLE')
    ? 'fail'
    : verdicts.length > 0 && verdicts.every(v => v === 'OK') ? 'pass' : 'unknown';
  return { reachability, functional, checkerError: has('INTERNAL_ERROR') };
}
