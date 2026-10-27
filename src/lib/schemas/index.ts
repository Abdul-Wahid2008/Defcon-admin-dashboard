import { z } from 'zod';

export const RoleSchema = z.enum(['organizer_admin', 'organizer_operator', 'team']);
export type Role = z.infer<typeof RoleSchema>;

export const LifecycleStateSchema = z.enum([
  'provisioning', 'running', 'stopping', 'stopped', 'starting',
  'resetting', 'deleting', 'deleted', 'failed'
]);
export type LifecycleState = z.infer<typeof LifecycleStateSchema>;

export const LifecycleActionSchema = z.enum(['start', 'stop', 'reset', 'delete']);
export type LifecycleAction = z.infer<typeof LifecycleActionSchema>;

export const HealthSchema = z.enum(['healthy', 'degraded', 'down', 'unknown']);
export type Health = z.infer<typeof HealthSchema>;

export const CheckTypeSchema = z.enum(['reachability', 'functional']);
export type CheckType = z.infer<typeof CheckTypeSchema>;

export const CheckStatusSchema = z.enum(['pass', 'fail', 'unknown']);
export type CheckStatus = z.infer<typeof CheckStatusSchema>;

export const AccountStatusSchema = z.enum(['active', 'suspended']);
export type AccountStatus = z.infer<typeof AccountStatusSchema>;

export const UserSchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  role: RoleSchema,
});
export type User = z.infer<typeof UserSchema>;

export const PendingActionSchema = z.object({
  action: z.union([LifecycleActionSchema, z.literal('provision')]),
  correlationId: z.string(),
  from: LifecycleStateSchema,
  to: LifecycleStateSchema,
  startedAt: z.string().datetime({ offset: true }),
  estimatedEndsAt: z.string().datetime({ offset: true }),
});
export type PendingAction = z.infer<typeof PendingActionSchema>;

export const CheckSchema = z.object({
  type: CheckTypeSchema,
  status: CheckStatusSchema,
  detail: z.string().nullable(),
  lastCheckedAt: z.string().datetime({ offset: true }).nullable(),
});
export type Check = z.infer<typeof CheckSchema>;

export const TerminalSchema = z.object({
  kind: z.literal('ttyd'),
  mode: z.enum(['per_team', 'shared']),
  port: z.number().int(),
  url: z.string().nullable(),
  isMock: z.boolean(),
});
export type Terminal = z.infer<typeof TerminalSchema>;

export const FlagstoreResultSchema = z.object({
  key: z.enum(['flag0', 'flag1', 'flag2']),
  verdict: z.enum(['OK', 'MUMBLE', 'OFFLINE', 'INTERNAL_ERROR', 'UNKNOWN']),
  message: z.string().nullable(),
  round: z.number().int().nullable(),
  checkedAt: z.string().datetime({ offset: true }).nullable(),
});
export type FlagstoreResult = z.infer<typeof FlagstoreResultSchema>;

export const ServiceSchema = z.object({
  key: z.string(),
  name: z.string(),
  port: z.number().int(),
  placeholder: z.boolean(),
  checks: z.array(CheckSchema),
  flagstores: z.array(FlagstoreResultSchema).optional(),
  stale: z.boolean().optional(),
});
export type Service = z.infer<typeof ServiceSchema>;

export const ResourceUsageSchema = z.object({
  cpu: z.object({ usedPct: z.number(), limitCores: z.number() }),
  memory: z.object({ usedMb: z.number(), limitMb: z.number() }),
  processes: z.object({ used: z.number(), limit: z.number() }),
  storage: z.object({ usedMb: z.number(), limitMb: z.number() }),
  isMock: z.boolean(),
});
export type ResourceUsage = z.infer<typeof ResourceUsageSchema>;

