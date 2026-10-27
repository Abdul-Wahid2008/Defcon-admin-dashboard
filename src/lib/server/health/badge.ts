/** SIMULATED = lifecycle and health both mock; LIVE only when both are real; anything mixed is PARTIAL (docs/12 D17). */
export function badgeFor(adapter: 'mock' | 'real' | 'docker-compose', health: 'mock' | 'scoreboard' | 'ingest') {
  if (adapter === 'mock' && health === 'mock') return 'SIMULATED' as const;
  if (adapter === 'real' && health !== 'mock') return 'LIVE' as const;
  return 'PARTIAL' as const;
}
