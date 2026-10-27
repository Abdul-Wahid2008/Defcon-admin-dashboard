import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseEventConfig, getEventConfig, servicePort, ttydPort, teamCapWarning } from '../src/lib/event-config';
import { migrate } from '../src/lib/migrate';

const raw = () => JSON.parse(fs.readFileSync('config/services.json', 'utf8'));

describe('event-config manifest', () => {
  it('loads the shipped config with 4 services', () => {
    const c = getEventConfig();
    expect(c.services.map(s => s.key)).toEqual(['docuvault', 'pulsechat', 'swiftshop', 'service-4']);
    expect(c.services.every(s => !s.nameConfirmed)).toBe(true);
  });
  it('rejects duplicate keys, duplicate offsets, offset >= stride, bad flagstore count', () => {
    const c = raw();
    expect(() => parseEventConfig({ ...c, services: [c.services[0], c.services[0]] })).toThrow();
    expect(() => parseEventConfig({ ...c, services: [c.services[0], { ...c.services[1], portOffset: 0 }] })).toThrow();
    expect(() => parseEventConfig({ ...c, services: [{ ...c.services[0], portOffset: 10 }] })).toThrow();
    expect(() => parseEventConfig({ ...c, services: [{ ...c.services[0], flagstores: 2 }] })).toThrow();
    expect(() => parseEventConfig({ ...c, services: [] })).toThrow();
  });
  it('port formulas', () => {
    expect(servicePort(1, 0)).toBe(10010);
    expect(servicePort(20, 4)).toBe(10204);
    expect(ttydPort(7)).toBe(7607);
    expect(teamCapWarning(20)).toBeNull();
    expect(teamCapWarning(21)).toMatch(/exceeds 20/);
  });
});

describe('migration 002', () => {
  it('upgrades a v1-only database in place and keeps data', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
    fs.copyFileSync('migrations/001_init.sql', path.join(dir, '001_init.sql'));
    expect(migrate(db, dir)).toBe(1);
    db.prepare(`INSERT INTO teams (id,seq,name,created_at,updated_at) VALUES ('team-01',1,'A','t','t')`).run();
    db.prepare(`INSERT INTO users (id,username,password_hash,display_name,role,created_at) VALUES ('u1','a','h','A','organizer_admin','t')`).run();

    expect(migrate(db)).toBe(2);
    expect(db.pragma('user_version', { simple: true })).toBe(2);
    expect(db.prepare(`SELECT name FROM teams`).all()).toEqual([{ name: 'A' }]);
    const u = db.prepare(`SELECT session_epoch, must_change_password, last_login_at FROM users`).get();
    expect(u).toEqual({ session_epoch: 0, must_change_password: 0, last_login_at: null });
    const teamCols = db.pragma('table_info(teams)') as { name: string }[];
    expect(teamCols.map(c => c.name)).toContain('external_team_id');
    expect(db.prepare(`SELECT key,value FROM settings ORDER BY key`).all()).toEqual([
      { key: 'mutations_frozen', value: '0' }, { key: 'round_sec', value: '90' }, { key: 'stale_after_sec', value: '270' },
    ]);
    expect(migrate(db)).toBe(2); // idempotent
  });

  it('enforces unique external_team_id, flagstore/verdict CHECKs, and keeps audit append-only', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrate(db);
    const t = db.prepare(`INSERT INTO teams (id,seq,name,created_at,updated_at,external_team_id) VALUES (?,?,?,'t','t',?)`);
    t.run('team-01', 1, 'A', '1');
    expect(() => t.run('team-02', 2, 'B', '1')).toThrow(/UNIQUE/);
    t.run('team-03', 3, 'C', null); t.run('team-04', 4, 'D', null); // NULLs may repeat
    db.prepare(`INSERT INTO services (team_id,key,name,port) VALUES ('team-01','docuvault','D',10010)`).run();
    const f = db.prepare(`INSERT INTO flagstore_results (team_id,service_key,flagstore,verdict) VALUES ('team-01','docuvault',?,?)`);
    f.run('flag0', 'OK');
    expect(() => f.run('flag3', 'OK')).toThrow(/CHECK/);
    expect(() => f.run('flag1', 'GREAT')).toThrow(/CHECK/);
    db.prepare(`DELETE FROM services WHERE team_id='team-01'`).run(); // cascades
    expect(db.prepare(`SELECT COUNT(*) c FROM flagstore_results`).get()).toEqual({ c: 0 });

    db.prepare(`INSERT INTO audit_log (ts,actor_name,actor_role,action,target_type,outcome,message) VALUES ('t','a','system','x','y','success','m')`).run();
    expect(() => db.prepare(`UPDATE audit_log SET message='z'`).run()).toThrow(/append-only/);
    expect(() => db.prepare(`DELETE FROM audit_log`).run()).toThrow(/append-only/);
  });
});

describe('seed', () => {
  it('seeds 24 teams x 4 services x 3 flagstores with no funsplash', { timeout: 60_000 }, () => {
    const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'seed-')), 'seed.db');
    execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', '--tsconfig', 'tsconfig.scripts.json', 'scripts/seed.ts'], {
      env: { ...process.env, DB_PATH: dbPath, ALLOW_DEFAULT_PASSWORDS: 'true' },
      stdio: 'pipe',
    });
    const db = new Database(dbPath, { readonly: true });
    const n = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
    expect(n('SELECT COUNT(*) c FROM teams')).toBe(24);
    expect(n('SELECT COUNT(*) c FROM services')).toBe(96);
    expect(n('SELECT COUNT(*) c FROM checks')).toBe(192);
    expect(n('SELECT COUNT(*) c FROM flagstore_results')).toBe(288);
    expect(n(`SELECT COUNT(*) c FROM services WHERE key='funsplash'`)).toBe(0);
    expect(n(`SELECT COUNT(*) c FROM teams WHERE external_team_id IS NULL`)).toBe(0);
    expect(db.prepare(`SELECT port FROM services WHERE team_id='team-03' AND key='swiftshop'`).get()).toEqual({ port: 10033 });
    expect(n(`SELECT COUNT(*) c FROM settings WHERE key='stale_after_sec'`)).toBe(1);
    db.close();
  });
});
