export type Role = 'organizer_admin' | 'organizer_operator' | 'team';
export type LifecycleState = 'provisioning' | 'running' | 'stopping' | 'stopped' | 'starting' | 'resetting' | 'deleting' | 'deleted' | 'failed';
export type LifecycleAction = 'start' | 'stop' | 'reset' | 'delete';
export type Health = 'healthy' | 'degraded' | 'down' | 'unknown';
export type CheckType = 'reachability' | 'functional';
export type CheckStatus = 'pass' | 'fail' | 'unknown';
export type AccountStatus = 'active' | 'suspended';

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: Role;
}

export interface PendingAction {
  action: LifecycleAction | 'provision' | 'service_restart' | 'service_reset';
  /** Set for service_restart / service_reset. */
  serviceKey?: string;
  correlationId: string;
  from: LifecycleState;
  to: LifecycleState;
  startedAt: string;
  estimatedEndsAt: string;
}

export interface Check {
  type: CheckType;
  status: CheckStatus;
  detail: string | null;
  lastCheckedAt: string | null;
}

export type FlagstoreKey = 'flag0' | 'flag1' | 'flag2';
export type FlagstoreVerdict = 'OK' | 'MUMBLE' | 'OFFLINE' | 'INTERNAL_ERROR' | 'UNKNOWN';

export interface FlagstoreResult {
  key: FlagstoreKey;
  verdict: FlagstoreVerdict;
  message: string | null;
  round: number | null;
  checkedAt: string | null;
}

export interface Service {
  key: string;
  name: string;
  port: number;
  placeholder: boolean;
  checks: Check[];
  flagstores?: FlagstoreResult[];
  /** True when a real health source is configured and no result is newer than stale_after_sec. */
  stale?: boolean;
}

export interface ResourceUsage {
  cpu: { usedPct: number; limitCores: number };
  memory: { usedMb: number; limitMb: number };
  processes: { used: number; limit: number };
  storage: { usedMb: number; limitMb: number };
  isMock: boolean;
}

export interface Terminal {
  kind: 'ttyd';
  mode: 'per_team' | 'shared';
  port: number;
  url: string | null;
  isMock: boolean;
}

export interface Environment {
  lifecycleState: LifecycleState;
  health: Health;
  pending: PendingAction | null;
  acceptedPatchVersion: number;
  lastDeploy: { version: number; result: 'accepted' | 'rejected' | 'rolled_back'; at: string } | null;
  services: Service[];
  resources: ResourceUsage | null;
  activeSessions: number;
  terminal: Terminal | null;
  failureReason: string | null;
  lastActionAt: string | null;
  lastHealthCheckAt: string | null;
}

export interface Participant {
  id: string;
  name: string;
  username: string;
  credentialIssuedAt: string;
  credentialVersion: number;
  active: boolean;
}

export interface TeamSummary {
  id: string;
  name: string;
  accountStatus: AccountStatus;
  lifecycleState: LifecycleState;
  health: Health;
  pending: PendingAction | null;
  participantCount: number;
  updatedAt: string;
}

export interface TeamDetail extends TeamSummary {
  notes: string;
  createdAt: string;
  participants: Participant[];
  environment: Environment;
}

export interface IssuedCredential {
  participantId: string;
  username: string;
  password: string;
}

export interface AuditEntry {
  id: number;
  ts: string;
  actorId: string | null;
  actorName: string;
  actorRole: Role | 'system' | 'anonymous';
  action: string;
  targetType: 'team' | 'participant' | 'session' | 'settings' | 'system' | 'user';
  targetId: string | null;
  outcome: 'requested' | 'success' | 'failure' | 'denied' | 'noop';
  message: string;
  requestId: string | null;
  correlationId: string | null;
  details: Record<string, unknown> | null;
}

