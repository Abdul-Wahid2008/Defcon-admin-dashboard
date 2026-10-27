import 'server-only';
import { z } from 'zod';
import { AppError } from '../../errors';

/**
 * Typed HTTP client for the lifecycle agent proposed in docs/15 §3 (PROPOSAL, UNCONFIRMED: no agent exists yet; it is
 * only tested against scripts/fake-agent.ts). Bearer auth, 10 s default timeout, retries only idempotent GETs,
 * zod-validated responses. Every failure becomes ADAPTER_ERROR with a generic message: no URL, token or response text.
 */

const TEAM_ID = /^team-\d{2}$/;
const SERVICE_KEY = /^[a-z0-9][a-z0-9-]*$/;

const Capabilities = z.object({
  resetKind: z.enum(['recreate_pristine', 'restart', 'restore_patch']),
  serviceLevelReset: z.boolean(),
});
const JobAccepted = z.object({ jobId: z.string().min(1).max(128), status: z.enum(['queued', 'running']) });
const Job = z.object({
  jobId: z.string(),
  status: z.enum(['queued', 'running', 'succeeded', 'failed']),
  startedAt: z.string().nullish(),
  finishedAt: z.string().nullish(),
  error: z.string().max(500).nullish(),
});
const Status = z.object({
  state: z.enum(['running', 'stopped', 'degraded', 'absent']),
  containers: z.array(z.object({ name: z.string(), state: z.string() })),
  memoryMb: z.number(),
  cpuPct: z.number(),
});

export type AgentCapabilities = z.infer<typeof Capabilities>;
export type AgentJob = z.infer<typeof Job>;
export type AgentStatus = z.infer<typeof Status>;
export type AgentTeamAction = 'start' | 'stop' | 'reset';

export interface AgentClientOptions {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Extra attempts for GET requests only. */
  getRetries?: number;
}

function adapterError(reason: string, details?: Record<string, unknown>): AppError {
  return new AppError('ADAPTER_ERROR', `The lifecycle agent request failed (${reason}).`, details);
}

export class AgentClient {
  private readonly base: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly getRetries: number;

  constructor(private readonly opts: AgentClientOptions) {
    this.base = opts.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.getRetries = opts.getRetries ?? 1;
  }

  private teamPath(teamId: string): string {
    if (!TEAM_ID.test(teamId)) throw new AppError('VALIDATION_ERROR', 'Invalid team id for the agent.');
    return `/v1/teams/${teamId}`;
  }

  private async request<T>(method: 'GET' | 'POST', path: string, schema: z.ZodType<T>, headers: Record<string, string> = {}): Promise<T> {
    const attempts = method === 'GET' ? 1 + this.getRetries : 1; // POST is never retried here: Idempotency-Key replay is the caller's decision
    let lastReason = 'network_error';
    for (let attempt = 0; attempt < attempts; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(`${this.base}${path}`, {
          method,
          redirect: 'error',
          credentials: 'omit',
          cache: 'no-store',
          headers: { accept: 'application/json', authorization: `Bearer ${this.opts.token}`, ...headers },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (e) {
        const name = (e as { name?: string }).name;
        lastReason = name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network_error';
        continue;
      }
      if (res.status >= 500) { lastReason = `http_${res.status}`; continue; }
      if (res.status === 404) throw new AppError('NOT_FOUND', 'The lifecycle agent does not know this team or job.');
      if (!res.ok) throw adapterError(`http_${res.status}`);
      let json: unknown;
      try { json = await res.json(); } catch { throw adapterError('invalid_json'); }
      const parsed = schema.safeParse(json);
      if (!parsed.success) throw adapterError('invalid_response');
      return parsed.data;
    }
    throw adapterError(lastReason);
  }

  capabilities(): Promise<AgentCapabilities> {
    return this.request('GET', '/v1/capabilities', Capabilities);
  }

  async status(teamId: string): Promise<AgentStatus> {
    return this.request('GET', `${this.teamPath(teamId)}/status`, Status);
  }

  async job(jobId: string): Promise<AgentJob> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(jobId)) throw new AppError('VALIDATION_ERROR', 'Invalid job id.');
    return this.request('GET', `/v1/jobs/${jobId}`, Job);
  }

  async teamAction(teamId: string, action: AgentTeamAction, idempotencyKey: string) {
    return this.request('POST', `${this.teamPath(teamId)}/${action}`, JobAccepted, { 'idempotency-key': idempotencyKey });
  }

  async serviceAction(teamId: string, serviceKey: string, kind: 'restart' | 'reset', idempotencyKey: string) {
    if (!SERVICE_KEY.test(serviceKey)) throw new AppError('VALIDATION_ERROR', 'Invalid service key for the agent.');
    return this.request('POST', `${this.teamPath(teamId)}/services/${serviceKey}/${kind}`, JobAccepted, { 'idempotency-key': idempotencyKey });
  }
}
