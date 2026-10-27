import 'server-only';
import { dbHelper } from '../db';
import {
  EnvironmentAdapter,
  LifecycleAction,
  LifecycleState,
  TeamSummary,
  TeamDetail,
  CreateTeamInput,
  UpdateTeamInput,
  IssuedCredential,
  Participant,
  ActionResponse,
  CompletedTransition,
  HealthSnapshot,
  OverviewData,
  Alert,
  Page,
  TeamQuery,
  Health,
  Service,
  FlagstoreKey,
  FlagstoreVerdict,
  AdapterCapabilities,
  ServiceActionResponse,
} from './types';
import { getEventConfig, servicePort, ttydPort, teamCapWarning } from '../../event-config';
import { MOCK_DURATIONS, loadConfig } from '../../config';
import { getHealthSourceStatus, isStale, pullIfDue } from '../health/source';
import { getEventClock } from '../services/event';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

export class MockAdapter implements EnvironmentAdapter {
  readonly mode: 'mock' | 'real' = 'mock'; // 'real' only in the AgentAdapter subclass
  capabilities: AdapterCapabilities = {
    // Test-only switch for browser QA of the three reset dialogs; ignored in production builds. Never documented as a feature.
    resetKind: process.env.NODE_ENV !== 'production' && ['recreate_pristine', 'restart'].includes(process.env.MOCK_RESET_KIND_TEST_ONLY ?? '')
      ? (process.env.MOCK_RESET_KIND_TEST_ONLY as 'recreate_pristine' | 'restart')
      : 'restore_patch',
    serviceLevelReset: true, // MOCK: service actions are simulated on the same pending slot
    terminalMode: getEventConfig().terminalMode,
    flagstores: getEventConfig().services[0].flagstores,
    fullyReal: false,
  };
  private nowFn: () => string;

  constructor(nowFn?: () => string) {
    this.nowFn = nowFn || (() => new Date().toISOString());
  }

  protected now(): string {
    return this.nowFn();
  }

  /** True when checks come from a real source: mock writers below must then leave them alone. */
  private realHealth(): boolean {
    return loadConfig().healthSource !== 'mock';
  }

  /** MOCK: a fake `.invalid` URL. The agent adapter overrides this with TERMINAL_URL_TEMPLATE. Never logged or audited. */
  protected terminalUrlFor(teamId: string): string | null {
    return `https://${teamId}-${crypto.randomBytes(2).toString('hex')}.terminal.invalid/`;
  }

  private generatePassword(): string {
    const charset = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let res = '';
    for (let i = 0; i < 12; i++) {
      res += charset[crypto.randomInt(0, charset.length)];
    }
    return res;
  }

  private pad2(n: number): string {
    return n.toString().padStart(2, '0');
  }

  /** Generate a deterministic resource usage based on teamId and time bucket */
  private deriveResources(teamId: string): {
    cpu: { usedPct: number; limitCores: number };
    memory: { usedMb: number; limitMb: number };
    processes: { used: number; limit: number };
    storage: { usedMb: number; limitMb: number };
    isMock: boolean;
  } {
    const bucket = Math.floor(Date.now() / 5000);
    const seed = Buffer.from(teamId + bucket).reduce((a, b) => a * 31 + b, 0);
    const pseudo = (offset: number) => {
      const v = Math.abs(Math.sin(seed + offset)) ;
      return v - Math.floor(v);
    };
    return {
      cpu: { usedPct: Math.round(8 + pseudo(1) * 62), limitCores: 1 },
      memory: { usedMb: Math.round(204 + pseudo(2) * 563), limitMb: 1024 },
      processes: { used: Math.round(38 + pseudo(3) * 118), limit: 256 },
      storage: { usedMb: Math.round(204 + pseudo(4) * 1230), limitMb: 2048 },
      isMock: true,
    };
  }

  private deriveActiveSessions(teamId: string): number {
    const bucket = Math.floor(Date.now() / 30000);
    const seed = Buffer.from(teamId + bucket).reduce((a, b) => a * 31 + b, 0);
    return Math.abs(seed) % 7; // 0-6
  }

  private deriveHealth(lifecycleState: LifecycleState, services: Service[]): Health {
    if (lifecycleState !== 'running') return 'unknown';
    const reachFail = services.some(s =>
      s.checks.some(c => c.type === 'reachability' && c.status === 'fail')
    );
    if (reachFail) return 'down';
    const funcFail = services.some(s =>
      s.checks.some(c => c.type === 'functional' && c.status === 'fail')
    );
    if (funcFail) return 'degraded';
    const anyUnknown = services.some(s =>
      s.checks.some(c => c.status === 'unknown')
    );
    if (anyUnknown) return 'unknown';
    return 'healthy';
  }

