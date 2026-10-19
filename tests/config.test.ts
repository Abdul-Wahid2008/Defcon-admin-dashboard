import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/lib/config';
import { createAdapter } from '../src/lib/server/adapters';
import { GET as getMeta } from '../src/app/api/meta/route';

const validEnv = (overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: 'production',
  SESSION_SECRET: 'a'.repeat(32),
  DB_PATH: 'data/release.sqlite',
  ADAPTER: 'mock',
  ...overrides,
});

describe('release configuration', () => {
  it('rejects a missing SESSION_SECRET', () => {
    const env = validEnv();
    delete env.SESSION_SECRET;
    expect(() => loadConfig(env, 'production')).toThrow(
      'SESSION_SECRET must be configured with at least 32 characters.',
    );
  });

  it('rejects a short SESSION_SECRET', () => {
    expect(() => loadConfig(validEnv({ SESSION_SECRET: 'too-short' }), 'production')).toThrow(
      'SESSION_SECRET must be configured with at least 32 characters.',
    );
  });

  it('accepts a valid SESSION_SECRET', () => {
    expect(loadConfig(validEnv(), 'production')).toMatchObject({
      adapter: 'mock',
      dbPath: 'data/release.sqlite',
      sessionSecret: 'a'.repeat(32),
    });
  });

  it('rejects unsupported adapters', () => {
    expect(() => loadConfig(validEnv({ ADAPTER: 'unknown' }), 'production')).toThrow(
      'ADAPTER must be one of: mock, real, docker-compose.',
    );
  });

  it('requires real adapter configuration without exposing secret values', () => {
    expect(() => loadConfig(validEnv({ ADAPTER: 'real' }), 'production')).toThrow(
      'ADAPTER=real requires ORCHESTRATOR_BASE_URL, ORCHESTRATOR_TOKEN, and ORCHESTRATOR_TIMEOUT_MS.',
    );
  });

  it('fails clearly when docker-compose prerequisites are missing', () => {
    const config = loadConfig(validEnv({ ADAPTER: 'docker-compose' }), 'production');
    expect(() => createAdapter(config)).toThrow(
      'ADAPTER=docker-compose requires teams-template/docker-compose.yml.',
    );
  });

  it('never substitutes the mock adapter for an explicitly selected real adapter', () => {
    const config = loadConfig(validEnv({
      ADAPTER: 'real',
      ORCHESTRATOR_BASE_URL: 'https://orchestrator.invalid',
      ORCHESTRATOR_TOKEN: 'redacted-test-token',
      ORCHESTRATOR_TIMEOUT_MS: '5000',
    }), 'production');
    expect(() => createAdapter(config)).toThrow(
      'ADAPTER=real is not available because no verified real orchestrator client is implemented.',
    );
  });

  it('keeps demo controls disabled outside explicit mock development mode', () => {
    expect(() => loadConfig(validEnv({ DEMO_CONTROLS: 'true' }), 'production')).toThrow(
      'DEMO_CONTROLS may only be enabled for mock development mode.',
    );
    const developmentEnv = validEnv({ NODE_ENV: 'development', DB_PATH: 'data/dev.sqlite' });
    expect(loadConfig({ ...developmentEnv, DEMO_CONTROLS: 'false' }, 'development').demoControls).toBe(false);
    expect(loadConfig({ ...developmentEnv, DEMO_CONTROLS: 'true' }, 'development').demoControls).toBe(true);
  });

  it('rejects default passwords outside mock development mode', () => {
    expect(() => loadConfig(validEnv({ ALLOW_DEFAULT_PASSWORDS: 'true' }), 'production')).toThrow(
      'ALLOW_DEFAULT_PASSWORDS may only be enabled for mock development mode.',
    );
  });

  it('requires durable DB_PATH in production', () => {
    expect(() => loadConfig(validEnv({ DB_PATH: ':memory:' }), 'production')).toThrow(
      'DB_PATH must point to durable SQLite storage in production.',
    );
  });

  it('rejects a missing DB_PATH in production', () => {
    const env = validEnv();
    delete env.DB_PATH;
    expect(() => loadConfig(env, 'production')).toThrow(
      'DB_PATH must point to durable SQLite storage in production.',
    );
  });

  it('rejects scaled mock timing in production', () => {
    expect(() => loadConfig(validEnv({ MOCK_DURATION_SCALE: '2' }), 'production')).toThrow(
      'MOCK_DURATION_SCALE is rehearsal-only and must be 1 in production.',
    );
  });

  it('does not expose secret configuration through /api/meta', async () => {
    const response = await getMeta();
    const body = await response.json() as Record<string, unknown>;
    expect(body).not.toHaveProperty('sessionSecret');
    expect(body).not.toHaveProperty('orchestratorToken');
    expect(body).not.toHaveProperty('ORCHESTRATOR_TOKEN');
  });
});
