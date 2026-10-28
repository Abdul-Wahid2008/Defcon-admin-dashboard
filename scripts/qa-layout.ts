/**
 * Layout regression gate — run with: npm run qa:layout
 * Seeds a temp DB, starts the PRODUCTION build on port 3100 with explicit env (never the shared 3000 / .env),
 * drives headless Chrome over CDP and, for each route x viewport x role, records horizontal clipping, content/topbar
 * edge misalignment and unexplained text truncation. Screenshots go to qa-out/layout/. Exit 1 on any defect.
 * Needs `npm run build` first. Env: QA_PORT (3100), QA_CDP_PORT (9223), QA_WIDTHS, QA_ROUTES (comma lists), CHROME_PATH.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.QA_PORT ?? 3100);
const CDP_PORT = Number(process.env.QA_CDP_PORT ?? 9223);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve('qa-out/layout');
const WIDTHS = (process.env.QA_WIDTHS ?? '1024,1280,1366,1440,1536,1920,2560').split(',').map(Number);
// Height per width (prompt: 768/900/1080).
const HEIGHT = (w: number) => (w <= 1280 ? 768 : w <= 1536 ? 900 : 1080);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dcc-qa-layout-'));
const pw = () => crypto.randomBytes(9).toString('base64url') + 'aA1';
const ADMIN_PASS = pw();
const OP_PASS = pw();
const env = {
  ...process.env,
  NODE_ENV: 'production',
  PORT: String(PORT),
  DB_PATH: path.join(tmp, 'qa.db'),
  SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
  DEMO_CONTROLS: 'false',
  ALLOW_DEFAULT_PASSWORDS: 'false', // the local .env enables it; explicit env wins
  ADAPTER: 'mock',
  HEALTH_SOURCE: 'mock',
  ORGANIZER_ADMIN_USERNAME: 'admin',
  ORGANIZER_ADMIN_PASSWORD: ADMIN_PASS,
  ORGANIZER_OPERATOR_USERNAME: 'operator',
  ORGANIZER_OPERATOR_PASSWORD: OP_PASS,
  SEED_TEAMS: '24',
} as NodeJS.ProcessEnv;

const EXTRA = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), 'qa-measure-extra.js'), 'utf8');
const ROUTES_ADMIN = (process.env.QA_ROUTES ?? '/overview,/overview?view=incidents,/teams,/teams/team-01,/audit,/settings').split(',');
const ROUTES_OPERATOR = ['/overview', '/teams', '/teams/team-01', '/audit'];

type Defect = { kind: string; where: string; detail: string };
const defects: Defect[] = [];
const procs: ChildProcess[] = [];

function killTree(p: ChildProcess) {
  if (p.pid) spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
}
function cleanup() {
  for (const p of procs) killTree(p);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
}
process.on('exit', cleanup);

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function waitFor(fn: () => Promise<boolean>, ms: number, what: string) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (await fn()) return; } catch { /* retry */ }
    await sleep(250);
  }
  { if (what === "next start") console.error(fs.readFileSync(path.join(tmp, "server.log"), "utf8").slice(-1500)); throw new Error(`timeout waiting for ${what}`); }
}

// ── CDP ──────────────────────────────────────────────────────────────────────
class Cdp {
  private id = 0;
  private pending = new Map<number, (v: any) => void>();
  consoleErrors: string[] = [];
  private constructor(private ws: WebSocket) {
    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)!(m); this.pending.delete(m.id); return; }
      if (m.method === 'Runtime.exceptionThrown') this.consoleErrors.push(`exception: ${m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text}`);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') this.consoleErrors.push(`console.error: ${m.params.args?.map((a: any) => a.value ?? a.description).join(' ')}`);
    };
  }
  static async connect(): Promise<Cdp> {
    const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json() as any[];
    const target = list.find(t => t.type === 'page');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((res, rej) => { ws.onopen = () => res(); ws.onerror = () => rej(new Error('ws error')); });
    const c = new Cdp(ws);
    await c.send('Runtime.enable'); await c.send('Page.enable'); await c.send('Network.enable');
    return c;
  }
  send(method: string, params: object = {}): Promise<any> {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval<T>(expr: string): Promise<T> {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed');
    return r.result.value as T;
  }
  close() { this.ws.close(); }
}