  private buildTeamDetail(team: any, env: any, participants: any[], services: Service[]): TeamDetail {
    const health = this.deriveHealth(env.lifecycle_state as LifecycleState, services);
    const activeParticipants = participants.filter(p => p.active);

    const terminal = (env.lifecycle_state === 'running' && env.terminal_url)
      ? { kind: 'ttyd' as const, mode: getEventConfig().terminalMode, port: ttydPort(team.seq), url: env.terminal_url, isMock: this.mode !== 'real' }
      : null;

    const pending = env.pending_action ? {
      action: env.pending_action as NonNullable<TeamDetail['environment']['pending']>['action'],
      ...(env.pending_service_key ? { serviceKey: env.pending_service_key as string } : {}),
      correlationId: env.pending_correlation_id,
      from: env.pending_from_state as LifecycleState,
      to: env.pending_to_state as LifecycleState,
      startedAt: env.pending_started_at,
      estimatedEndsAt: env.pending_ends_at,
    } : null;

    const resources = env.lifecycle_state === 'running' ? this.deriveResources(team.id) : null;
    const activeSessions = env.lifecycle_state === 'running' ? this.deriveActiveSessions(team.id) : 0;

    const lastDeploy = (env.last_deploy_result && env.last_deploy_at) ? {
      version: env.accepted_patch_version,
      result: env.last_deploy_result as 'accepted' | 'rejected' | 'rolled_back',
      at: env.last_deploy_at,
    } : null;

    return {
      id: team.id,
      name: team.name,
      accountStatus: team.account_status,
      lifecycleState: env.lifecycle_state,
      health,
      pending,
      participantCount: activeParticipants.length,
      updatedAt: team.updated_at,
      notes: team.notes,
      createdAt: team.created_at,
      participants: participants.map(p => ({
        id: p.id,
        name: p.name,
        username: p.username,
        credentialIssuedAt: p.credential_issued_at,
        credentialVersion: p.credential_version,
        active: Boolean(p.active),
      })),
      environment: {
        lifecycleState: env.lifecycle_state,
        health,
        pending,
        acceptedPatchVersion: env.accepted_patch_version,
        lastDeploy,
        services,
        resources,
        activeSessions,
        terminal,
        failureReason: env.failure_reason,
        lastActionAt: env.last_action_at,
        lastHealthCheckAt: env.last_health_check_at,
        lastServiceAction: env.last_service_action_json ? JSON.parse(env.last_service_action_json) : null,
      },
    };
  }

  private loadServicesForTeam(teamId: string): Service[] {
    const rows = dbHelper.all<any>(
      `SELECT s.key, s.name, s.port, s.placeholder,
              c.check_type, c.status, c.detail, c.last_checked_at
       FROM services s
       LEFT JOIN checks c ON c.team_id = s.team_id AND c.service_key = s.key
       WHERE s.team_id = ?
       ORDER BY s.key, c.check_type`,
      teamId
    );

    const serviceMap = new Map<string, Service>();
    for (const row of rows) {
      if (!serviceMap.has(row.key)) {
        serviceMap.set(row.key, {
          key: row.key,
          name: row.name,
          port: row.port,
          placeholder: Boolean(row.placeholder),
          checks: [],
        });
      }
      if (row.check_type) {
        serviceMap.get(row.key)!.checks.push({
          type: row.check_type,
          status: row.status,
          detail: row.detail,
          lastCheckedAt: row.last_checked_at,
        });
      }
    }
    const flagRows = dbHelper.all<{ service_key: string; flagstore: FlagstoreKey; verdict: FlagstoreVerdict; message: string | null; round: number | null; checked_at: string | null }>(
      `SELECT service_key, flagstore, verdict, message, round, checked_at
       FROM flagstore_results WHERE team_id = ? ORDER BY service_key, flagstore`,
      teamId
    );
    for (const f of flagRows) {
      const svc = serviceMap.get(f.service_key);
      if (!svc) continue;
      (svc.flagstores ??= []).push({
        key: f.flagstore, verdict: f.verdict, message: f.message, round: f.round, checkedAt: f.checked_at,
      });
    }
    const services = Array.from(serviceMap.values());
    if (this.realHealth()) {
      const nowMs = Date.parse(this.now());
      for (const svc of services) {
        const lastChecked = svc.checks.map(c => c.lastCheckedAt).filter((t): t is string => !!t).sort().pop() ?? null;
        if (!isStale(lastChecked, nowMs)) continue;
        svc.stale = true;
        svc.checks = svc.checks.map(c => ({ ...c, status: 'unknown', detail: 'stale' }));
        // a stale flagstore verdict must not read as OK to a client that ignores svc.stale
        if (svc.flagstores) svc.flagstores = svc.flagstores.map(f => ({ ...f, verdict: 'UNKNOWN' as FlagstoreVerdict }));
      }
    }
    return services;
  }

  /** Resolve any due transitions for a specific team (synchronous, called inside transactions) */
  resolveDueForSync(teamId: string): CompletedTransition[] {
    const nowTs = this.now();
    const env = dbHelper.get<any>(
      `SELECT * FROM environments WHERE team_id = ? AND pending_action IS NOT NULL AND pending_ends_at <= ?`,
      teamId, nowTs
    );
    if (!env) return [];
    return this.finishPending(env, env.fail_next_action === env.pending_action ? 'failure' : 'success');
  }

