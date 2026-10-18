/**
 * Seed script — run with: npm run seed
 * Populates users, teams, participants, services, checks, alerts, and audit rows.
 */
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────
const DB_PATH = process.env.DB_PATH || 'data/defcon.db';
const SEED_TEAMS = parseInt(process.env.SEED_TEAMS || '24', 10);
const ADMIN_USER = process.env.ORGANIZER_ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ORGANIZER_ADMIN_PASSWORD || 'change-me';
const OP_USER = process.env.ORGANIZER_OPERATOR_USERNAME || 'operator';
const OP_PASS = process.env.ORGANIZER_OPERATOR_PASSWORD || 'change-me';
const ALLOW_DEFAULTS = process.env.ALLOW_DEFAULT_PASSWORDS === 'true';

if ((ADMIN_PASS === 'change-me' || OP_PASS === 'change-me') && !ALLOW_DEFAULTS) {
  console.error('ERROR: Default passwords detected. Set ORGANIZER_ADMIN_PASSWORD and ORGANIZER_OPERATOR_PASSWORD in .env, or set ALLOW_DEFAULT_PASSWORDS=true for demo.');
  process.exit(1);
}

const SERVICES_MANIFEST = [
  { key: 'docuvault', name: 'DocuVault', port: 8001, placeholder: 0 },
  { key: 'funsplash', name: 'FUnsplash', port: 8002, placeholder: 0 },
  { key: 'svc-3', name: 'Service 3', port: 8003, placeholder: 1 },
  { key: 'svc-4', name: 'Service 4', port: 8004, placeholder: 1 },
  { key: 'svc-5', name: 'Service 5', port: 8005, placeholder: 1 },
];

const TEAM_NAMES = [
  'Null Pointers', 'Packet Pirates', 'Root Cause', 'Zero Day Zealots',
  'Stack Smashers', 'Byte Bandits', 'Shell Shockers', 'Cipher Syndicate',
  'Kernel Panic', 'Ghost Protocol', 'Red Herring', 'Port Scanners',
  'Sudo Squad', 'Hash Collision', 'Rubber Duckies', 'Lambda Lurkers',
  'Buffer Overflowers', 'Daemon Hunters', 'Fork Bomb', 'Segfault Society',
  'Trojan Horsepower', 'Phantom Pings', 'Rootkit Rebels', 'Brute Force Brigade',
];

const PASSWORD_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function genPassword(len = 12): string {
  let s = '';
  for (let i = 0; i < len; i++) s += PASSWORD_CHARS[crypto.randomInt(0, PASSWORD_CHARS.length)];
  return s;
}

function pad2(n: number): string { return n.toString().padStart(2, '0'); }

function iso(offset = 0): string { return new Date(Date.now() + offset).toISOString(); }

function isoHoursAgo(h: number): string { return new Date(Date.now() - h * 3600 * 1000).toISOString(); }

function newAlertId(): string { return `a_${crypto.randomBytes(4).toString('hex')}`; }

function newCorrId(): string { return `c_${crypto.randomBytes(6).toString('hex')}`; }

// ── Open DB ───────────────────────────────────────────────────────────────────
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const version = db.pragma('user_version', { simple: true }) as number;
if (version === 0) {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '001_init.sql'), 'utf8');
  db.exec(sql);
  db.pragma('user_version = 1');
  console.log('  ✓ Database schema created');
}

// ── Wipe mock tables (preserve audit structure) ───────────────────────────────
db.exec(`
  DELETE FROM checks;
  DELETE FROM services;
  DELETE FROM participants;
  DELETE FROM environments;
  DELETE FROM teams;
  DELETE FROM alerts;
  DELETE FROM users;
  DELETE FROM settings;
  DELETE FROM idempotency_keys;
`);
// Keep audit_log (append-only — we'll add new seed rows)

// ── Users ─────────────────────────────────────────────────────────────────────
const adminHash = bcrypt.hashSync(ADMIN_PASS, 10);
const opHash = bcrypt.hashSync(OP_PASS, 10);
const adminId = `u_${crypto.randomBytes(4).toString('hex')}`;
const opId = `u_${crypto.randomBytes(4).toString('hex')}`;

db.prepare(`INSERT INTO users (id,username,password_hash,display_name,role,active,created_at) VALUES (?,?,?,?,?,1,?)`)
  .run(adminId, ADMIN_USER, adminHash, 'Admin', 'organizer_admin', iso());
db.prepare(`INSERT INTO users (id,username,password_hash,display_name,role,active,created_at) VALUES (?,?,?,?,?,1,?)`)
  .run(opId, OP_USER, opHash, 'Operator', 'organizer_operator', iso());
console.log(`  ✓ Users seeded (${ADMIN_USER}, ${OP_USER})`);

