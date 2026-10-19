'use client';

import type {
  Alert,
  AuditEntry,
  IssuedCredential,
  MetaResponse,
  OverviewData,
  Page,
  Participant,
  TeamDetail,
  TeamSummary,
  User,
  BulkEnvActionRequest,
  BulkEnvActionResponse,
  TeamImportRequest,
  TeamImportResponse,
} from './schemas';

type QueryValue = string | string[] | boolean | number | undefined;
type QueryParams = Record<string, QueryValue>;

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
    details?: Record<string, unknown>;
  };
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly requestId?: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (res.ok) {
    if (res.status === 204) return undefined as T;
    return res.json() as T;
  }
  let body: ApiErrorBody = {};
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    // Use the HTTP status when the server did not return JSON.
  }
  const err = body.error ?? {};
  throw new ApiError(
    err.code ?? 'UNKNOWN',
    err.message ?? `HTTP ${res.status}`,
    res.status,
    err.requestId,
    err.details,
  );
}

function defaultHeaders(idempotencyKey?: string): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (idempotencyKey) h['Idempotency-Key'] = idempotencyKey;
  return h;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function apiLogin(username: string, password: string) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: defaultHeaders(),
    body: JSON.stringify({ username, password }),
    credentials: 'same-origin',
  });
  return handleResponse<{ user: User }>(res);
}

export async function apiLogout() {
  const res = await fetch('/api/auth/logout', {
    method: 'POST',
    headers: defaultHeaders(),
    credentials: 'same-origin',
  });
  return handleResponse<void>(res);
}

export async function apiMe() {
  const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
  return handleResponse<{ user: User }>(res);
}

// ── Meta ──────────────────────────────────────────────────────────────────────

export async function apiMeta() {
  const res = await fetch('/api/meta', { credentials: 'same-origin' });
  return handleResponse<MetaResponse>(res);
}

// ── Overview ─────────────────────────────────────────────────────────────────

export async function apiOverview() {
  const res = await fetch('/api/overview', { credentials: 'same-origin' });
  return handleResponse<OverviewData>(res);
}

// ── Teams ─────────────────────────────────────────────────────────────────────

export async function apiListTeams(params: QueryParams = {}) {
  const url = new URL('/api/teams', window.location.origin);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) { if (v.length) url.searchParams.set(k, v.join(',')); }
    else url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), { credentials: 'same-origin' });
  return handleResponse<Page<TeamSummary>>(res);
}

export async function apiGetTeam(teamId: string) {
  const res = await fetch(`/api/teams/${teamId}`, { credentials: 'same-origin' });
  return handleResponse<TeamDetail>(res);
}

export async function apiCreateTeam(body: {
  name: string;
  notes?: string;
  participantNames?: string[];
  autoProvision?: boolean;
}, idempotencyKey?: string) {
  const res = await fetch('/api/teams', {
    method: 'POST',
    headers: defaultHeaders(idempotencyKey),
    body: JSON.stringify(body),
    credentials: 'same-origin',
  });
  return handleResponse<{ team: TeamDetail; credentials: IssuedCredential[] }>(res);
}

export async function apiImportTeams(body: TeamImportRequest) {
  const res = await fetch('/api/teams/import', {
    method: 'POST',
    headers: defaultHeaders(),
    body: JSON.stringify(body),
    credentials: 'same-origin',
  });
  return handleResponse<TeamImportResponse>(res);
}

export async function apiBulkEnvironmentAction(body: BulkEnvActionRequest) {
  const res = await fetch('/api/environments/bulk', {
    method: 'POST',
    headers: defaultHeaders(),
    body: JSON.stringify(body),
    credentials: 'same-origin',
  });
  return handleResponse<BulkEnvActionResponse>(res);
}

export async function apiUpdateTeam(teamId: string, patch: {
  name?: string;
  notes?: string;
  accountStatus?: 'active' | 'suspended';
}) {
  const res = await fetch(`/api/teams/${teamId}`, {
    method: 'PATCH',
    headers: defaultHeaders(),
    body: JSON.stringify(patch),
    credentials: 'same-origin',
  });
  return handleResponse<TeamDetail>(res);
}

export async function apiDeleteTeam(teamId: string, confirmName: string, idempotencyKey?: string) {
  const res = await fetch(`/api/teams/${teamId}`, {
    method: 'DELETE',
    headers: defaultHeaders(idempotencyKey),
    body: JSON.stringify({ confirmName }),
    credentials: 'same-origin',
  });
  return handleResponse<unknown>(res);
}