// ── In-page measurement (stringified and evaluated in the browser) ───────────
const MEASURE = `(() => {
  const out = { docClip: null, clipped: [], edges: null, truncated: [] };
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 1) {
    const wide = [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > de.clientWidth + 1 && !(e.parentElement && e.parentElement.closest('[data-qa-scroll]'))).slice(0, 4).map(e => e.tagName.toLowerCase() + '.' + String(e.className).slice(0, 40) + '@' + getComputedStyle(e).position + ':' + Math.round(e.getBoundingClientRect().right));
    out.docClip = de.scrollWidth + ' > ' + de.clientWidth + ' (first wide: ' + wide.join(' | ') + ')';
  }
  const css = (el) => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && parts.length < 5; n = n.parentElement) {
      let s = n.tagName.toLowerCase();
      if (n.id) s += '#' + n.id;
      else if (typeof n.className === 'string' && n.className.trim()) s += '.' + n.className.trim().split(/\\s+/).slice(0, 2).join('.');
      parts.unshift(s);
    }
    return parts.join(' > ');
  };
  const hidden = (cs) => cs.visibility === 'hidden' || cs.display === 'none';
  // (b1) containers that clip horizontally while their content is wider than the box.
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (hidden(cs)) continue;
    if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1 && el.clientWidth >= 16 && !el.closest('[data-qa-scroll]')) {
      out.clipped.push({ path: css(el), detail: 'unplanned horizontal scroll: content ' + el.scrollWidth + ' > box ' + el.clientWidth });
    }
    if ((cs.overflowX === 'hidden' || cs.overflowX === 'clip') && cs.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 1 && el.clientWidth >= 16) { // narrower boxes are sr-only
      out.clipped.push({ path: css(el), detail: 'overflow-x ' + cs.overflowX + ': content ' + el.scrollWidth + ' > box ' + el.clientWidth });
    }
  }
  // (b2) elements whose right edge is beyond the viewport or beyond a clipping ancestor.
  const vw = de.clientWidth;
  for (const el of document.querySelectorAll('main *')) {
    const cs = getComputedStyle(el);
    if (hidden(cs) || cs.position === 'fixed' || cs.position === 'sticky' && false) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (el.closest('[data-qa-scroll],[data-slot=scroll-area]') && el !== el.closest('[data-qa-scroll],[data-slot=scroll-area]')) continue;
    let anc = el.parentElement;
    while (anc && anc !== document.body) {
      const a = getComputedStyle(anc);
      if (a.overflowX !== 'visible') break;
      anc = anc.parentElement;
    }
    const limit = anc && anc !== document.body ? anc.getBoundingClientRect().right : vw;
    const scrollable = anc && anc !== document.body && (getComputedStyle(anc).overflowX === 'auto' || getComputedStyle(anc).overflowX === 'scroll');
    if (scrollable) continue; // intentional scroll container
    if (r.right > limit + 1 && r.right > 0) {
      out.clipped.push({ path: css(el), detail: 'right ' + Math.round(r.right) + ' > clip edge ' + Math.round(limit) + (anc && anc !== document.body ? ' (' + css(anc) + ')' : ' (viewport)') });
    }
  }
  // (c) edges: topbar inner box vs content column inner box vs banners.
  const inner = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return { left: r.left + parseFloat(s.paddingLeft) + parseFloat(s.borderLeftWidth), right: r.right - parseFloat(s.paddingRight) - parseFloat(s.borderRightWidth) };
  };
  const top = inner(document.querySelector('[data-qa=topbar-inner]') || document.querySelector('header'));
  const content = inner(document.querySelector('[data-qa=page-content]') || document.querySelector('.console-content'));
  const banners = [...document.querySelectorAll('[data-qa=banner-inner]')].map(inner);
  out.edges = { top, content, banners };
  // (d) ellipsis truncation with no title / aria-label on the element or an ancestor.
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (hidden(cs)) continue;
    const ell = cs.textOverflow === 'ellipsis' || cs.webkitLineClamp !== 'none' && cs.webkitLineClamp !== undefined && cs.display === '-webkit-box';
    if (ell && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) && !el.closest('[title],[aria-label],[data-slot=tooltip-trigger]')) {
      out.truncated.push({ path: css(el), text: (el.textContent || '').trim().slice(0, 40) });
    }
  }
  return out;
})()`;