export const EnvironmentSchema = z.object({
  lifecycleState: LifecycleStateSchema,
  health: HealthSchema,
  pending: PendingActionSchema.nullable(),
  acceptedPatchVersion: z.number().int(),
  lastDeploy: z.object({
    version: z.number().int(),
    result: z.enum(['accepted', 'rejected', 'rolled_back']),
    at: z.string().datetime({ offset: true }),
  }).nullable(),
  services: z.array(ServiceSchema),
  resources: ResourceUsageSchema.nullable(),
  activeSessions: z.number().int(),
  terminal: TerminalSchema.nullable(),
  failureReason: z.string().nullable(),
  lastActionAt: z.string().datetime({ offset: true }).nullable(),
  lastHealthCheckAt: z.string().datetime({ offset: true }).nullable(),
});
export type Environment = z.infer<typeof EnvironmentSchema>;

export const ParticipantSchema = z.object({
  id: z.string(),
  name: z.string(),
  username: z.string(),
  credentialIssuedAt: z.string().datetime({ offset: true }),
  credentialVersion: z.number().int(),
  active: z.boolean(),
});
export type Participant = z.infer<typeof ParticipantSchema>;

export const TeamSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  accountStatus: AccountStatusSchema,
  lifecycleState: LifecycleStateSchema,
  health: HealthSchema,
  pending: PendingActionSchema.nullable(),
  participantCount: z.number().int(),
  updatedAt: z.string().datetime({ offset: true }),
});
export type TeamSummary = z.infer<typeof TeamSummarySchema>;

export const TeamDetailSchema = TeamSummarySchema.extend({
  notes: z.string(),
  createdAt: z.string().datetime(),
  participants: z.array(ParticipantSchema),
  environment: EnvironmentSchema,
});
export type TeamDetail = z.infer<typeof TeamDetailSchema>;

export const IssuedCredentialSchema = z.object({
  participantId: z.string(),
  username: z.string(),
  password: z.string(),
});
export type IssuedCredential = z.infer<typeof IssuedCredentialSchema>;

export const AuditActionSchema = z.enum([
  'auth.login', 'auth.login_failed', 'auth.logout', 'audit.access_denied',
  'team.create', 'team.update', 'team.suspend', 'team.reactivate', 'team.delete',
  'env.provision', 'env.start', 'env.stop', 'env.reset', 'env.delete',
  'participant.add', 'participant.remove', 'credential.issue', 'credential.rotate',
  'health.run', 'settings.update', 'demo.inject', 'demo.fail_next', 'demo.reseed'
]);
export type AuditAction = z.infer<typeof AuditActionSchema>;

