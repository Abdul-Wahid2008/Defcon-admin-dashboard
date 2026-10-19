export type AdapterMode = 'mock' | 'real' | 'docker-compose';

export interface AppConfig {
  adapter: AdapterMode;
  dbPath: string;
  sessionSecret: string | undefined;
  demoControls: boolean;
  allowDefaultPasswords: boolean;
  mockDurationScale: number;
  orchestratorBaseUrl: string | undefined;
  orchestratorToken: string | undefined;
  orchestratorTimeoutMs: number | undefined;
}

const DEFAULT_DB_PATH = 'data/defcon.db';

function parseBoolean(value: string | undefined, name: string): boolean {
  if (value === undefined || value === '') return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be "true" or "false".`);
}

function parsePositiveNumber(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return parsed;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  nodeEnv: string = env.NODE_ENV || 'development',
): AppConfig {
  const adapterValue = (env.ADAPTER || 'mock').trim();
  if (adapterValue !== 'mock' && adapterValue !== 'real' && adapterValue !== 'docker-compose') {
    throw new Error('ADAPTER must be one of: mock, real, docker-compose.');
  }
  const adapter = adapterValue as AdapterMode;
  const isProductionBuild = env.NEXT_PHASE === 'phase-production-build';

  const sessionSecret = env.SESSION_SECRET?.trim() || undefined;
  if (!isProductionBuild && nodeEnv !== 'test' && (!sessionSecret || sessionSecret.length < 32)) {
    throw new Error('SESSION_SECRET must be configured with at least 32 characters.');
  }

  const configuredDbPath = env.DB_PATH?.trim();
  if (!isProductionBuild && nodeEnv === 'production' && (!configuredDbPath || configuredDbPath === ':memory:')) {
    throw new Error('DB_PATH must point to durable SQLite storage in production.');
  }
  const dbPath = configuredDbPath || (nodeEnv === 'test' ? ':memory:' : DEFAULT_DB_PATH);

  const demoControls = parseBoolean(env.DEMO_CONTROLS, 'DEMO_CONTROLS');
  if (!isProductionBuild && demoControls && (nodeEnv !== 'development' || adapter !== 'mock')) {
    throw new Error('DEMO_CONTROLS may only be enabled for mock development mode.');
  }

  const allowDefaultPasswords = parseBoolean(env.ALLOW_DEFAULT_PASSWORDS, 'ALLOW_DEFAULT_PASSWORDS');
  if (!isProductionBuild && allowDefaultPasswords && (nodeEnv !== 'development' || adapter !== 'mock')) {
    throw new Error('ALLOW_DEFAULT_PASSWORDS may only be enabled for mock development mode.');
  }

  const mockDurationScale = parsePositiveNumber(env.MOCK_DURATION_SCALE, 'MOCK_DURATION_SCALE', 1);
  if (!isProductionBuild && nodeEnv === 'production' && mockDurationScale !== 1) {
    throw new Error('MOCK_DURATION_SCALE is rehearsal-only and must be 1 in production.');
  }

  const orchestratorBaseUrl = env.ORCHESTRATOR_BASE_URL?.trim() || undefined;
  const orchestratorToken = env.ORCHESTRATOR_TOKEN?.trim() || undefined;
  const orchestratorTimeoutMs = env.ORCHESTRATOR_TIMEOUT_MS
    ? parsePositiveNumber(env.ORCHESTRATOR_TIMEOUT_MS, 'ORCHESTRATOR_TIMEOUT_MS', 10000)
    : undefined;
  if (!isProductionBuild && adapter === 'real' && (!orchestratorBaseUrl || !orchestratorToken || !orchestratorTimeoutMs)) {
    throw new Error(
      'ADAPTER=real requires ORCHESTRATOR_BASE_URL, ORCHESTRATOR_TOKEN, and ORCHESTRATOR_TIMEOUT_MS.',
    );
  }

  return {
    adapter,
    dbPath,
    sessionSecret,
    demoControls,
    allowDefaultPasswords,
    mockDurationScale,
    orchestratorBaseUrl,
    orchestratorToken,
    orchestratorTimeoutMs,
  };
}

export const DB_PATH = process.env.NODE_ENV === 'test'
  ? ':memory:'
  : process.env.DB_PATH || DEFAULT_DB_PATH;


export const MOCK_DURATIONS = {
  provision: 6 * 1000,
  start: 3 * 1000,
  stop: 2 * 1000,
  reset: 5 * 1000,
  delete: 3 * 1000,
};

export const POLLING_INTERVALS = {
  DEFAULT: 5 * 1000,
  PENDING: 2 * 1000,
};

export const SOFT_TEAM_CAP = 30;

export const HEALTH_INTERVAL_SEC = null;
export const IDLE_SESSION_TIMEOUT_MIN = null;
