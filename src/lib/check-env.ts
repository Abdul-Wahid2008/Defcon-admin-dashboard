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
    if (get(name) === 'true') problems.push(`${name} must not be true in a release.`);
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

  return problems;
}