  /**
   * Completes the single pending transition of an environment. Shared by the lazy mock clock and the agent adapter
   * (which decides success/failure from the job status). `tsOverride` is the completion time; default = scheduled end.
   */
  protected finishPending(
    env: any,
    outcome: 'success' | 'failure',
    reasonOverride?: string,
    tsOverride?: string,
  ): CompletedTransition[] {
    const teamId = env.team_id as string;
    const action = env.pending_action as CompletedTransition['action'];
    const correlationId = env.pending_correlation_id;
    const toState = env.pending_to_state as LifecycleState;
    const endsAt = tsOverride ?? env.pending_ends_at;

    // Service-level actions never change the lifecycle state; they only free the pending slot.
    if (action === 'service_restart' || action === 'service_reset') {
      dbHelper.run(
        `UPDATE environments SET pending_action = NULL, pending_correlation_id = NULL, pending_from_state = NULL,
          pending_to_state = NULL, pending_started_at = NULL, pending_ends_at = NULL,
          pending_service_key = NULL, pending_job_id = NULL, last_service_action_json = ? WHERE team_id = ?`,
        JSON.stringify({
          kind: action === 'service_restart' ? 'restart' : 'reset',
          serviceKey: env.pending_service_key, outcome, correlationId, at: endsAt,
          reason: outcome === 'failure' ? (reasonOverride ?? `${action} failed`) : null,
        }),
        teamId);
      if (outcome === 'failure') {
        try {
          dbHelper.run(
            `INSERT INTO alerts (id, team_id, severity, kind, dedupe_key, message, created_at)
             VALUES (?, ?, 'warning', 'action_failed', ?, ?, ?)`,
            `a_${crypto.randomBytes(4).toString('hex')}`, teamId, `${teamId}:${action}:failure`,
            reasonOverride ?? `${action} failed`, endsAt);
        } catch { /* dedupe — already open */ }
      }
      return [{ teamId, action, outcome, correlationId, ts: endsAt }];
    }

    // Failure injection (mock) or a failed agent job
    if (outcome === 'failure') {
      const failureReason = reasonOverride ?? `${action} failed (simulated)`;
      dbHelper.run(
        `UPDATE environments SET
          lifecycle_state = 'failed',
          failure_reason = ?,
          pending_action = NULL,
          pending_correlation_id = NULL,
          pending_from_state = NULL,
          pending_to_state = NULL,
          pending_started_at = NULL,
          pending_ends_at = NULL,
          pending_service_key = NULL,
          pending_job_id = NULL,
          fail_next_action = NULL
        WHERE team_id = ?`,
        failureReason, teamId
      );

      // Open alert (ignore duplicate)
      const alertId = `a_${crypto.randomBytes(4).toString('hex')}`;
      const dedupeKey = `${teamId}:${action}:failure`;
      try {
        dbHelper.run(
          `INSERT INTO alerts (id, team_id, severity, kind, dedupe_key, message, created_at)
           VALUES (?, ?, 'critical', 'action_failed', ?, ?, ?)`,
          alertId, teamId, dedupeKey, failureReason, endsAt
        );
      } catch { /* dedupe — already open */ }

      return [{ teamId, action, outcome: 'failure', correlationId, ts: endsAt }];
    }

    // Success path
    dbHelper.run(
      `UPDATE environments SET
        lifecycle_state = ?,
        failure_reason = NULL,
        pending_action = NULL,
        pending_correlation_id = NULL,
        pending_from_state = NULL,
        pending_to_state = NULL,
        pending_started_at = NULL,
        pending_ends_at = NULL,
        pending_service_key = NULL,
        pending_job_id = NULL
      WHERE team_id = ?`,
      toState, teamId
    );

    // Post-transition side effects
    if (toState === 'deleted') {
      dbHelper.run(`UPDATE teams SET archived_at = ? WHERE id = ?`, endsAt, teamId);
      dbHelper.run(`UPDATE participants SET active = 0 WHERE team_id = ?`, teamId);
      if (!this.realHealth()) dbHelper.run(
        `UPDATE checks SET status = 'unknown', last_checked_at = ? WHERE team_id = ?`,
        endsAt, teamId
      );
    } else if (toState === 'stopped') {
      if (!this.realHealth()) dbHelper.run(
        `UPDATE checks SET status = 'unknown', last_checked_at = ? WHERE team_id = ?`,
        endsAt, teamId
      );
      dbHelper.run(
        `UPDATE environments SET active_sessions = 0 WHERE team_id = ?`,
        teamId
      );
    } else if (toState === 'running') {
      // Restore checks to pass (respecting forced_fail) — mock health only; a real source owns the checks.
      if (!this.realHealth()) dbHelper.run(
        `UPDATE checks SET
          status = CASE WHEN forced_fail = 1 THEN 'fail' ELSE 'pass' END,
          detail = CASE WHEN forced_fail = 1 THEN forced_detail ELSE NULL END,
          last_checked_at = ?
        WHERE team_id = ?`,
        endsAt, teamId
      );
      // Regenerate terminal URL on provision/start/reset
      const terminalUrl = this.terminalUrlFor(teamId);
      dbHelper.run(
        `UPDATE environments SET terminal_url = ?, last_health_check_at = CASE WHEN ? THEN last_health_check_at ELSE ? END WHERE team_id = ?`,
        terminalUrl, this.realHealth() ? 1 : 0, endsAt, teamId
      );

      // Resolve open alerts for this team's services (if all checks now pass)
      if (!this.realHealth()) dbHelper.run(
        `UPDATE alerts SET resolved_at = ?
         WHERE team_id = ? AND resolved_at IS NULL
           AND kind IN ('service_down', 'service_degraded')`,
        endsAt, teamId
      );
    }

    return [{ teamId, action, outcome: 'success', correlationId, ts: endsAt }];
  }

  async resolveDue(): Promise<CompletedTransition[]> {
    const nowTs = this.now();
    const dueTeams = dbHelper.all<{ team_id: string }>(
      `SELECT team_id FROM environments WHERE pending_action IS NOT NULL AND pending_ends_at <= ?`,
      nowTs
    );

    const completed: CompletedTransition[] = [];
    for (const { team_id } of dueTeams) {
      const results = this.resolveDueForSync(team_id);
      completed.push(...results);
    }
    return completed;
  }

