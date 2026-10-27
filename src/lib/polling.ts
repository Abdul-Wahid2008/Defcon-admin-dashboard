// Client-safe constants. Kept apart from config.ts, which parses server environment variables and must not ship to the browser.
export const POLLING_INTERVALS = {
  DEFAULT: 5 * 1000,
  PENDING: 2 * 1000,
};
