/**
 * Load / soak test. Simulates organizers polling /api/overview and /api/teams every 5 s plus an occasional
 * stop/start on a mock team, then prints p50/p95/p99, payload size, error counts and (with PID) RSS growth.
 *
 *   BASE_URL=http://127.0.0.1:3100 LT_USER=admin LT_PASS=... MINUTES=2 npm run loadtest
 *   npm run soak   (MINUTES=60, set LT_PID to the server's node PID for RSS sampling)
 *
 * Point it at a temp DB server only (never port 3000). Mutations need ADAPTER=mock.
 */
import { execFileSync } from 'node:child_process';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3100';
const USER = process.env.LT_USER ?? '';
const PASS = process.env.LT_PASS ?? '';
const MINUTES = Number(process.env.MINUTES ?? 2);
const ORGANIZERS = Number(process.env.ORGANIZERS ?? 3);
const POLL_MS = Number(process.env.POLL_MS ?? 5000);
const ACTION_EVERY_MS = Number(process.env.ACTION_EVERY_MS ?? 60000);
const PID = process.env.LT_PID ? Number(process.env.LT_PID) : null;

if (!USER || !PASS) { console.error('Set LT_USER and LT_PASS.'); process.exit(2); }

type Sample = { ms: number; status: number; bytes: number };
const samples: Record<string, Sample[]> = {};
const netErrors: Record<string, number> = {};
const rss: Array<{ min: number; mb: number }> = [];
const t0 = Date.now();
const stopAt = t0 + MINUTES * 60_000;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function timed(label: string, cookie: string, path: string, init: RequestInit = {}): Promise<{ items?: Array<{ id: string; lifecycleState: string; pending: unknown }> } | null> {
  const start = performance.now();
  try {
    const res = await fetch(BASE + path, { ...init, headers: { ...(init.headers as object), cookie, origin: BASE } });
    const text = await res.text();
    (samples[label] ??= []).push({ ms: performance.now() - start, status: res.status, bytes: Buffer.byteLength(text) });
    try { return JSON.parse(text); } catch { return null; }
  } catch {
    netErrors[label] = (netErrors[label] ?? 0) + 1;
    return null;
  }
}

async function login(): Promise<string> {
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

async function organizer(n: number) {
  const cookie = await login();
  await sleep(n * 700); // de-sync the organizers
  let actions = 0;
  let nextAction = Date.now() + ACTION_EVERY_MS * (n + 1) / ORGANIZERS;
  while (Date.now() < stopAt) {
    await timed('overview', cookie, '/api/overview');
    const teams = await timed('teams', cookie, '/api/teams?pageSize=100');
    if (Date.now() >= nextAction && teams?.items?.length) {
      nextAction = Date.now() + ACTION_EVERY_MS;
      const t = teams.items.filter((x) => x.lifecycleState === 'running' && !x.pending)[n % 5];
      if (t) {
        actions++;
        await timed('action:stop', cookie, `/api/teams/${t.id}/environment/stop`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() } });
        await sleep(POLL_MS * 4);
        await timed('action:start', cookie, `/api/teams/${t.id}/environment/start`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() } });
      }
    }
    await sleep(POLL_MS);
  }
  console.log(`organizer ${n}: ${actions} stop/start pairs issued`);
}

function sampleRss() {
  if (!PID) return;
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${PID}).WorkingSet64`], { encoding: 'utf8' });
    rss.push({ min: (Date.now() - t0) / 60_000, mb: Number(out.trim()) / 1048576 });
  } catch { /* process gone */ }
}

const pct = (a: number[], p: number) => a[Math.max(0, Math.ceil(a.length * p) - 1)];

async function main() {
  console.log(`loadtest ${BASE} organizers=${ORGANIZERS} minutes=${MINUTES} poll=${POLL_MS}ms`);
  sampleRss();
  const rssTimer = setInterval(sampleRss, 30_000);
  await Promise.all(Array.from({ length: ORGANIZERS }, (_, i) => organizer(i)));
  clearInterval(rssTimer);
  sampleRss();

  let bad = 0;
  console.log('\nendpoint        n    p50ms  p95ms  p99ms  maxKB  2xx  4xx  5xx  net');
  for (const [label, s] of Object.entries(samples)) {
    const ms = s.map(x => x.ms).sort((a, b) => a - b);
    const c = (lo: number, hi: number) => s.filter(x => x.status >= lo && x.status < hi).length;
    const fivexx = c(500, 600);
    // polls must be 2xx (a 401/429 would otherwise print fast fake latencies); action 4xx (409 etc.) are expected noise
    bad += fivexx + (netErrors[label] ?? 0) + (label.startsWith('action') ? 0 : c(400, 500));
    console.log(
      `${label.padEnd(14)} ${String(s.length).padStart(4)} ${pct(ms, .5).toFixed(1).padStart(7)} ${pct(ms, .95).toFixed(1).padStart(6)} ${pct(ms, .99).toFixed(1).padStart(6)} ` +
      `${(Math.max(...s.map(x => x.bytes)) / 1024).toFixed(1).padStart(6)} ${String(c(200, 300)).padStart(4)} ${String(c(400, 500)).padStart(4)} ${String(fivexx).padStart(4)} ${String(netErrors[label] ?? 0).padStart(4)}`,
    );
  }
  if (rss.length > 1) {
    const [a, b] = [rss[0].mb, rss[rss.length - 1].mb];
    console.log(`\nRSS ${a.toFixed(0)} MB -> ${b.toFixed(0)} MB (${(((b - a) / a) * 100).toFixed(1)}%) over ${rss[rss.length - 1].min.toFixed(1)} min, ${rss.length} samples`);
  }
  const ov = samples.overview ? Math.max(...samples.overview.map(x => x.bytes)) / 1024 : 0;
  const o95 = samples.overview ? pct(samples.overview.map(x => x.ms).sort((a, b) => a - b), .95) : Infinity;
  const t95 = samples.teams ? pct(samples.teams.map(x => x.ms).sort((a, b) => a - b), .95) : Infinity;
  const ok = bad === 0 && o95 < 150 && t95 < 150 && ov < 60;
  console.log(`\nTargets: overview p95<150 (${o95.toFixed(1)}), teams p95<150 (${t95.toFixed(1)}), overview<60KB (${ov.toFixed(1)}), 5xx/net=0 (${bad}) => ${ok ? 'PASS' : 'FAIL'}`);
  process.exit(ok ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(2); });
