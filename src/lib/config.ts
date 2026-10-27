export type AdapterMode = 'mock' | 'real' | 'docker-compose';

export type HealthSourceMode = 'mock' | 'scoreboard' | 'ingest';

export interface AppConfig {
  adapter: AdapterMode;
  healthSource: HealthSourceMode;
  healthScoreboardUrl: string | undefined;
  healthAllowedHosts: string[];
  healthPollSec: number;
  ingestToken: string | undefined;
  /** Team role may reset its own environment (spec) — default false per the club's decision (docs/12 C1). */
  /** e.g. https://host/{port}/ — `{port}` = ttyd port, `{team}` = team id. Used by the real adapter only. */
  terminalUrlTemplate: string | undefined;
  /** Operator-set after the W8 one-team real-mutation evidence; the only way the badge can read LIVE. */
  evidenceGatePassed: boolean;
  teamSelfReset: boolean;
  /** Read X-Forwarded-For / treat the app as behind a reverse proxy. */
  trustProxy: boolean;
  /** Force the Secure cookie flag (otherwise set from X-Forwarded-Proto=https). */
  cookieSecure: boolean;
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

  const healthValue = (env.HEALTH_SOURCE || 'mock').trim();
  if (healthValue !== 'mock' && healthValue !== 'scoreboard' && healthValue !== 'ingest') {
    throw new Error('HEALTH_SOURCE must be one of: mock, scoreboard, ingest.');
  }
  const healthSource = healthValue as HealthSourceMode;
  // Release mode (check-env sets CHECK_RELEASE=1) refuses an explicitly configured mock health source.
  if (env.CHECK_RELEASE === '1' && env.HEALTH_SOURCE?.trim() === 'mock') {
    throw new Error('HEALTH_SOURCE=mock is not allowed in a release.');
  }

  const healthScoreboardUrl = env.HEALTH_SCOREBOARD_URL?.trim() || undefined;
  let healthAllowedHosts: string[] = [];
  if (healthSource === 'scoreboard') {
    if (!healthScoreboardUrl) throw new Error('HEALTH_SOURCE=scoreboard requires HEALTH_SCOREBOARD_URL.');
    let parsed: URL;
    try { parsed = new URL(healthScoreboardUrl); } catch { throw new Error('HEALTH_SCOREBOARD_URL must be a valid URL.'); }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('HEALTH_SCOREBOARD_URL must use http or https.');
    }
    healthAllowedHosts = (env.HEALTH_ALLOWED_HOSTS ?? '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
    if (healthAllowedHosts.length === 0) healthAllowedHosts = [parsed.host.toLowerCase()];
    if (!healthAllowedHosts.includes(parsed.host.toLowerCase())) {
      throw new Error('HEALTH_SCOREBOARD_URL host is not in HEALTH_ALLOWED_HOSTS.');
    }
  }
  const healthPollSec = parsePositiveNumber(env.HEALTH_POLL_SEC, 'HEALTH_POLL_SEC', 15);

  const terminalUrlTemplate = env.TERMINAL_URL_TEMPLATE?.trim() || undefined;
  if (terminalUrlTemplate) {
    let u: URL;
    try { u = new URL(terminalUrlTemplate.replaceAll('{port}', '7601').replaceAll('{team}', 'team-01')); } catch { throw new Error('TERMINAL_URL_TEMPLATE must be a valid URL.'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('TERMINAL_URL_TEMPLATE must use http or https.');
    if (u.username || u.password) throw new Error('TERMINAL_URL_TEMPLATE must not contain credentials.');
  }

  const ingestToken = env.INGEST_TOKEN?.trim() || undefined;
  if (ingestToken && ingestToken.length < 32) {
    throw new Error('INGEST_TOKEN must be at least 32 characters.');
  }

  return {
    adapter,
    healthSource,
    healthScoreboardUrl,
    healthAllowedHosts,
    healthPollSec,
    ingestToken,
    terminalUrlTemplate,
    evidenceGatePassed: parseBoolean(env.EVIDENCE_GATE_PASSED, 'EVIDENCE_GATE_PASSED'),
    teamSelfReset: parseBoolean(env.TEAM_SELF_RESET, 'TEAM_SELF_RESET'),
    trustProxy: parseBoolean(env.TRUST_PROXY, 'TRUST_PROXY'),
    cookieSecure: parseBoolean(env.COOKIE_SECURE, 'COOKIE_SECURE'),
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
  service: 2 * 1000,
};

export { POLLING_INTERVALS } from './polling';

export const SOFT_TEAM_CAP = 30;

export const HEALTH_INTERVAL_SEC = null;
export const IDLE_SESSION_TIMEOUT_MIN = null;
