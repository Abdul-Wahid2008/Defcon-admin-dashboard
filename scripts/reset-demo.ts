/**
 * Reset demo — truncates all mock tables and reseeds fresh data.
 * Run with: npm run reset-demo
 * Safe to run repeatedly. Preserves the audit_log (appends a demo.reseed row).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('Resetting demo data...');
const result = spawnSync(
  process.execPath,
  ['--import', 'tsx/esm', path.join(__dirname, 'seed.ts')],
  { stdio: 'inherit', env: { ...process.env, ALLOW_DEFAULT_PASSWORDS: 'true' } },
);

if (result.status !== 0) {
  console.error('Seed failed');
  process.exit(result.status ?? 1);
}

// Append demo.reseed audit row
import Database from 'better-sqlite3';
import crypto from 'node:crypto';

const DB_PATH = process.env.DB_PATH || 'data/defcon.db';
const db = new Database(DB_PATH);
const adminRow = db.prepare(`SELECT id, username FROM users WHERE role = 'organizer_admin' LIMIT 1`).get() as any;

db.prepare(`INSERT INTO audit_log
  (ts,actor_id,actor_name,actor_role,action,target_type,target_id,outcome,message,request_id,correlation_id,details_json)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
  .run(
    new Date().toISOString(),
    adminRow?.id ?? null,
    adminRow?.username ?? 'system',
    'organizer_admin',
    'demo.reseed', 'system', null, 'success',
    'Demo data reset via reset-demo script',
    `r_${crypto.randomBytes(5).toString('hex')}`,
    null,
    JSON.stringify({ seeded: true }),
  );

console.log('  ✓ demo.reseed audit row written');
console.log('\nDemo reset complete.');