export interface Alert {
  id: string;
  teamId: string | null;
  severity: 'info' | 'warning' | 'critical';
  kind: string;
  message: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface TeamQuery {
  q?: string;
  state?: string[];
  health?: string[];
  account?: string;
  includeDeleted?: boolean;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export interface CreateTeamInput {
  name: string;
  notes?: string;
  participantNames?: string[];
  autoProvision?: boolean;
}

export interface UpdateTeamInput {
  name?: string;
  notes?: string;
  accountStatus?: AccountStatus;
}

export interface ActionResponse {
  teamId: string;
  action: LifecycleAction;
  correlationId: string;
  transition: {
    from: LifecycleState;
    to: LifecycleState;
    via: LifecycleState;
    startedAt: string;
    estimatedEndsAt: string;
  };
}

export type ServiceActionKind = 'restart' | 'reset';

export interface CompletedTransition {
  teamId: string;
  action: LifecycleAction | 'provision' | 'service_restart' | 'service_reset';
  outcome: 'success' | 'failure';
  correlationId: string;
  ts: string;
}

export interface HealthSnapshot {
  health: Health;
  services: Service[];
  lastHealthCheckAt: string | null;
}

export interface OverviewData {
  adapter: string;
  serverTime: string;
  totals: {
    teams: number;
    running: number;
    stopped: number;
    failed: number;
    transitioning: number;
    deleted: number;
  };
  healthTotals: {
    healthy: number;
    degraded: number;
    down: number;
    unknown: number;
  };
  services: {
    total: number;
    failingReachability: number;
    failingFunctional: number;
  };
  activeSessions: number;
  competitionStatus: string | null;
  grid: {
    teamId: string;
    name: string;
    lifecycleState: LifecycleState;
    health: Health;
    pending: boolean;
  }[];
  recentAlerts: Alert[];
  recentActivity: AuditEntry[];
  healthSource: HealthSourceStatusDto;
}

export interface HealthSourceStatusDto {
  source: 'mock' | 'scoreboard' | 'ingest';
  state: 'mock' | 'disabled' | 'never' | 'ok' | 'error' | 'stale' | 'frozen';
  lastRound: number | null;
  lastFetchAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  staleAfterSec: number;
  roundSec: number;
}

export interface AdapterCapabilities {
  /** What an environment reset really does; drives dialog copy and the confirmation required (docs/12 C1, D22). */
  resetKind: 'restore_patch' | 'recreate_pristine' | 'restart';
  serviceLevelReset: boolean;
  terminalMode: 'per_team' | 'shared';
  flagstores: number;
}

export interface ServiceActionResponse {
  teamId: string;
  serviceKey: string;
  kind: ServiceActionKind;
  correlationId: string;
  startedAt: string;
  estimatedEndsAt: string;
}

export interface EnvironmentAdapter {
  readonly mode: 'mock' | 'real' | 'docker-compose';
  readonly capabilities: AdapterCapabilities;
  listTeams(q: TeamQuery): Promise<Page<TeamSummary>>;
  getTeam(teamId: string): Promise<TeamDetail | null>;
  createTeam(input: CreateTeamInput): Promise<{ team: TeamDetail; credentials: IssuedCredential[]; completionDueAt: string }>;
  updateTeam(teamId: string, patch: UpdateTeamInput): Promise<TeamDetail>;
  addParticipant(teamId: string, name: string): Promise<{ participant: Participant; credential: IssuedCredential }>;
  removeParticipant(teamId: string, participantId: string): Promise<void>;
  rotateCredentials(teamId: string, participantId?: string): Promise<IssuedCredential[]>;
  requestAction(teamId: string, action: LifecycleAction, ctx: { correlationId: string }): Promise<ActionResponse | { noop: true; reason: string }>;
  runHealthChecks(teamId: string): Promise<HealthSnapshot>;
  getOverviewData(): Promise<OverviewData>;
  listAlerts(q: { status?: 'open' | 'resolved'; limit?: number }): Promise<Alert[]>;
  resolveDue(): Promise<CompletedTransition[]>;
  /** Optional: only when capabilities.serviceLevelReset is true. */
  requestServiceAction?(
    teamId: string,
    serviceKey: string,
    kind: ServiceActionKind,
    ctx: { correlationId: string },
  ): Promise<ServiceActionResponse>;
}