// ── Lifecycle actions ─────────────────────────────────────────────────────────

export async function apiLifecycleAction(
  teamId: string,
  action: 'start' | 'stop' | 'reset',
  idempotencyKey?: string,
) {
  const res = await fetch(`/api/teams/${teamId}/environment/${action}`, {
    method: 'POST',
    headers: defaultHeaders(idempotencyKey),
    credentials: 'same-origin',
  });
  return handleResponse<unknown>(res);
}

// ── Participants ──────────────────────────────────────────────────────────────

export async function apiListParticipants(teamId: string) {
  const res = await fetch(`/api/teams/${teamId}/participants`, { credentials: 'same-origin' });
  return handleResponse<Participant[]>(res);
}

export async function apiAddParticipant(teamId: string, name: string) {
  const res = await fetch(`/api/teams/${teamId}/participants`, {
    method: 'POST',
    headers: defaultHeaders(),
    body: JSON.stringify({ name }),
    credentials: 'same-origin',
  });
  return handleResponse<{ participant: Participant; credential: IssuedCredential }>(res);
}

export async function apiRemoveParticipant(teamId: string, participantId: string) {
  const res = await fetch(`/api/teams/${teamId}/participants/${participantId}`, {
    method: 'DELETE',
    headers: defaultHeaders(),
    credentials: 'same-origin',
  });
  return handleResponse<void>(res);
}

export async function apiRotateCredentials(teamId: string, participantId?: string) {
  const res = await fetch(`/api/teams/${teamId}/credentials/rotate`, {
    method: 'POST',
    headers: defaultHeaders(),
    body: JSON.stringify({ participantId }),
    credentials: 'same-origin',
  });
  return handleResponse<{ credentials: IssuedCredential[] }>(res);
}

// ── Health ────────────────────────────────────────────────────────────────────

export async function apiRunHealthChecks(teamId: string) {
  const res = await fetch(`/api/teams/${teamId}/health/run`, {
    method: 'POST',
    headers: defaultHeaders(),
    credentials: 'same-origin',
  });
  return handleResponse<unknown>(res);
}

// ── Alerts ────────────────────────────────────────────────────────────────────

export async function apiListAlerts(params: { status?: 'open' | 'resolved'; limit?: number } = {}) {
  const url = new URL('/api/alerts', window.location.origin);
  if (params.status) url.searchParams.set('status', params.status);
  if (params.limit) url.searchParams.set('limit', String(params.limit));
  const res = await fetch(url.toString(), { credentials: 'same-origin' });
  return handleResponse<Alert[]>(res);
}

// ── Audit ─────────────────────────────────────────────────────────────────────

export async function apiQueryAudit(params: QueryParams = {}) {
  const url = new URL('/api/audit', window.location.origin);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) { if (v.length) url.searchParams.set(k, v.join(',')); }
    else url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), { credentials: 'same-origin' });
  return handleResponse<Page<AuditEntry>>(res);
}

// ── Settings ──────────────────────────────────────────────────────────────────

export async function apiGetSettings() {
  const res = await fetch('/api/settings', { credentials: 'same-origin' });
  return handleResponse<{ competitionStatus: string }>(res);
}

export async function apiUpdateSettings(patch: { competitionStatus?: string }) {
  const res = await fetch('/api/settings', {
    method: 'PATCH',
    headers: defaultHeaders(),
    body: JSON.stringify(patch),
    credentials: 'same-origin',
  });
  return handleResponse<unknown>(res);
}

// ── Demo controls ─────────────────────────────────────────────────────────────

export async function apiDemoInject(body: {
  teamId: string; serviceKey: string; checkType: string; mode: 'fail' | 'clear'; detail?: string;
}) {
  const res = await fetch('/api/demo/inject', {
    method: 'POST',
    headers: defaultHeaders(),
    body: JSON.stringify(body),
    credentials: 'same-origin',
  });
  return handleResponse<unknown>(res);
}

export async function apiDemoFailNext(body: { teamId: string; action: string }) {
  const res = await fetch('/api/demo/fail-next', {
    method: 'POST',
    headers: defaultHeaders(),
    body: JSON.stringify(body),
    credentials: 'same-origin',
  });
  return handleResponse<unknown>(res);
}

export async function apiDemoReseed() {
  const res = await fetch('/api/demo/reseed', {
    method: 'POST',
    headers: defaultHeaders(),
    body: JSON.stringify({ confirm: 'RESEED' }),
    credentials: 'same-origin',
  });
  return handleResponse<unknown>(res);
}
