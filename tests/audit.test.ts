import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

// Use an in-memory database for each test suite to avoid touching data/defcon.db
// and to avoid the append-only trigger interfering with test setup.
let db: InstanceType<typeof Database>;

function createTestDb(): InstanceType<typeof Database> {
  const testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = ON');
  const sql = fs.readFileSync(
    path.resolve(process.cwd(), 'migrations/001_init.sql'),
    'utf8',
  );
  testDb.exec(sql);
  return testDb;
}

describe('Audit Log Append-Only Invariant', () => {
  beforeEach(() => {
    // Fresh in-memory DB for every test — no real file touched, no trigger conflict on cleanup
    db = createTestDb();
  });

  it('should allow inserting new audit entries', () => {
    const result = db.prepare(
      `INSERT INTO audit_log (ts, actor_name, actor_role, action, target_type, outcome, message)
       VALUES (datetime('now'), 'admin', 'organizer_admin', 'team.create', 'team', 'success', 'Team created')`,
    ).run();
    expect(result.changes).toBe(1);
    expect(result.lastInsertRowid).toBeGreaterThan(0);
  });

  it('should throw an error when attempting to update an audit entry', () => {
    db.prepare(
      `INSERT INTO audit_log (ts, actor_name, actor_role, action, target_type, outcome, message)
       VALUES (datetime('now'), 'admin', 'organizer_admin', 'team.create', 'team', 'success', 'Original message')`,
    ).run();

    const row = db.prepare('SELECT id FROM audit_log LIMIT 1').get() as { id: number };

    expect(() => {
      db.prepare('UPDATE audit_log SET message = ? WHERE id = ?')
        .run('Updated message', row.id);
    }).toThrow(/audit_log is append-only/);
  });

  it('should throw an error when attempting to delete an audit entry', () => {
    db.prepare(
      `INSERT INTO audit_log (ts, actor_name, actor_role, action, target_type, outcome, message)
       VALUES (datetime('now'), 'admin', 'organizer_admin', 'team.create', 'team', 'success', 'Original message')`,
    ).run();

    const row = db.prepare('SELECT id FROM audit_log LIMIT 1').get() as { id: number };

    expect(() => {
      db.prepare('DELETE FROM audit_log WHERE id = ?').run(row.id);
    }).toThrow(/audit_log is append-only/);
  });
});