  async listTeams(q: TeamQuery): Promise<Page<TeamSummary>> {
    const page = q.page || 1;
    const pageSize = Math.min(q.pageSize || 25, 100);
    const offset = (page - 1) * pageSize;

    const conditions: string[] = [];
    const params: any[] = [];

    if (!q.includeDeleted) {
      conditions.push('t.archived_at IS NULL');
    }

    if (q.q) {
      conditions.push(`(t.name LIKE ? OR t.id LIKE ?)`);
      params.push(`%${q.q}%`, `%${q.q}%`);
    }

    if (q.state && q.state.length > 0) {
      conditions.push(`e.lifecycle_state IN (${q.state.map(() => '?').join(',')})`);
      params.push(...q.state);
    }

    if (q.health && q.health.length > 0) {
      // health is derived, handle separately after loading
    }

    if (q.account) {
      conditions.push(`t.account_status = ?`);
      params.push(q.account);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sortMap: Record<string, string> = {
      id: 't.id',
      name: 't.name',
      state: 'e.lifecycle_state',
      health: 'e.lifecycle_state', // approximate
      updated: 't.updated_at',
    };
    let sortCol = 't.id';
    let sortDir = 'ASC';
    if (q.sort) {
      const desc = q.sort.startsWith('-');
      const key = desc ? q.sort.slice(1) : q.sort;
      sortCol = sortMap[key] || 't.id';
      sortDir = desc ? 'DESC' : 'ASC';
    }

    const countRow = dbHelper.get<{ total: number }>(
      `SELECT COUNT(*) as total
       FROM teams t JOIN environments e ON t.id = e.team_id
       ${where}`,
      ...params
    );
    const total = countRow?.total || 0;

    const rows = dbHelper.all<any>(
      `SELECT t.id, t.name, t.account_status, t.updated_at,
              e.lifecycle_state, e.pending_action, e.pending_correlation_id,
              e.pending_from_state, e.pending_to_state, e.pending_started_at, e.pending_ends_at,
              (SELECT COUNT(*) FROM participants p WHERE p.team_id = t.id AND p.active = 1) as participant_count
       FROM teams t JOIN environments e ON t.id = e.team_id
       ${where}
       ORDER BY ${sortCol} ${sortDir}
       LIMIT ? OFFSET ?`,
      ...params, pageSize, offset
    );

    // Load services for health derivation in batch
    const items: TeamSummary[] = rows.map(row => {
      const services = this.loadServicesForTeam(row.id);
      const health = this.deriveHealth(row.lifecycle_state as LifecycleState, services);

      const pending = row.pending_action ? {
        action: row.pending_action as LifecycleAction | 'provision',
        correlationId: row.pending_correlation_id,
        from: row.pending_from_state as LifecycleState,
        to: row.pending_to_state as LifecycleState,
        startedAt: row.pending_started_at,
        estimatedEndsAt: row.pending_ends_at,
      } : null;

      return {
        id: row.id,
        name: row.name,
        accountStatus: row.account_status,
        lifecycleState: row.lifecycle_state,
        health,
        pending,
        participantCount: row.participant_count,
        updatedAt: row.updated_at,
      };
    });

    // Filter by health after derivation
    const healthFilter = q.health && q.health.length > 0;
    const filteredItems = healthFilter
      ? items.filter(i => q.health!.includes(i.health))
      : items;

    return {
      items: filteredItems,
      page,
      pageSize,
      total: healthFilter ? filteredItems.length : total,
    };
  }

  async getTeam(teamId: string): Promise<TeamDetail | null> {
    // Resolve any due transitions first
    this.resolveDueForSync(teamId);

    const team = dbHelper.get<any>(`SELECT * FROM teams WHERE id = ?`, teamId);
    if (!team) return null;

    const env = dbHelper.get<any>(`SELECT * FROM environments WHERE team_id = ?`, teamId);
    if (!env) return null;

    const participants = dbHelper.all<any>(
      `SELECT * FROM participants WHERE team_id = ? ORDER BY username`,
      teamId
    );

    const services = this.loadServicesForTeam(teamId);
    return this.buildTeamDetail(team, env, participants, services);
  }

  async createTeam(input: CreateTeamInput): Promise<{ team: TeamDetail; credentials: IssuedCredential[]; completionDueAt: string }> {
    const nowTs = this.now();

    // Get next seq (include archived teams so IDs are never reused)
    const maxSeqRow = dbHelper.get<{ seq: number }>(`SELECT MAX(seq) as seq FROM teams`);
    const seq = (maxSeqRow?.seq || 0) + 1;
    if (seq > 99) {
      const err = new Error('CONFLICT');
      (err as any).code = 'CONFLICT';
      (err as any).message = 'team capacity exceeded';
      throw err;
    }

    const teamId = `team-${this.pad2(seq)}`;

    dbHelper.run(
      `INSERT INTO teams (id, seq, name, notes, account_status, created_at, updated_at, external_team_id)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`,
      teamId, seq, input.name, input.notes || '', nowTs, nowTs, input.externalTeamId ?? null
    );

    const provisionDuration = MOCK_DURATIONS.provision;
    const endsAt = new Date(new Date(nowTs).getTime() + provisionDuration).toISOString();
    const correlationId = `c_${crypto.randomBytes(6).toString('hex')}`;
    const terminalUrl = this.terminalUrlFor(teamId);

    dbHelper.run(
      `INSERT INTO environments (team_id, lifecycle_state, pending_action, pending_correlation_id,
        pending_from_state, pending_to_state, pending_started_at, pending_ends_at,
        accepted_patch_version, active_sessions)
       VALUES (?, 'provisioning', 'provision', ?, 'provisioning', 'running', ?, ?, 1, 0)`,
      teamId, correlationId, nowTs, endsAt
    );

    // Insert services and checks
    const warn = teamCapWarning(seq);
    if (warn) console.warn(warn);
    for (const svc of getEventConfig().services) {
      dbHelper.run(
        `INSERT INTO services (team_id, key, name, port, placeholder) VALUES (?, ?, ?, ?, ?)`,
        teamId, svc.key, svc.name, servicePort(seq, svc.portOffset), svc.placeholder ? 1 : 0
      );
      for (const fs of ['flag0', 'flag1', 'flag2']) {
        dbHelper.run(
          `INSERT INTO flagstore_results (team_id, service_key, flagstore, verdict) VALUES (?, ?, ?, 'UNKNOWN')`,
          teamId, svc.key, fs
        );
      }
      dbHelper.run(
        `INSERT INTO checks (team_id, service_key, check_type, status, last_checked_at) VALUES (?, ?, 'reachability', 'unknown', ?)`,
        teamId, svc.key, nowTs
      );
      dbHelper.run(
        `INSERT INTO checks (team_id, service_key, check_type, status, last_checked_at) VALUES (?, ?, 'functional', 'unknown', ?)`,
        teamId, svc.key, nowTs
      );
    }

    // Create participants
    const participantNames = input.participantNames && input.participantNames.length > 0
      ? input.participantNames
      : ['Participant 1', 'Participant 2', 'Participant 3', 'Participant 4'];

    const credentials: IssuedCredential[] = [];
    participantNames.forEach((name, i) => {
      const pId = `p_${crypto.randomBytes(4).toString('hex')}`;
      const username = `${teamId}-p${i + 1}`;
      const password = this.generatePassword();
      const hash = bcrypt.hashSync(password, 10);
      dbHelper.run(
        `INSERT INTO participants (id, team_id, name, username, password_hash, credential_issued_at, credential_version, active)
         VALUES (?, ?, ?, ?, ?, ?, 1, 1)`,
        pId, teamId, name, username, hash, nowTs
      );
      credentials.push({ participantId: pId, username, password });
    });

    // Store terminal url for when provisioning completes
    dbHelper.run(`UPDATE environments SET terminal_url = ? WHERE team_id = ?`, terminalUrl, teamId);

    const team = await this.getTeam(teamId);
    return { team: team!, credentials, completionDueAt: endsAt };
  }

  async updateTeam(teamId: string, patch: UpdateTeamInput): Promise<TeamDetail> {
    const team = dbHelper.get<any>(`SELECT * FROM teams WHERE id = ?`, teamId);
    if (!team) {
      const err = new Error('NOT_FOUND'); (err as any).code = 'NOT_FOUND'; throw err;
    }
    if (team.archived_at) {
      const err = new Error('INVALID_TRANSITION'); (err as any).code = 'INVALID_TRANSITION'; throw err;
    }

    const nowTs = this.now();
    const updates: string[] = ['updated_at = ?'];
    const params: any[] = [nowTs];

    if (patch.name !== undefined) { updates.push('name = ?'); params.push(patch.name); }
    if (patch.notes !== undefined) { updates.push('notes = ?'); params.push(patch.notes); }
    if (patch.accountStatus !== undefined) { updates.push('account_status = ?'); params.push(patch.accountStatus); }

    params.push(teamId);
    dbHelper.run(`UPDATE teams SET ${updates.join(', ')} WHERE id = ?`, ...params);

    const detail = await this.getTeam(teamId);
    return detail!;
  }

  async addParticipant(teamId: string, name: string): Promise<{ participant: Participant; credential: IssuedCredential }> {
    const nowTs = this.now();
    const activeCount = dbHelper.get<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM participants WHERE team_id = ? AND active = 1`,
      teamId
    );
    if ((activeCount?.cnt || 0) >= 8) {
      const err = new Error('VALIDATION_ERROR'); (err as any).code = 'VALIDATION_ERROR';
      (err as any).message = 'Maximum 8 active participants per team'; throw err;
    }

    // Use next p-number
    const maxP = dbHelper.get<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM participants WHERE team_id = ?`, teamId
    );
    const pNum = (maxP?.cnt || 0) + 1;

    const pId = `p_${crypto.randomBytes(4).toString('hex')}`;
    const username = `${teamId}-p${pNum}`;
    const password = this.generatePassword();
    const hash = bcrypt.hashSync(password, 10);

    dbHelper.run(
      `INSERT INTO participants (id, team_id, name, username, password_hash, credential_issued_at, credential_version, active)
       VALUES (?, ?, ?, ?, ?, ?, 1, 1)`,
      pId, teamId, name, username, hash, nowTs
    );

    return {
      participant: { id: pId, name, username, credentialIssuedAt: nowTs, credentialVersion: 1, active: true },
      credential: { participantId: pId, username, password },
    };
  }