export const AuditEntrySchema = z.object({
  id: z.number().int(),
  ts: z.string().datetime({ offset: true }),
  actorId: z.string().nullable(),
  actorName: z.string(),
  actorRole: z.union([RoleSchema, z.literal('system'), z.literal('anonymous')]),
  action: AuditActionSchema,
  targetType: z.enum(['team', 'participant', 'session', 'settings', 'system', 'user']),
  targetId: z.string().nullable(),
  outcome: z.enum(['requested', 'success', 'failure', 'denied', 'noop']),
  message: z.string(),
  requestId: z.string().nullable(),
  correlationId: z.string().nullable(),
  details: z.record(z.string(), z.any()).nullable(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const AlertSchema = z.object({
  id: z.string(),
  teamId: z.string().nullable(),
  severity: z.enum(['info', 'warning', 'critical']),
  kind: z.enum(['service_down', 'service_degraded', 'action_failed', 'environment_failed', 'checker_error']),
  message: z.string(),
  createdAt: z.string().datetime({ offset: true }),
  resolvedAt: z.string().datetime({ offset: true }).nullable(),
});
export type Alert = z.infer<typeof AlertSchema>;

export type Page<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};

export const OverviewDataSchema = z.object({
  adapter: z.string(),
  serverTime: z.string().datetime({ offset: true }),
  totals: z.object({
    teams: z.number().int(),
    running: z.number().int(),
    stopped: z.number().int(),
    failed: z.number().int(),
    transitioning: z.number().int(),
    deleted: z.number().int(),
  }),
  healthTotals: z.object({
    healthy: z.number().int(),
    degraded: z.number().int(),
    down: z.number().int(),
    unknown: z.number().int(),
  }),
  services: z.object({
    total: z.number().int(),
    failingReachability: z.number().int(),
    failingFunctional: z.number().int(),
  }),
  activeSessions: z.number().int(),
  competitionStatus: z.string().nullable(),
  grid: z.array(z.object({
    teamId: z.string(),
    name: z.string(),
    lifecycleState: LifecycleStateSchema,
    health: HealthSchema,
    pending: z.boolean(),
  })),
  recentAlerts: z.array(AlertSchema),
  recentActivity: z.array(AuditEntrySchema),
  healthSource: z.object({
    source: z.enum(['mock', 'scoreboard', 'ingest']),
    state: z.enum(['mock', 'disabled', 'never', 'ok', 'error', 'stale', 'frozen']),
    lastRound: z.number().int().nullable(),
    lastFetchAt: z.string().nullable(),
    lastOkAt: z.string().nullable(),
    lastError: z.string().nullable(),
    staleAfterSec: z.number(),
    roundSec: z.number(),
  }),
});
export type OverviewData = z.infer<typeof OverviewDataSchema>;

// API Response/Request Schemas

export const MetaResponseSchema = z.object({
  adapter: z.enum(['mock', 'real', 'docker-compose']),
  version: z.string(),
  serverTime: z.string().datetime(),
  demoControls: z.boolean(),
  limits: z.object({
    softTeamCap: z.number().int(),
  }),
  badge: z.enum(['SIMULATED', 'PARTIAL', 'LIVE']),
  sources: z.object({
    health: z.enum(['mock', 'scoreboard', 'ingest']),
    lifecycle: z.enum(['mock', 'real', 'docker-compose']),
    roster: z.string(),
  }),
  health: z.object({
    state: z.enum(['mock', 'disabled', 'never', 'ok', 'error', 'stale', 'frozen']),
    lastRound: z.number().int().nullable(),
    lastOkAt: z.string().nullable(),
    lastError: z.string().nullable(),
    staleAfterSec: z.number(),
  }),
  capabilities: z.object({
    resetKind: z.enum(['restore_patch', 'recreate_pristine', 'restart']),
    serviceLevelReset: z.boolean(),
    terminalMode: z.enum(['per_team', 'shared']),
    flagstores: z.number().int(),
  }),
  frozen: z.boolean(),
});
export type MetaResponse = z.infer<typeof MetaResponseSchema>;

export const TeamImportRequestSchema = z.object({
  rows: z.array(z.object({
    name: z.string().trim().min(2).max(60),
    participantNames: z.array(z.string().trim().min(1)).max(8).optional(),
  })).min(1).max(40),
  autoProvision: z.boolean().optional(),
  dryRun: z.boolean().optional(),
});
export type TeamImportRequest = z.infer<typeof TeamImportRequestSchema>;

export const TeamImportResponseSchema = z.object({
  created: z.array(z.object({
    team: TeamDetailSchema,
    credentials: z.array(IssuedCredentialSchema),
  })),
  skipped: z.array(z.object({
    row: z.any(),
    reason: z.string(),
  })),
});
export type TeamImportResponse = z.infer<typeof TeamImportResponseSchema>;

export const BulkEnvActionRequestSchema = z.object({
  action: z.enum(['start', 'stop']),
  teamIds: z.array(z.string()).min(1).max(40),
  confirm: z.string().optional(),
});
export type BulkEnvActionRequest = z.infer<typeof BulkEnvActionRequestSchema>;

export const BulkEnvActionResponseSchema = z.object({
  results: z.array(z.object({
    teamId: z.string(),
    status: z.enum(['accepted', 'noop', 'rejected']),
    code: z.string().optional(),
    correlationId: z.string().optional(),
  })),
});
export type BulkEnvActionResponse = z.infer<typeof BulkEnvActionResponseSchema>;
