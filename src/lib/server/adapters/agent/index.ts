import 'server-only';
import { dbHelper } from '../../db';
import { loadConfig } from '../../../config';
import { ttydPort } from '../../../event-config';
import { AppError } from '../../errors';
import { MockAdapter } from '../mock';
import type {
  ActionResponse,
  CompletedTransition,
  LifecycleAction,
  ServiceActionKind,
  ServiceActionResponse,
} from '../types';
import { AgentClient } from './client';
import { appendCompletionAudits } from '../../audit';

// Estimated duration shown in the UI while an agent job runs; the job status, not this clock, decides completion.
const ESTIMATE_MS = 60_000;
const JOB_TIMEOUT_MS = 10 * 60_000;
const POLL_GAP_MS = 2_000;
const CAPS_REFRESH_MS = 60_000;

export interface AgentAdapterOptions {
  baseUrl: string;
  token: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  nowFn?: () => string;
}

function safeReason(text: string | null | undefined, fallback: string): string {
  // The agent's text is untrusted: strip control characters and cap the length before it is stored or shown.
  const cleaned = (text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200);
  return cleaned || fallback;
}

/**
 * Lifecycle through the allow-listed agent (docs/15 §3, PROPOSAL). Roster, participants, notes and health reading stay
 * in the dashboard database (inherited from MockAdapter). Lifecycle transitions and service actions are real agent jobs
 * that complete when the job reports success or failure, never by the mock clock. Resource numbers and session counts
 * are still MOCK-derived (flagged isMock); the badge stays PARTIAL until the one-team evidence gate (W8).
 */
export class AgentAdapter extends MockAdapter {
  override readonly mode = 'real' as const;
  private readonly client: AgentClient;
  private capsCheckedAt = 0;
  private readonly polledAt = new Map<string, number>();
  private readonly inFlight = new Set<string>();

  constructor(opts: AgentAdapterOptions) {
    super(opts.nowFn);
    this.client = new AgentClient({ baseUrl: opts.baseUrl, token: opts.token, timeoutMs: opts.timeoutMs, fetchImpl: opts.fetchImpl });
    // Conservative until the agent answers GET /v1/capabilities.
    this.capabilities = { ...this.capabilities, resetKind: 'recreate_pristine', serviceLevelReset: false };
  }

  protected override terminalUrlFor(teamId: string): string | null {
    const template = loadConfig().terminalUrlTemplate;
    const seq = dbHelper.get<{ seq: number }>(`SELECT seq FROM teams WHERE id = ?`, teamId)?.seq;
    if (!template || seq === undefined) return null;
    return template.replaceAll('{port}', String(ttydPort(seq))).replaceAll('{team}', teamId);
  }

  async refreshCapabilities(force = false): Promise<void> {
    const nowMs = Date.parse(this.now());
    if (!force && nowMs - this.capsCheckedAt < CAPS_REFRESH_MS) return;
    this.capsCheckedAt = nowMs;
    try {
      const caps = await this.client.capabilities();
      this.capabilities = { ...this.capabilities, resetKind: caps.resetKind, serviceLevelReset: caps.serviceLevelReset };
    } catch {
      // keep the previous (conservative) capabilities
    }
  }

  /** Completion is decided by agent jobs in resolveDue(); the synchronous clock-based path must never complete anything. */
  override resolveDueForSync(): CompletedTransition[] {
    return [];
  }

  override async resolveDue(): Promise<CompletedTransition[]> {
    await this.refreshCapabilities();
    const nowIso = this.now();
    const nowMs = Date.parse(nowIso);
    const pending = dbHelper.all<any>(`SELECT * FROM environments WHERE pending_action IS NOT NULL AND pending_job_id IS NOT NULL`);
    const completed: CompletedTransition[] = [];
    for (const env of pending) {
      const last = this.polledAt.get(env.pending_job_id) ?? 0;
      if (nowMs - last < POLL_GAP_MS) continue;
      this.polledAt.set(env.pending_job_id, nowMs);
      try {
        const job = await this.client.job(env.pending_job_id);
        if (job.status === 'succeeded') {
          completed.push(...this.finishPending(env, 'success', undefined, nowIso));
        } else if (job.status === 'failed') {
          completed.push(...this.finishPending(env, 'failure', safeReason(job.error, `${env.pending_action} failed (agent job failed)`), nowIso));
        } else if (nowMs - Date.parse(env.pending_started_at) > JOB_TIMEOUT_MS) {
          completed.push(...this.finishPending(env, 'failure', 'Timed out waiting for the agent job.', nowIso));
        }
      } catch (e) {
        if (e instanceof AppError && e.code === 'NOT_FOUND') {
          completed.push(...this.finishPending(env, 'failure', 'The agent no longer knows this job.', nowIso));
        } else if (nowMs - Date.parse(env.pending_started_at) > JOB_TIMEOUT_MS) {
          completed.push(...this.finishPending(env, 'failure', 'The agent was unreachable for 10 minutes.', nowIso));
        }
        // otherwise: transient error, keep the pending state and try again on the next sync
      }
      if (completed.some(c => c.teamId === env.team_id)) this.polledAt.delete(env.pending_job_id);
    }
    return completed;
  }