  async removeParticipant(teamId: string, participantId: string): Promise<void> {
    const p = dbHelper.get<any>(`SELECT * FROM participants WHERE id = ? AND team_id = ?`, participantId, teamId);
    if (!p) { const err = new Error('NOT_FOUND'); (err as any).code = 'NOT_FOUND'; throw err; }
    dbHelper.run(`UPDATE participants SET active = 0 WHERE id = ?`, participantId);
  }

  async rotateCredentials(teamId: string, participantId?: string): Promise<IssuedCredential[]> {
    const nowTs = this.now();
    const where = participantId
      ? `team_id = ? AND id = ? AND active = 1`
      : `team_id = ? AND active = 1`;
    const params = participantId ? [teamId, participantId] : [teamId];

    const participants = dbHelper.all<any>(
      `SELECT * FROM participants WHERE ${where}`,
      ...params
    );

    if (participants.length === 0) {
      const err = new Error('NOT_FOUND'); (err as any).code = 'NOT_FOUND'; throw err;
    }

    const credentials: IssuedCredential[] = [];
    for (const p of participants) {
      const password = this.generatePassword();
      const hash = bcrypt.hashSync(password, 10);
      dbHelper.run(
        `UPDATE participants SET password_hash = ?, credential_version = credential_version + 1, credential_issued_at = ? WHERE id = ?`,
        hash, nowTs, p.id
      );
      credentials.push({ participantId: p.id, username: p.username, password });
    }
    return credentials;
  }

