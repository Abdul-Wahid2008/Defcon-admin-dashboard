import 'server-only';
import Database from 'better-sqlite3';
import { loadConfig } from '../config';
import { migrate } from '../migrate';

type SqliteValue = string | number | bigint | Buffer | null;
type SqliteParam = SqliteValue | SqliteValue[];

function normalizeParams(params: SqliteParam[]): SqliteValue[] {
  return params.length === 1 && Array.isArray(params[0]) ? params[0] : params as SqliteValue[];
}

// Use a single connection throughout the app
const db = new Database(loadConfig().dbPath);

// Essential SQLite settings for consistency and performance
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL'); // safe with WAL; fewer fsyncs
// busy_timeout: better-sqlite3 already defaults to 5000 ms
db.pragma('foreign_keys = ON');

migrate(db);

export const dbHelper = {
  /**
   * Fetches a single row.
   */
  get<T>(sql: string, ...params: SqliteParam[]): T | undefined {
    return db.prepare(sql).get(...normalizeParams(params)) as T | undefined;
  },

  /**
   * Fetches all matching rows.
   */
  all<T>(sql: string, ...params: SqliteParam[]): T[] {
    return db.prepare(sql).all(...normalizeParams(params)) as T[];
  },

  /**
   * Executes a mutating statement (INSERT, UPDATE, DELETE).
   */
  run(sql: string, ...params: SqliteParam[]): { changes: number; lastInsertRowid: number } {
    const result = db.prepare(sql).run(...normalizeParams(params));
    return {
      changes: result.changes,
      lastInsertRowid: Number(result.lastInsertRowid),
    };
  },

  /**
   * Executes a set of operations within a single transaction.
   * Note: better-sqlite3 transactions are synchronous.
   * If async operations are needed, they must be performed outside
   * or via a different mechanism.
   */
  transaction<T>(fn: () => T): T {
    const transaction = db.transaction(fn);
    return transaction();
  },
};

export default db;
