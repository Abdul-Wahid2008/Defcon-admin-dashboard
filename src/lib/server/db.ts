import 'server-only';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config';

type SqliteValue = string | number | bigint | Buffer | null;
type SqliteParam = SqliteValue | SqliteValue[];

function normalizeParams(params: SqliteParam[]): SqliteValue[] {
  return params.length === 1 && Array.isArray(params[0]) ? params[0] : params as SqliteValue[];
}

// Use a single connection throughout the app
const db = new Database(loadConfig().dbPath);

// Essential SQLite settings for consistency and performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Simple migration runner.
 * In a real app, we'd use a migrations table with versions.
 * For this project, we use the user_version pragma as a simple lock.
 */
function initializeDatabase() {
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version === 0) {
    const migrationPath = path.join(process.cwd(), 'migrations', '001_init.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    try {
      db.exec(sql);
    } catch (e) {
      console.warn('Database initialization warning:', e);
    }
    db.pragma('user_version = 1');
  }
}

initializeDatabase();

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
