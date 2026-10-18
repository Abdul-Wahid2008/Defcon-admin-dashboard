import 'server-only';
import { dbHelper } from './db';

export interface StoredResponse {
  status: number;
  body: unknown;
}

/** Lookup an idempotency key. Returns stored response if found, null otherwise. */
export function lookupIdempotencyKey(
  key: string,
  actorId: string,
  route: string,
): StoredResponse | null {
  // Expire keys older than 24h
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  dbHelper.run(
    `DELETE FROM idempotency_keys WHERE created_at < ?`,
    cutoff,
  );

  const row = dbHelper.get<{
    status: number;
    response_json: string;
  }>(
    `SELECT status, response_json FROM idempotency_keys WHERE key = ? AND actor_id = ? AND route = ?`,
    key, actorId, route,
  );

  if (!row) return null;
  return { status: row.status, body: JSON.parse(row.response_json) };
}

/** Store an idempotency key after a successful (or accepted) response. */
export function storeIdempotencyKey(
  key: string,
  actorId: string,
  route: string,
  response: StoredResponse,
): void {
  const now = new Date().toISOString();
  try {
    dbHelper.run(
      `INSERT OR IGNORE INTO idempotency_keys (key, actor_id, route, status, response_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      key, actorId, route, response.status, JSON.stringify(response.body), now,
    );
  } catch {
    // Already stored — no-op
  }
}
