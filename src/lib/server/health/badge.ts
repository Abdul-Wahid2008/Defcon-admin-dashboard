/**
 * SIMULATED = lifecycle and health both mock; LIVE only when both are real AND the one-team evidence gate has been
 * passed (EVIDENCE_GATE_PASSED=true, set by an operator after W8); anything else mixed is PARTIAL (docs/12 D17).
 */
export function badgeFor(
  adapter: 'mock' | 'real' | 'docker-compose',
  health: 'mock' | 'scoreboard' | 'ingest',
  evidenceGatePassed = false,
) {
  if (adapter === 'mock' && health === 'mock') return 'SIMULATED' as const;
  if (adapter === 'real' && health !== 'mock' && evidenceGatePassed) return 'LIVE' as const;
  return 'PARTIAL' as const;
}
