'use client';

import { defaultHeaders, handleResponse } from './api-client';

// Freeze and organizer accounts (v1.2 W3)

export interface OrganizerUser {
  id: string;
  username: string;
  displayName: string;
  role: 'organizer_admin' | 'organizer_operator';
  active: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: defaultHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  return handleResponse<T>(res);
}

export const apiSetFrozen = (frozen: boolean, confirm?: string) =>
  post<{ frozen: boolean }>('/api/settings/freeze', { frozen, confirm });

export async function apiListUsers() {
  return handleResponse<{ items: OrganizerUser[] }>(await fetch('/api/users', { credentials: 'same-origin' }));
}
export const apiCreateUser = (input: { username: string; displayName: string; role: OrganizerUser['role'] }) =>
  post<{ user: OrganizerUser; password: string }>('/api/users', input);
export const apiResetUserPassword = (id: string) =>
  post<{ user: OrganizerUser; password: string }>(`/api/users/${encodeURIComponent(id)}/reset-password`);
export const apiRevokeUserSessions = (id: string) =>
  post<{ user: OrganizerUser }>(`/api/users/${encodeURIComponent(id)}/revoke-sessions`);
export const apiDisableUser = (id: string) =>
  post<{ user: OrganizerUser }>(`/api/users/${encodeURIComponent(id)}/disable`);
export const apiChangePassword = (currentPassword: string, newPassword: string) =>
  post<{ ok: true }>('/api/auth/change-password', { currentPassword, newPassword });

// Service-level actions (v1.2 W4)
export async function apiServiceAction(
  teamId: string,
  serviceKey: string,
  kind: 'restart' | 'reset',
  idempotencyKey: string,
  confirmation?: { reason: string; confirmTeamId: string },
) {
  const res = await fetch(`/api/teams/${encodeURIComponent(teamId)}/services/${encodeURIComponent(serviceKey)}/${kind}`, {
    method: 'POST',
    headers: defaultHeaders(idempotencyKey),
    body: confirmation ? JSON.stringify(confirmation) : undefined,
    credentials: 'same-origin',
  });
  return handleResponse<{ correlationId: string; estimatedEndsAt: string }>(res);
}

// Alerts and notes (v1.2 W6)
export const apiAckAlert = (id: string, input: { note?: string; resolve?: boolean }) =>
  post<{ id: string; status: string }>(`/api/alerts/${encodeURIComponent(id)}/ack`, input);

export async function apiSaveNotes(teamId: string, notes: string, expectedNotes: string) {
  const res = await fetch(`/api/teams/${encodeURIComponent(teamId)}`, {
    method: 'PATCH',
    headers: defaultHeaders(),
    body: JSON.stringify({ notes, expectedNotes }),
    credentials: 'same-origin',
  });
  return handleResponse<{ notes: string; updatedAt: string }>(res);
}

export async function apiRunCheck(teamId: string) {
  const res = await fetch(`/api/teams/${encodeURIComponent(teamId)}/health/run`, {
    method: 'POST', headers: defaultHeaders(), credentials: 'same-origin',
  });
  return handleResponse<{ health: string }>(res);
}
