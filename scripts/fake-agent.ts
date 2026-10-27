/**
 * In-process stand-in for the lifecycle agent proposed in docs/15 §3 (PROPOSAL; no real agent exists).
 * Used by tests and for local rehearsal:  npx tsx scripts/fake-agent.ts   (PORT=3300 AGENT_TOKEN=... JOB_MS=3000)
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeAgentOptions {
  token: string;
  /** How long a job stays "running" before it resolves. */
  jobMs?: number;
  resetKind?: 'recreate_pristine' | 'restart' | 'restore_patch';
  serviceLevelReset?: boolean;
}

export interface FakeAgent {
  url: string;
  port: number;
  requests: { method: string; path: string; idempotencyKey: string | null; authorized: boolean }[];
  /** Next job (any kind) ends as failed with this message. */
  failNext(message: string): void;
  /** Respond with this HTTP status to every request until cleared (null). */
  respondWith(status: number | null): void;
  /** Respond with a body that does not match the contract. */
  garbage(on: boolean): void;
  /** Delay every response by ms (for timeout tests). */
  delay(ms: number): void;
  close(): Promise<void>;
}

export async function startFakeAgent(options: FakeAgentOptions, port = 0): Promise<FakeAgent> {
  const jobMs = options.jobMs ?? 50;
  const jobs = new Map<string, { startedAt: number; fail?: string }>();
  const byKey = new Map<string, string>();
  const requests: FakeAgent['requests'] = [];
  let failMessage: string | null = null;
  let forced: number | null = null;
  let garbage = false;
  let delayMs = 0;
  let seq = 0;

  const server = http.createServer(async (req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    const authorized = req.headers.authorization === `Bearer ${options.token}`;
    const key = (req.headers['idempotency-key'] as string | undefined) ?? null;
    requests.push({ method: req.method ?? 'GET', path, idempotencyKey: key, authorized });
    if (delayMs) await new Promise(r => setTimeout(r, delayMs));
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (forced) return send(forced, { error: { code: 'FORCED', message: 'forced' } });
    if (!authorized) return send(401, { error: { code: 'UNAUTHORIZED', message: 'bad token' } });
    if (garbage) return send(200, { surprise: true });

    if (req.method === 'GET' && path === '/v1/capabilities') {
      return send(200, { resetKind: options.resetKind ?? 'recreate_pristine', serviceLevelReset: options.serviceLevelReset ?? true });
    }
    let m = /^\/v1\/jobs\/([A-Za-z0-9_-]+)$/.exec(path);
    if (req.method === 'GET' && m) {
      const job = jobs.get(m[1]);
      if (!job) return send(404, { error: { code: 'NOT_FOUND', message: 'no such job' } });
      const done = Date.now() - job.startedAt >= jobMs;
      return send(200, {
        jobId: m[1],
        status: !done ? 'running' : job.fail ? 'failed' : 'succeeded',
        startedAt: new Date(job.startedAt).toISOString(),
        finishedAt: done ? new Date(job.startedAt + jobMs).toISOString() : null,
        ...(done && job.fail ? { error: job.fail } : {}),
      });
    }
    m = /^\/v1\/teams\/(team-\d{2})\/status$/.exec(path);
    if (req.method === 'GET' && m) {
      return send(200, { state: 'running', containers: [{ name: `${m[1]}-web`, state: 'running' }], memoryMb: 300, cpuPct: 12 });
    }
    m = /^\/v1\/teams\/(team-\d{2})\/(start|stop|reset)$/.exec(path) ?? /^\/v1\/teams\/(team-\d{2})\/services\/([a-z0-9-]+)\/(restart|reset)$/.exec(path);
    if (req.method === 'POST' && m) {
      if (key && byKey.has(key)) return send(202, { jobId: byKey.get(key), status: 'running' }); // idempotent replay
      const jobId = `job_${++seq}`;
      jobs.set(jobId, { startedAt: Date.now(), fail: failMessage ?? undefined });
      failMessage = null;
      if (key) byKey.set(key, jobId);
      return send(202, { jobId, status: 'queued' });
    }
    return send(404, { error: { code: 'NOT_FOUND', message: 'unknown route' } });
  });

  await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
  const actual = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${actual}`,
    port: actual,
    requests,
    failNext: (message) => { failMessage = message; },
    respondWith: (status) => { forced = status; },
    garbage: (on) => { garbage = on; },
    delay: (ms) => { delayMs = ms; },
    close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}

// CLI: only when run directly.
if (process.argv[1] && /fake-agent\.ts$/.test(process.argv[1])) {
  const token = process.env.AGENT_TOKEN ?? 'fake-agent-token-fake-agent-token-0000';
  void startFakeAgent({ token, jobMs: Number(process.env.JOB_MS ?? 3000) }, Number(process.env.PORT ?? 3300)).then(a => {
    console.log(`fake agent on ${a.url} (token from AGENT_TOKEN, default fake-agent-token-fake-agent-token-0000)`);
  });
}
