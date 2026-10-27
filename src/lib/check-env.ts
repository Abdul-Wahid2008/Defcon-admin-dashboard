// Release-readiness checks on environment variables. Pure; messages never contain values.
const EXAMPLE_VALUES = new Set(['change-me', 'replace-with-a-random-secret-at-least-32-characters']);
const ADAPTERS = ['mock', 'real', 'docker-compose'];

export function checkEnv(env: Record<string, string | undefined>): string[] {
  const problems: string[] = [];
  const get = (name: string) => env[name]?.trim() ?? '';

  const secret = get('SESSION_SECRET');
  if (secret.length < 32) problems.push('SESSION_SECRET must be at least 32 characters.');
  else if (EXAMPLE_VALUES.has(secret)) problems.push('SESSION_SECRET is the .env.example placeholder.');

  for (const name of ['DEMO_CONTROLS', 'ALLOW_DEFAULT_PASSWORDS']) {
    const value = get(name);
    if (value === 'true') problems.push(`${name} must not be true in a release.`);
    else if (value !== '' && value !== 'false') problems.push(`${name} must be "true" or "false" (config.ts rejects anything else).`);
  }

  const dbPath = get('DB_PATH');
  if (!dbPath || dbPath === ':memory:') problems.push('DB_PATH must be set to durable SQLite storage (not unset or :memory:).');

  // seed.ts falls back to 'change-me' when these are unset, so unset counts as default.
  for (const name of ['ORGANIZER_ADMIN_PASSWORD', 'ORGANIZER_OPERATOR_PASSWORD']) {
    const value = get(name);
    if (!value || EXAMPLE_VALUES.has(value)) problems.push(`${name} is unset or a default value.`);
  }

  const adapter = get('ADAPTER') || 'mock';
  if (!ADAPTERS.includes(adapter)) problems.push(`ADAPTER must be one of: ${ADAPTERS.join(', ')}.`);

  const health = get('HEALTH_SOURCE') || 'mock';
  if (!['mock', 'scoreboard', 'ingest'].includes(health)) problems.push('HEALTH_SOURCE must be one of: mock, scoreboard, ingest.');
  if (get('CHECK_RELEASE') === '1' && env.HEALTH_SOURCE?.trim() === 'mock') problems.push('HEALTH_SOURCE=mock is not allowed in a release.');
  if (health === 'scoreboard' && !get('HEALTH_SCOREBOARD_URL')) problems.push('HEALTH_SOURCE=scoreboard requires HEALTH_SCOREBOARD_URL.');
  if (health === 'ingest' && get('INGEST_TOKEN').length < 32) problems.push('HEALTH_SOURCE=ingest requires INGEST_TOKEN of at least 32 characters.');
  if (get('INGEST_TOKEN') && get('INGEST_TOKEN').length < 32) problems.push('INGEST_TOKEN must be at least 32 characters.');

  return problems;
}