  async requestAction(
    teamId: string,
    action: LifecycleAction,
    ctx: { correlationId: string }
  ): Promise<ActionResponse | { noop: true; reason: string }> {
    // Resolve any due transitions first
    this.resolveDueForSync(teamId);

    const env = dbHelper.get<any>(`SELECT * FROM environments WHERE team_id = ?`, teamId);
    if (!env) { const err = new Error('NOT_FOUND'); (err as any).code = 'NOT_FOUND'; throw err; }

    const state = env.lifecycle_state as LifecycleState;

    // Check if in-progress
    if (env.pending_action) {
      const err = new Error('ACTION_IN_PROGRESS'); (err as any).code = 'ACTION_IN_PROGRESS'; throw err;
    }

    const transition = this.getTransition(state, action);

    if (transition.type === 'noop') {
      return { noop: true as const, reason: transition.reason! };
    }

    if (transition.type === 'invalid') {
      const err = new Error('INVALID_TRANSITION'); (err as any).code = 'INVALID_TRANSITION'; throw err;
    }

    const nowTs = this.now();
    const scale = loadConfig().mockDurationScale;
    const duration = Math.round((MOCK_DURATIONS[action] || 3000) * scale);
    const endsAt = new Date(new Date(nowTs).getTime() + duration).toISOString();

    dbHelper.run(
      `UPDATE environments SET
        lifecycle_state = ?,
        pending_action = ?,
        pending_correlation_id = ?,
        pending_from_state = ?,
        pending_to_state = ?,
        pending_started_at = ?,
        pending_ends_at = ?,
        last_action_at = ?,
        active_sessions = CASE WHEN ? IN ('stop','reset','delete') THEN 0 ELSE active_sessions END
      WHERE team_id = ?`,
      transition.intermediate, action, ctx.correlationId, state, transition.end,
      nowTs, endsAt, nowTs, action, teamId
    );

    return {
      teamId,
      action,
      correlationId: ctx.correlationId,
      transition: {
        from: state,
        to: transition.end,
        via: transition.intermediate,
        startedAt: nowTs,
        estimatedEndsAt: endsAt,
      },
    };
  }

  /** Throws (coded errors) unless the team exists, is running, has no pending action and owns the service. */
  protected assertServiceActionAllowed(teamId: string, serviceKey: string): void {
    const fail = (code: string, message: string): never => { const err = new Error(message); (err as Error & { code?: string }).code = code; throw err; };
    this.resolveDueForSync(teamId);
    const env = dbHelper.get<any>(`SELECT * FROM environments WHERE team_id = ?`, teamId);
    if (!env) fail('NOT_FOUND', `Team ${teamId} not found.`);
    if (env.pending_action) fail('ACTION_IN_PROGRESS', 'Another action is already running for this team.');
    if (env.lifecycle_state !== 'running') fail('INVALID_TRANSITION', 'Service actions require a running environment.');
    if (!dbHelper.get(`SELECT 1 AS x FROM services WHERE team_id = ? AND key = ?`, teamId, serviceKey)) {
      fail('NOT_FOUND', `Service ${serviceKey} not found.`);
    }
  }

  /** MOCK: simulated service restart/reset on the environment's single pending slot. Never touches patches or audit. */
  async requestServiceAction(
    teamId: string,
    serviceKey: string,
    kind: 'restart' | 'reset',
    ctx: { correlationId: string },
  ): Promise<ServiceActionResponse> {
    this.assertServiceActionAllowed(teamId, serviceKey);
    const startedAt = this.now();
    const endsAt = new Date(Date.parse(startedAt) + Math.round(MOCK_DURATIONS.service * loadConfig().mockDurationScale)).toISOString();
    dbHelper.run(
      `UPDATE environments SET pending_action = ?, pending_correlation_id = ?, pending_from_state = 'running',
        pending_to_state = 'running', pending_started_at = ?, pending_ends_at = ?, pending_service_key = ?, last_action_at = ?
       WHERE team_id = ?`,
      `service_${kind}`, ctx.correlationId, startedAt, endsAt, serviceKey, startedAt, teamId);
    return { teamId, serviceKey, kind, correlationId: ctx.correlationId, startedAt, estimatedEndsAt: endsAt };
  }