async function login(cdp: Cdp, user: string, pass: string) {
  await cdp.send('Network.clearBrowserCookies');
  await cdp.send('Page.navigate', { url: `${BASE}/login` });
  await waitFor(async () => (await cdp.eval<string>('document.readyState')) === 'complete', 15000, 'login page');
  const status = await cdp.eval<number>(`fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:${JSON.stringify(user)},password:${JSON.stringify(pass)}})}).then(r=>r.status)`);
  if (status !== 200) throw new Error(`login as ${user} failed: ${status}`);
}

async function goto(cdp: Cdp, route: string) {
  await cdp.send('Page.navigate', { url: BASE + route });
  await waitFor(async () => (await cdp.eval<string>('document.readyState')) === 'complete', 15000, route);
  // Hydrated and data loaded: no skeleton left (Skeleton has data-slot=skeleton).
  await waitFor(async () => cdp.eval<boolean>(`!document.querySelector('[data-slot=skeleton],.animate-pulse') && (document.querySelector('main')||document.body).innerText.length > 20`), 15000, `${route} data`).catch(() => undefined);
  await sleep(400);
}

async function measure(cdp: Cdp, tag: string, role: string, width: number, shot: string) {
  // QA_SELFTEST=1 injects known violations so the detectors can be shown to fail (expect contrast, card-alignment, wrapped-control, no-focus-indicator).
  if (process.env.QA_SELFTEST) {
    await cdp.eval(`(() => { const d = document.createElement('div'); d.innerHTML = '<p style="color:#445566;background:#334455;font-size:14px">low contrast sample</p><div style="display:grid;grid-template-columns:1fr 1fr"><div data-slot="card" style="height:50px"><div data-slot="card-title">a</div></div><div data-slot="card" style="height:90px"><div data-slot="card-title">b</div></div></div><button style="width:40px;border:1px solid red">two words here</button><button id="qa-noring" style="outline:none;box-shadow:none">no ring</button>'; (document.querySelector('main') || document.body).prepend(d); })()`);
  }
  const m = await cdp.eval<any>(MEASURE);
  const where = `${role} ${tag} @${width}`;
  if (m.docClip) defects.push({ kind: 'doc-scroll-x', where, detail: m.docClip });
  for (const c of m.clipped.slice(0, 6)) defects.push({ kind: 'clipped', where, detail: `${c.path} — ${c.detail}` });
  if (m.clipped.length > 6) defects.push({ kind: 'clipped', where, detail: `…and ${m.clipped.length - 6} more` });
  const { top, content, banners } = m.edges;
  if (top && content) {
    const dl = Math.abs(top.left - content.left), dr = Math.abs(top.right - content.right);
    if (dl > 1 || dr > 1) defects.push({ kind: 'edge-misaligned', where, detail: `topbar ${Math.round(top.left)}..${Math.round(top.right)} vs content ${Math.round(content.left)}..${Math.round(content.right)}` });
  }
  for (const b of banners) {
    if (content && (Math.abs(b.left - content.left) > 1 || Math.abs(b.right - content.right) > 1)) defects.push({ kind: 'edge-misaligned', where, detail: `banner ${Math.round(b.left)}..${Math.round(b.right)} vs content` });
  }
  for (const t of m.truncated.slice(0, 5)) defects.push({ kind: 'truncated-no-title', where, detail: `${t.path} "${t.text}"` });
  const x = await cdp.eval<any>(EXTRA);
  for (const c of x.cards) defects.push({ kind: 'card-alignment', where, detail: `${c.path} — ${c.detail}` });
  for (const w of x.wraps.slice(0, 5)) defects.push({ kind: 'wrapped-control', where, detail: `${w.path} "${w.text}"` });
  for (const r of x.rows.slice(0, 3)) defects.push({ kind: 'row-too-short', where, detail: `${r.path} ${r.h}px` });
  for (const z of x.sizes) defects.push({ kind: 'off-scale-font', where, detail: `${z.size}px ${z.path} "${z.text}"` });
  for (const i of x.icons) defects.push({ kind: 'icon-not-16', where, detail: `${i.size} ${i.path}` });
  for (const c of x.contrast.slice(0, 8)) defects.push({ kind: 'contrast', where, detail: `${c.ratio}:1 < ${c.need} (${c.size}px) ${c.path} "${c.text}"` });
  const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(shot, Buffer.from(png.data, 'base64'));
}

