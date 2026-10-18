export const DB_PATH = process.env.NODE_ENV === 'test'
  ? ':memory:'
  : process.env.DB_PATH || 'data/defcon.db';


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
