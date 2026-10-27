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
