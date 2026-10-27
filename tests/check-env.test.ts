import { describe, expect, it } from 'vitest';
import { checkEnv } from '../src/lib/check-env';

const good = {
  SESSION_SECRET: 'x'.repeat(40),
  DB_PATH: 'data/release.sqlite',
  ORGANIZER_ADMIN_PASSWORD: 'admin-real-pass',
  ORGANIZER_OPERATOR_PASSWORD: 'operator-real-pass',
  ADAPTER: 'mock',
};

describe('checkEnv', () => {
  it('passes a release-ready environment', () => {
    expect(checkEnv(good)).toEqual([]);
  });

  it.each([
    ['short SESSION_SECRET', { SESSION_SECRET: 'short' }, 'SESSION_SECRET'],
    ['example SESSION_SECRET', { SESSION_SECRET: 'replace-with-a-random-secret-at-least-32-characters' }, 'SESSION_SECRET'],
    ['DEMO_CONTROLS', { DEMO_CONTROLS: 'true' }, 'DEMO_CONTROLS'],
    ['ALLOW_DEFAULT_PASSWORDS', { ALLOW_DEFAULT_PASSWORDS: 'true' }, 'ALLOW_DEFAULT_PASSWORDS'],
    ['unset DB_PATH', { DB_PATH: undefined }, 'DB_PATH'],
    ['memory DB_PATH', { DB_PATH: ':memory:' }, 'DB_PATH'],
    ['default admin password', { ORGANIZER_ADMIN_PASSWORD: 'change-me' }, 'ORGANIZER_ADMIN_PASSWORD'],
    ['unset operator password', { ORGANIZER_OPERATOR_PASSWORD: undefined }, 'ORGANIZER_OPERATOR_PASSWORD'],
    ['bad ADAPTER', { ADAPTER: 'nope' }, 'ADAPTER'],
  ])('rejects %s', (_label, override, name) => {
    const problems = checkEnv({ ...good, ...override });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(name);
  });

  it('never echoes secret values', () => {
    const text = checkEnv({ ...good, SESSION_SECRET: 'short-secret-value', ORGANIZER_ADMIN_PASSWORD: 'change-me' }).join('\n');
    expect(text).not.toContain('short-secret-value');
  });
});