  async runHealthChecks(teamId: string): Promise<HealthSnapshot> {
    const nowTs = this.now();
    const env = dbHelper.get<any>(`SELECT lifecycle_state FROM environments WHERE team_id = ?`, teamId);
    if (!env || env.lifecycle_state !== 'running') {
      const err = new Error('INVALID_TRANSITION'); (err as any).code = 'INVALID_TRANSITION';
      (err as any).message = 'Health checks require environment to be running'; throw err;
    }

    if (this.realHealth()) {
      // A real source owns the checks: refresh it on demand (scoreboard) and report what is stored. Never overwrite.
      await pullIfDue({ force: true });
      const services = this.loadServicesForTeam(teamId);
      const last = dbHelper.get<{ last_health_check_at: string | null }>(`SELECT last_health_check_at FROM environments WHERE team_id = ?`, teamId);
      return { health: this.deriveHealth(env.lifecycle_state, services), services, lastHealthCheckAt: last?.last_health_check_at ?? null };
    }

    // Re-evaluate checks respecting forced_fail
    dbHelper.run(
      `UPDATE checks SET
        status = CASE WHEN forced_fail = 1 THEN 'fail' ELSE 'pass' END,
        detail = CASE WHEN forced_fail = 1 THEN forced_detail ELSE NULL END,
        last_checked_at = ?
      WHERE team_id = ?`,
      nowTs, teamId
    );
    dbHelper.run(`UPDATE environments SET last_health_check_at = ? WHERE team_id = ?`, nowTs, teamId);

    // Open/resolve alerts
    const checks = dbHelper.all<any>(`SELECT * FROM checks WHERE team_id = ?`, teamId);
    for (const check of checks) {
      if (check.status === 'fail') {
        const kind = check.check_type === 'reachability' ? 'service_down' : 'service_degraded';
        const severity = check.check_type === 'reachability' ? 'critical' : 'warning';
        const dedupeKey = `${teamId}:${check.service_key}:${check.check_type}`;
        try {
          dbHelper.run(
            `INSERT INTO alerts (id, team_id, severity, kind, dedupe_key, message, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            `a_${crypto.randomBytes(4).toString('hex')}`, teamId, severity, kind, dedupeKey,
            `${check.service_key} ${check.check_type} check failed`, nowTs
          );
        } catch { /* dedupe */ }
      } else if (check.status === 'pass') {
        const dedupeKey = `${teamId}:${check.service_key}:${check.check_type}`;
        dbHelper.run(
          `UPDATE alerts SET resolved_at = ? WHERE dedupe_key = ? AND resolved_at IS NULL`,
          nowTs, dedupeKey
        );
      }
    }

    const services = this.loadServicesForTeam(teamId);
    const health = this.deriveHealth(env.lifecycle_state, services);
    return { health, services, lastHealthCheckAt: nowTs };
  }

  async getOverviewData(): Promise<OverviewData> {
    const nowTs = this.now();

    const totalsRow = dbHelper.get<any>(
      `SELECT
        COUNT(CASE WHEN t.archived_at IS NULL THEN 1 END) as teams,
        COUNT(CASE WHEN e.lifecycle_state = 'running' AND t.archived_at IS NULL THEN 1 END) as running,
        COUNT(CASE WHEN e.lifecycle_state = 'stopped' AND t.archived_at IS NULL THEN 1 END) as stopped,
        COUNT(CASE WHEN e.lifecycle_state = 'failed' AND t.archived_at IS NULL THEN 1 END) as failed,
        COUNT(CASE WHEN e.pending_action IS NOT NULL AND t.archived_at IS NULL THEN 1 END) as transitioning,
        COUNT(CASE WHEN t.archived_at IS NOT NULL THEN 1 END) as deleted
       FROM teams t JOIN environments e ON t.id = e.team_id`
    );

    // Services stats
    const svcStats = dbHelper.get<any>(
      `SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN c.check_type = 'reachability' AND c.status = 'fail' THEN 1 END) as failing_reachability,
        COUNT(CASE WHEN c.check_type = 'functional' AND c.status = 'fail' THEN 1 END) as failing_functional
       FROM services s
       JOIN teams t ON t.id = s.team_id
       JOIN checks c ON c.team_id = s.team_id AND c.service_key = s.key
       WHERE t.archived_at IS NULL`
    );

    // Build grid
    const gridRows = dbHelper.all<any>(
      `SELECT t.id, t.name, e.lifecycle_state, e.pending_action
       FROM teams t JOIN environments e ON t.id = e.team_id
       WHERE t.archived_at IS NULL
       ORDER BY t.id`
    );

    let failingReachability = 0;
    let failingFunctional = 0;
    const grid = gridRows.map(row => {
      const services = this.loadServicesForTeam(row.id);
      // counted from the stale-aware view so a stale "fail" is not reported as a live failure
      for (const s of services) {
        if (s.checks.some(c => c.type === 'reachability' && c.status === 'fail')) failingReachability++;
        if (s.checks.some(c => c.type === 'functional' && c.status === 'fail')) failingFunctional++;
      }
      const health = this.deriveHealth(row.lifecycle_state as LifecycleState, services);
      return {
        teamId: row.id,
        name: row.name,
        lifecycleState: row.lifecycle_state as LifecycleState,
        health,
        pending: Boolean(row.pending_action),
        services: services.map(s => ({
          key: s.key,
          name: s.name,
          reachability: s.checks.find(c => c.type === 'reachability')?.status ?? 'unknown',
          functional: s.checks.find(c => c.type === 'functional')?.status ?? 'unknown',
          stale: !!s.stale,
          flagstores: (s.flagstores ?? []).map(f => f.verdict),
        })),
      };
    });

    // Health totals from grid
    const healthTotals = { healthy: 0, degraded: 0, down: 0, unknown: 0 };
    for (const g of grid) {
      if (g.lifecycleState === 'running') healthTotals[g.health]++;
      else healthTotals.unknown++;
    }

    // Active sessions total
    const sessionsRow = dbHelper.get<any>(
      `SELECT SUM(e.active_sessions) as total
       FROM environments e JOIN teams t ON t.id = e.team_id
       WHERE t.archived_at IS NULL AND e.lifecycle_state = 'running'`
    );

    // Recent alerts
    const recentAlerts = dbHelper.all<any>(
      `SELECT a.* FROM alerts a LEFT JOIN teams t ON t.id = a.team_id
       WHERE t.archived_at IS NULL
       ORDER BY a.resolved_at IS NOT NULL, a.acked_at IS NOT NULL, a.created_at DESC LIMIT 25`
    );

    // Recent activity (audit completions/denials)
    const recentActivity = dbHelper.all<any>(
      `SELECT * FROM audit_log
       WHERE outcome IN ('success','failure','denied','noop')
       ORDER BY ts DESC LIMIT 10`
    );

    const healthSource = getHealthSourceStatus(Date.parse(nowTs));

    // Settings
    const compStatus = dbHelper.get<any>(`SELECT value FROM settings WHERE key = 'competition_status'`);

    return {
      adapter: this.mode,
      serverTime: nowTs,
      totals: {
        teams: totalsRow?.teams || 0,
        running: totalsRow?.running || 0,
        stopped: totalsRow?.stopped || 0,
        failed: totalsRow?.failed || 0,
        transitioning: totalsRow?.transitioning || 0,
        deleted: totalsRow?.deleted || 0,
      },
      healthTotals,
      services: {
        total: svcStats?.total || 0,
        failingReachability,
        failingFunctional,
      },
      activeSessions: sessionsRow?.total || 0,
      competitionStatus: compStatus?.value || null,
      grid,
      healthSource,
      event: getEventClock(Date.parse(nowTs), healthSource),
      openAlertCount: dbHelper.get<{ n: number }>(`SELECT COUNT(*) AS n FROM alerts a LEFT JOIN teams t ON t.id = a.team_id WHERE a.resolved_at IS NULL AND a.acked_at IS NULL AND t.archived_at IS NULL`)?.n ?? 0,
      recentAlerts: recentAlerts.map(a => this.toAlert(a)),
      recentActivity: recentActivity.map((r: any) => ({
        id: r.id,
        ts: r.ts,
        actorId: r.actor_id,
        actorName: r.actor_name,
        actorRole: r.actor_role,
        action: r.action,
        targetType: r.target_type,
        targetId: r.target_id,
        outcome: r.outcome,
        message: r.message,
        requestId: r.request_id,
        correlationId: r.correlation_id,
        details: r.details_json ? JSON.parse(r.details_json) : null,
      })),
    };
  }

  private toAlert(a: any): Alert {
    return {
      id: a.id,
      teamId: a.team_id,
      severity: a.severity,
      kind: a.kind,
      message: a.message,
      createdAt: a.created_at,
      resolvedAt: a.resolved_at,
      ackedAt: a.acked_at ?? null,
      ackedBy: a.acked_by ?? null,
      ackNote: a.ack_note ?? null,
    };
  }

  async listAlerts(q: { status?: 'open' | 'resolved'; limit?: number }): Promise<Alert[]> {
    const limit = Math.min(q.limit || 20, 200);
    let where = '';
    if (q.status === 'open') where = 'WHERE resolved_at IS NULL';
    else if (q.status === 'resolved') where = 'WHERE resolved_at IS NOT NULL';

    const rows = dbHelper.all<any>(
      `SELECT * FROM alerts ${where} ORDER BY resolved_at IS NOT NULL, created_at DESC LIMIT ?`,
      limit
    );
    return rows.map(a => this.toAlert(a));
  }

  // Demo controls
  async injectFault(teamId: string, serviceKey: string, checkType: string, mode: 'fail' | 'clear', detail?: string): Promise<void> {
    if (this.realHealth()) {
      const err = new Error('Fault injection is unavailable while HEALTH_SOURCE is not mock.');
      (err as Error & { code?: string }).code = 'VALIDATION_ERROR';
      throw err;
    }
    const nowTs = this.now();
    if (mode === 'fail') {
      dbHelper.run(
        `UPDATE checks SET forced_fail = 1, forced_detail = ?, status = 'fail', detail = ?, last_checked_at = ?
         WHERE team_id = ? AND service_key = ? AND check_type = ?`,
        detail || `${checkType} check forced fail`, detail || `${checkType} check forced fail`, nowTs,
        teamId, serviceKey, checkType
      );
      // Open alert
      const kind = checkType === 'reachability' ? 'service_down' : 'service_degraded';
      const severity = checkType === 'reachability' ? 'critical' : 'warning';
      const dedupeKey = `${teamId}:${serviceKey}:${checkType}`;
      try {
        dbHelper.run(
          `INSERT INTO alerts (id, team_id, severity, kind, dedupe_key, message, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          `a_${crypto.randomBytes(4).toString('hex')}`, teamId, severity, kind, dedupeKey,
          `${serviceKey} ${checkType} failure injected`, nowTs
        );
      } catch { /* dedupe */ }
    } else {
      dbHelper.run(
        `UPDATE checks SET forced_fail = 0, forced_detail = NULL, status = 'pass', detail = NULL, last_checked_at = ?
         WHERE team_id = ? AND service_key = ? AND check_type = ?`,
        nowTs, teamId, serviceKey, checkType
      );
      const dedupeKey = `${teamId}:${serviceKey}:${checkType}`;
      dbHelper.run(
        `UPDATE alerts SET resolved_at = ? WHERE dedupe_key = ? AND resolved_at IS NULL`,
        nowTs, dedupeKey
      );
    }
  }

  async setFailNext(teamId: string, action: LifecycleAction | 'provision'): Promise<void> {
    dbHelper.run(`UPDATE environments SET fail_next_action = ? WHERE team_id = ?`, action, teamId);
  }

  protected getTransition(
    state: LifecycleState,
    action: LifecycleAction
  ): { type: 'accepted' | 'noop' | 'invalid'; intermediate: LifecycleState; end: LifecycleState; reason?: string } {
    const TRANSITIONING: LifecycleState[] = ['provisioning', 'stopping', 'starting', 'resetting', 'deleting'];
    if (TRANSITIONING.includes(state)) {
      return { type: 'invalid', intermediate: state, end: state };
    }
    if (state === 'deleted') {
      return { type: 'invalid', intermediate: state, end: state };
    }

    if (state === 'running') {
      if (action === 'start') return { type: 'noop', intermediate: state, end: state, reason: 'Environment is already running.' };
      if (action === 'stop') return { type: 'accepted', intermediate: 'stopping', end: 'stopped' };
      if (action === 'reset') return { type: 'accepted', intermediate: 'resetting', end: 'running' };
      if (action === 'delete') return { type: 'accepted', intermediate: 'deleting', end: 'deleted' };
    }
    if (state === 'stopped') {
      if (action === 'stop') return { type: 'noop', intermediate: state, end: state, reason: 'Environment is already stopped.' };
      if (action === 'start') return { type: 'accepted', intermediate: 'starting', end: 'running' };
      if (action === 'delete') return { type: 'accepted', intermediate: 'deleting', end: 'deleted' };
      if (action === 'reset') return { type: 'invalid', intermediate: state, end: state };
    }
    if (state === 'failed') {
      if (action === 'reset') return { type: 'accepted', intermediate: 'resetting', end: 'running' };
      if (action === 'delete') return { type: 'accepted', intermediate: 'deleting', end: 'deleted' };
      return { type: 'invalid', intermediate: state, end: state };
    }

    return { type: 'invalid', intermediate: state, end: state };
  }
}
