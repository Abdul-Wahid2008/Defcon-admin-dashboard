/**
 * Online SQLite backup (consistent while the server is running, WAL included).
 *   npm run backup            -> data/backups/<UTC timestamp>.db, keeps the newest 12
 * Env: DB_PATH (required, like the server), BACKUP_DIR (default data/backups), BACKUP_KEEP (default 12).
 * Restore: stop the server, copy a backup over DB_PATH, delete DB_PATH-wal and DB_PATH-shm, start the server.
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dbPath = process.env.DB_PATH;
if (!dbPath || dbPath === ':memory:') { console.error('ERROR: DB_PATH must point to the live database file.'); process.exit(1); }
if (!fs.existsSync(dbPath)) { console.error(`ERROR: ${dbPath} does not exist.`); process.exit(1); }
const dir = process.env.BACKUP_DIR ?? 'data/backups';
const keep = Number(process.env.BACKUP_KEEP ?? 12);
if (!(keep >= 1)) { console.error('ERROR: BACKUP_KEEP must be a number >= 1.'); process.exit(1); }
fs.mkdirSync(dir, { recursive: true });

const ts = new Date().toISOString().replace(/[-:.]/g, ''); // 20261027T101500123Z sorts chronologically; ms avoid same-second collisions
const dest = path.join(dir, `${ts}.db`);
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
db.pragma('busy_timeout = 5000');

async function main() {
try {
  await db.backup(dest);
  const check = new Database(dest);
  let ok;
  try {
    check.pragma('journal_mode = DELETE'); // a single self-contained file: no -wal/-shm beside the backup
    ok = check.pragma('integrity_check', { simple: true });
  } finally {
    check.close();
  }
  if (ok !== 'ok') throw new Error(`integrity_check on ${dest}: ${ok}`);
  const old = fs.readdirSync(dir).filter(f => /^\d{8}T\d{9}Z\.db$/.test(f)).sort().slice(0, -keep);
  for (const f of old) for (const ext of ['', '-wal', '-shm']) fs.rmSync(path.join(dir, f + ext), { force: true });
  console.log(`backup ok: ${dest} (${fs.statSync(dest).size} bytes, pruned ${old.length})`);
} catch (e) {
  for (const ext of ['', '-wal', '-shm']) fs.rmSync(dest + ext, { force: true, maxRetries: 3 });
  console.error('backup FAILED:', (e as Error).message);
  process.exit(1);
} finally {
  db.close();
}
}

void main();