// ── Settings ──────────────────────────────────────────────────────────────────
db.prepare(`INSERT INTO settings (key,value) VALUES ('competition_status','not_started')`).run();

// ── Teams ─────────────────────────────────────────────────────────────────────
const numTeams = Math.min(SEED_TEAMS, TEAM_NAMES.length);

// State mix per spec: 18 running healthy, 2 running degraded, 1 running down, 2 stopped, 1 failed
// For >24 teams, distribute proportionally
type TeamState = 'running_healthy' | 'running_degraded' | 'running_down' | 'stopped' | 'failed';
const stateMap: Record<number, TeamState> = {
  4: 'running_degraded',   // team-05 (index 4)
  12: 'running_down',      // team-13 (index 12)
  16: 'running_degraded',  // team-17 (index 16)
  18: 'failed',            // team-19 (index 18)
  21: 'stopped',           // team-22
  22: 'stopped',           // team-23
};

const patchResults: Array<'accepted' | 'rejected' | 'rolled_back'> = ['accepted', 'accepted', 'accepted', 'accepted', 'rejected', 'rolled_back', 'accepted', 'accepted'];

for (let i = 0; i < numTeams; i++) {
  const seq = i + 1;
  const teamId = `team-${pad2(seq)}`;
  const teamName = TEAM_NAMES[i];
  const stateKind: TeamState = stateMap[i] ?? 'running_healthy';
  const createdAt = isoHoursAgo(6 + Math.random() * 12);
  const updatedAt = isoHoursAgo(Math.random() * 3);
  const acceptedPatch = crypto.randomInt(1, 6);
  const lastDeployResult = patchResults[i % patchResults.length];
  const lastDeployAt = isoHoursAgo(1 + Math.random() * 5);

  let lifecycleState: string;
  let failureReason: string | null = null;

  switch (stateKind) {
    case 'failed':
      lifecycleState = 'failed';
      failureReason = 'reset failed (simulated)';
      break;
    case 'stopped':
      lifecycleState = 'stopped';
      break;
    default:
      lifecycleState = 'running';
  }

  const terminalUrl = lifecycleState === 'running'
    ? `https://${teamId}-${crypto.randomBytes(2).toString('hex')}.terminal.invalid/`
    : null;

  const activeSessions = lifecycleState === 'running' ? crypto.randomInt(0, 7) : 0;

  db.prepare(`INSERT INTO teams (id,seq,name,notes,account_status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?)`)
    .run(teamId, seq, teamName, '', 'active', createdAt, updatedAt);

  db.prepare(`INSERT INTO environments
    (team_id,lifecycle_state,accepted_patch_version,last_deploy_result,last_deploy_at,
     active_sessions,failure_reason,last_action_at,last_health_check_at,terminal_url)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(teamId, lifecycleState, acceptedPatch, lastDeployResult, lastDeployAt,
      activeSessions, failureReason, updatedAt, updatedAt, terminalUrl);

  // 4 participants each
  for (let p = 1; p <= 4; p++) {
    const pId = `p_${crypto.randomBytes(4).toString('hex')}`;
    const username = `${teamId}-p${p}`;
    const password = genPassword();
    const hash = bcrypt.hashSync(password, 10);
    db.prepare(`INSERT INTO participants (id,team_id,name,username,password_hash,credential_issued_at,credential_version,active)
      VALUES (?,?,?,?,?,?,1,1)`)
      .run(pId, teamId, `Participant ${p}`, username, hash, createdAt);
  }

  // 5 services + 10 checks
  for (const svc of SERVICES_MANIFEST) {
    db.prepare(`INSERT INTO services (team_id,key,name,port,placeholder) VALUES (?,?,?,?,?)`)
      .run(teamId, svc.key, svc.name, svc.port, svc.placeholder);

    // Determine check status
    let reachStatus = 'pass', funcStatus = 'pass';
    let reachDetail: string | null = null, funcDetail: string | null = null;

    if (lifecycleState !== 'running') {
      reachStatus = 'unknown'; funcStatus = 'unknown';
    } else if (stateKind === 'running_down' && svc.key === 'funsplash') {
      reachStatus = 'fail'; funcStatus = 'unknown';
      reachDetail = 'OFFLINE: connection refused';
    } else if (stateKind === 'running_degraded' && svc.key === 'docuvault') {
      funcStatus = 'fail';
      funcDetail = 'MUMBLE: login workflow failed';
    }

    db.prepare(`INSERT INTO checks (team_id,service_key,check_type,status,detail,last_checked_at,forced_fail) VALUES (?,?,'reachability',?,?,?,0)`)
      .run(teamId, svc.key, reachStatus, reachDetail, updatedAt);
    db.prepare(`INSERT INTO checks (team_id,service_key,check_type,status,detail,last_checked_at,forced_fail) VALUES (?,?,'functional',?,?,?,0)`)
      .run(teamId, svc.key, funcStatus, funcDetail, updatedAt);
  }
}

// ── Alerts ────────────────────────────────────────────────────────────────────
// team-05 & team-17: degraded (docuvault functional fail)
for (const t of ['team-05', 'team-17']) {
  db.prepare(`INSERT INTO alerts (id,team_id,severity,kind,dedupe_key,message,created_at) VALUES (?,?,'warning','service_degraded',?,?,?)`)
    .run(newAlertId(), t, `${t}:docuvault:functional`, `docuvault functional check failed on ${t}`, isoHoursAgo(0.5));
}
// team-13: down (funsplash reachability fail)
db.prepare(`INSERT INTO alerts (id,team_id,severity,kind,dedupe_key,message,created_at) VALUES (?,?,'critical','service_down',?,?,?)`)
  .run(newAlertId(), 'team-13', 'team-13:funsplash:reachability', 'funsplash is unreachable on team-13', isoHoursAgo(0.3));
// team-19: failed
db.prepare(`INSERT INTO alerts (id,team_id,severity,kind,dedupe_key,message,created_at) VALUES (?,?,'critical','environment_failed',?,?,?)`)
  .run(newAlertId(), 'team-19', 'team-19:reset:failure', 'reset failed (simulated) for team-19', isoHoursAgo(0.2));

// ── Audit rows (~40 rows over last 6 hours) ────────────────────────────────────
const auditActors = [
  { id: adminId, name: 'Admin', role: 'organizer_admin' },
  { id: opId, name: 'Operator', role: 'organizer_operator' },
  { id: null, name: 'system', role: 'system' },
];

const auditTemplates = [
  { action: 'auth.login', targetType: 'session', outcome: 'success', msgFn: (a: any) => `${a.name} logged in` },
  { action: 'team.create', targetType: 'team', outcome: 'success', msgFn: (_: any, t: string) => `Team ${t} created` },
  { action: 'env.provision', targetType: 'team', outcome: 'success', msgFn: (_: any, t: string) => `provision success for ${t}` },
  { action: 'env.start', targetType: 'team', outcome: 'success', msgFn: (_: any, t: string) => `start success for ${t}` },
  { action: 'env.stop', targetType: 'team', outcome: 'success', msgFn: (_: any, t: string) => `stop success for ${t}` },
  { action: 'env.reset', targetType: 'team', outcome: 'success', msgFn: (_: any, t: string) => `reset success for ${t}` },
  { action: 'env.reset', targetType: 'team', outcome: 'failure', msgFn: (_: any, t: string) => `reset failed (simulated) for ${t}` },
  { action: 'credential.rotate', targetType: 'participant', outcome: 'success', msgFn: (_: any, t: string) => `credentials rotated for ${t}` },
  { action: 'health.run', targetType: 'team', outcome: 'success', msgFn: (_: any, t: string) => `health checks run for ${t}` },
  { action: 'team.update', targetType: 'team', outcome: 'denied', msgFn: (a: any, t: string) => `Unauthorized update team ${t} by ${a.name}` },
];

const insertAudit = db.prepare(`INSERT INTO audit_log
  (ts,actor_id,actor_name,actor_role,action,target_type,target_id,outcome,message,request_id,correlation_id,details_json)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);

for (let i = 0; i < 40; i++) {
  const minsAgo = Math.random() * 360;
  const ts = new Date(Date.now() - minsAgo * 60 * 1000).toISOString();
  const actor = auditActors[Math.floor(Math.random() * auditActors.length)];
  const tmpl = auditTemplates[Math.floor(Math.random() * auditTemplates.length)];
  const teamNum = crypto.randomInt(1, numTeams + 1);
  const teamId = `team-${pad2(teamNum)}`;
  const corrId = newCorrId();
  const reqId = `r_${crypto.randomBytes(5).toString('hex')}`;

  insertAudit.run(
    ts, actor.id, actor.name, actor.role,
    tmpl.action, tmpl.targetType,
    tmpl.targetType === 'team' ? teamId : `p_${crypto.randomBytes(4).toString('hex')}`,
    tmpl.outcome,
    tmpl.msgFn(actor, teamId),
    reqId, corrId,
    JSON.stringify({ seeded: true }),
  );
}

console.log(`  ✓ ${numTeams} teams seeded`);
console.log(`  ✓ ${numTeams * 4} participants seeded`);
console.log(`  ✓ ${numTeams * 5} services seeded (${numTeams * 10} checks)`);
console.log(`  ✓ Alerts seeded`);
console.log(`  ✓ ~40 audit rows seeded`);
console.log('\nSeed complete. Run: npm run dev');