/** Tab through the first controls and require a visible focus indicator (outline or ring) on each. */
async function checkFocus(cdp: Cdp, route: string, role: string) {
  await goto(cdp, route);
  if (process.env.QA_SELFTEST) await cdp.eval(`(() => { const b = document.createElement('button'); b.textContent = 'selftest no ring'; b.style.cssText = 'outline:none;box-shadow:none'; document.body.prepend(b); })()`);
  await cdp.eval('document.activeElement && document.activeElement.blur(); window.scrollTo(0,0)');
  for (let i = 0; i < 14; i++) {
    for (const type of ['keyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    const f = await cdp.eval<any>(`(() => { const e = document.activeElement; if (!e || e === document.body) return null; const s = getComputedStyle(e); const r = e.getBoundingClientRect();
      return { tag: e.tagName.toLowerCase(), label: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30), outline: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2, ring: s.boxShadow !== 'none', vis: r.width > 0 && r.height > 0 }; })()`);
    if (f && f.vis && !f.outline && !f.ring) defects.push({ kind: 'no-focus-indicator', where: `${role} ${route} tab#${i + 1}`, detail: `${f.tag} "${f.label}"` });
  }
}

async function runRole(cdp: Cdp, role: string, user: string, pass: string, routes: string[]) {
  await login(cdp, user, pass);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 768, deviceScaleFactor: 1, mobile: false });
  for (const r of routes.filter(r => !r.includes('?'))) await checkFocus(cdp, r, role);
  for (const w of WIDTHS) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: HEIGHT(w), deviceScaleFactor: 1, mobile: false });
    for (const route of routes) {
      await goto(cdp, route);
      const slug = route.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root';
      await measure(cdp, route, role, w, path.join(OUT, `${role}_${slug}_${w}.png`));
      if (/^\/teams\/[^/]+$/.test(route)) {
        const n = await cdp.eval<number>(`document.querySelectorAll('[role=tab]').length`);
        for (let i = 0; i < n; i++) {
          const label = await cdp.eval<string>(`(() => { const t = document.querySelectorAll('[role=tab]')[${i}]; t.click(); return t.textContent.trim(); })()`);
          await sleep(500);
          await measure(cdp, `${route}[tab:${label}]`, role, w, path.join(OUT, `${role}_${slug}_tab${i}_${w}.png`));
        }
      }
    }
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) fs.rmSync(path.join(OUT, f));

  const seed = spawnSync('npx', ['tsx', '--tsconfig', 'tsconfig.scripts.json', 'scripts/seed.ts'], { env, shell: true, encoding: 'utf8' });
  if (seed.status !== 0) { console.error(seed.stdout, seed.stderr); throw new Error('seed failed'); }

  const server = spawn('npx', ['next', 'start', '-p', String(PORT)], { env, shell: true, stdio: ['ignore', fs.openSync(path.join(tmp, 'server.log'), 'a'), fs.openSync(path.join(tmp, 'server.log'), 'a')] });
  procs.push(server);
  await waitFor(async () => { const r = await fetch(`${BASE}/api/meta`); if (!r.ok) console.error("meta", r.status, (await r.text()).slice(0, 300)); return r.ok; }, 30000, "next start");

  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${path.join(tmp, 'chrome')}`, '--hide-scrollbars=false', 'about:blank'], { stdio: 'ignore' });
  procs.push(chrome);
  await waitFor(async () => (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).ok, 30000, 'chrome');

  const cdp = await Cdp.connect();
  // /login has no console shell: only the document-level checks apply.
  for (const w of WIDTHS) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: HEIGHT(w), deviceScaleFactor: 1, mobile: false });
    await cdp.send('Network.clearBrowserCookies');
    await cdp.send('Page.navigate', { url: `${BASE}/login` });
    await waitFor(async () => (await cdp.eval<string>('document.readyState')) === 'complete', 15000, '/login');
    await sleep(400);
    await measure(cdp, '/login', 'anon', w, path.join(OUT, `anon_login_${w}.png`));
  }
  await runRole(cdp, 'admin', 'admin', ADMIN_PASS, ROUTES_ADMIN);
  // Frozen state: the third banner must align with the others and the layout must still pass.
  await login(cdp, 'admin', ADMIN_PASS);
  const frz = await cdp.eval<number>(`fetch('/api/settings/freeze',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({frozen:true,confirm:'FREEZE'})}).then(r=>r.status)`);
  if (frz !== 200) throw new Error(`freeze failed: ${frz}`);
  await runRole(cdp, 'admin-frozen', 'admin', ADMIN_PASS, ['/overview', '/teams', '/settings']);
  await cdp.eval(`fetch('/api/settings/freeze',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({frozen:false})}).then(r=>r.status)`);
  await runRole(cdp, 'operator', 'operator', OP_PASS, ROUTES_OPERATOR);
  if (cdp.consoleErrors.length) for (const e of new Set(cdp.consoleErrors)) defects.push({ kind: 'console', where: 'any', detail: e.slice(0, 200) });
  cdp.close();

  // De-duplicate and print.
  const seen = new Set<string>();
  const rows = defects.filter(d => { const k = `${d.kind}|${d.where}|${d.detail}`; if (seen.has(k)) return false; seen.add(k); return true; });
  console.log(`\nqa:layout — widths ${WIDTHS.join(',')}; screenshots in ${path.relative(process.cwd(), OUT)}`);
  if (rows.length === 0) { console.log('PASS: no horizontal clipping, edge misalignment or untitled truncation.'); return; }
  console.log(`FAIL: ${rows.length} defect(s)\n`);
  const byKind = new Map<string, Defect[]>();
  for (const d of rows) byKind.set(d.kind, [...(byKind.get(d.kind) ?? []), d]);
  for (const [k, list] of byKind) {
    console.log(`## ${k} (${list.length})`);
    // Group identical details across routes/widths so the table stays readable.
    const g = new Map<string, string[]>();
    const keyOf = (d: Defect) => (k === 'doc-scroll-x' || k === 'icon-not-16' || k === 'off-scale-font' ? d.detail : d.detail.replace(/\d+/g, '#'));
    for (const d of list) g.set(keyOf(d), [...(g.get(keyOf(d)) ?? []), d.where]);
    for (const [detail, wheres] of [...g].slice(0, 40)) console.log(`- x${wheres.length} ${detail}  e.g. ${wheres[0]}${wheres.length > 1 ? ' ; ' + wheres[wheres.length - 1] : ''}`);
  }
  process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => { cleanup(); process.exit(process.exitCode ?? 0); });