  override async requestAction(
    teamId: string,
    action: LifecycleAction,
    ctx: { correlationId: string },
  ): Promise<ActionResponse | { noop: true; reason: string }> {
    if (action === 'delete') {
      // docs/15 §3 defines no delete endpoint; refuse rather than archive a team whose containers still exist.
      throw new AppError('ADAPTER_ERROR', 'The lifecycle agent contract has no delete operation yet.');
    }
    return this.guarded(teamId, async () => {
      const env = dbHelper.get<any>(`SELECT * FROM environments WHERE team_id = ?`, teamId);
      if (!env) throw new AppError('NOT_FOUND', `Team ${teamId} not found.`);
      if (env.pending_action) throw new AppError('ACTION_IN_PROGRESS', 'Another action is already running for this team.');
      const t = this.getTransition(env.lifecycle_state, action);
      if (t.type === 'noop') return { noop: true as const, reason: t.reason! };
      if (t.type === 'invalid') throw new AppError('INVALID_TRANSITION', `Cannot ${action} from ${env.lifecycle_state}.`);

      const job = await this.client.teamAction(teamId, action, ctx.correlationId); // throws ADAPTER_ERROR; nothing committed yet
      const response = await super.requestAction(teamId, action, ctx);
      if ('noop' in response) return response;
      const endsAt = new Date(Date.parse(response.transition.startedAt) + ESTIMATE_MS).toISOString();
      dbHelper.run(`UPDATE environments SET pending_job_id = ?, pending_ends_at = ? WHERE team_id = ?`, job.jobId, endsAt, teamId);
      return { ...response, transition: { ...response.transition, estimatedEndsAt: endsAt } };
    });
  }

  /**
   * A new team is provisioned by asking the agent to start it (the agent contract has no separate provision call;
   * docs/15 §3 PROPOSAL). The provisioning transition completes when that job does. If the agent refuses, the
   * environment fails immediately with a visible reason instead of pretending to provision.
   */
  override async createTeam(input: Parameters<MockAdapter['createTeam']>[0]) {
    const result = await super.createTeam(input);
    const teamId = result.team.id;
    const env = dbHelper.get<any>(`SELECT * FROM environments WHERE team_id = ?`, teamId)!;
    const nowIso = this.now();
    try {
      const job = await this.client.teamAction(teamId, 'start', env.pending_correlation_id);
      const endsAt = new Date(Date.parse(nowIso) + ESTIMATE_MS).toISOString();
      dbHelper.run(`UPDATE environments SET pending_job_id = ?, pending_ends_at = ? WHERE team_id = ?`, job.jobId, endsAt, teamId);
      return { ...result, team: (await this.getTeam(teamId))!, completionDueAt: endsAt };
    } catch {
      appendCompletionAudits(this.finishPending(env, 'failure', 'The agent did not accept provisioning for this team.', nowIso));
      return { ...result, team: (await this.getTeam(teamId))! };
    }
  }

  override async requestServiceAction(
    teamId: string,
    serviceKey: string,
    kind: ServiceActionKind,
    ctx: { correlationId: string },
  ): Promise<ServiceActionResponse> {
    if (!this.capabilities.serviceLevelReset) throw new AppError('CONFLICT', 'The agent does not support service-level actions.');
    return this.guarded(teamId, async () => {
      this.assertServiceActionAllowed(teamId, serviceKey);
      const job = await this.client.serviceAction(teamId, serviceKey, kind, ctx.correlationId);
      const response = await super.requestServiceAction(teamId, serviceKey, kind, ctx);
      const endsAt = new Date(Date.parse(response.startedAt) + ESTIMATE_MS).toISOString();
      dbHelper.run(`UPDATE environments SET pending_job_id = ?, pending_ends_at = ? WHERE team_id = ?`, job.jobId, endsAt, teamId);
      return { ...response, estimatedEndsAt: endsAt };
    });
  }

  /** One agent request per team at a time, so two racing requests cannot create two jobs for one pending slot. */
  private async guarded<T>(teamId: string, fn: () => Promise<T>): Promise<T> {
    if (this.inFlight.has(teamId)) throw new AppError('ACTION_IN_PROGRESS', 'Another action is already running for this team.');
    this.inFlight.add(teamId);
    try { return await fn(); } finally { this.inFlight.delete(teamId); }
  }
}
