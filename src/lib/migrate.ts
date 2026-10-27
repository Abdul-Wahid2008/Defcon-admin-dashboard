import type Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

/** Applies migrations/NNN_*.sql in order, tracked by PRAGMA user_version. Throws on failure (fail closed). */
export function migrate(db: InstanceType<typeof Database>, dir = path.join(process.cwd(), 'migrations')): number {
  const files = fs.readdirSync(dir).filter(f => /^\d{3}_.*\.sql$/.test(f)).sort();
  let version = db.pragma('user_version', { simple: true }) as number;
  for (const f of files) {
    const n = parseInt(f.slice(0, 3), 10);
    if (n <= version) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    if (n === 1) {
      db.exec(sql); // 001 contains PRAGMAs, which cannot run inside a transaction
      db.pragma('user_version = 1');
    } else {
      // IMMEDIATE + re-read: another process (next build workers, scripts) may have migrated meanwhile.
      db.exec('BEGIN IMMEDIATE');
      try {
        if ((db.pragma('user_version', { simple: true }) as number) < n) {
          db.exec(sql);
          db.pragma(`user_version = ${n}`); // transactional: schema and version commit together
        }
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    }
    version = n;
  }
  return version;
}
