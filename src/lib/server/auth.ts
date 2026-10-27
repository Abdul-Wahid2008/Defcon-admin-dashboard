import 'server-only';
import { dbHelper } from './db';
import { AppError } from './errors';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { getSessionSecret } from '../session-secret';
import { loadConfig } from '../config';

const SESSION_COOKIE = 'dc_session';
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000; // 8 hours

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: 'organizer_admin' | 'organizer_operator' | 'team';
  teamId?: string;
  /** Copy of users.session_epoch at login; a token with a lower epoch than the row is revoked. */
  epoch?: number;
  mustChangePassword?: boolean;
}

// ── Login limiter (in memory; resets on restart) ─────────────────────────────
// Three independent fixed-window limits:
//   ip+username  5 failures / 5 min  → locked 1 min
//   ip           30 failures / 10 min
//   username     10 failures / 10 min → locked 5 min across all IPs (an attacker can lock a real account out for 5 min)
type Bucket = { count: number; resetAt: number };
const pairAttempts = new Map<string, Bucket>();
const ipAttempts = new Map<string, Bucket>();
const userAttempts = new Map<string, Bucket>();
const PAIR = { max: 5, window: 5 * 60_000, lock: 60_000 };
const IP = { max: 30, window: 10 * 60_000 };
const USER = { max: 10, window: 10 * 60_000, lock: 5 * 60_000 };

function bump(map: Map<string, Bucket>, key: string, window: number, now: number): Bucket {
  const entry = map.get(key);
  if (!entry || now >= entry.resetAt) {
    const fresh = { count: 1, resetAt: now + window };
    map.set(key, fresh);
    return fresh;
  }
  entry.count++;
  return entry;
}

function retryAfterSec(map: Map<string, Bucket>, key: string, max: number, now: number): number {
  const entry = map.get(key);
  return entry && now < entry.resetAt && entry.count >= max ? Math.ceil((entry.resetAt - now) / 1000) : 0;
}

export function checkLoginRateLimit(ip: string, username: string, now = Date.now()): void {
  const u = username.toLowerCase();
  const retryAfter = Math.max(
    retryAfterSec(pairAttempts, `${ip}:${u}`, PAIR.max, now),
    retryAfterSec(ipAttempts, ip, IP.max, now),
    retryAfterSec(userAttempts, u, USER.max, now),
  );
  if (retryAfter > 0) {
    throw new AppError('RATE_LIMITED', `Too many login attempts. Retry after ${retryAfter}s.`, { retryAfter });
  }
}

export function recordLoginFailure(ip: string, username: string, now = Date.now()): void {
  const u = username.toLowerCase();
  const pair = bump(pairAttempts, `${ip}:${u}`, PAIR.window, now);
  if (pair.count >= PAIR.max) pair.resetAt = now + PAIR.lock;
  bump(ipAttempts, ip, IP.window, now);
  const user = bump(userAttempts, u, USER.window, now);
  if (user.count >= USER.max) user.resetAt = now + USER.lock;
}

export function clearLoginAttempts(ip: string, username: string): void {
  const u = username.toLowerCase();
  pairAttempts.delete(`${ip}:${u}`);
  userAttempts.delete(u);
}

export function resetLoginLimiterForTests(): void {
  pairAttempts.clear();
  ipAttempts.clear();
  userAttempts.clear();
}

/**
 * Client IP for rate limiting. Without TRUST_PROXY the app cannot know the peer address, so every caller shares
 * one bucket ('direct') and the client-controlled X-Forwarded-For is ignored. With TRUST_PROXY=true the rightmost
 * entry is used: it is the one appended by our own proxy.
 */
export function getClientIp(req: Request): string {
  if (!loadConfig().trustProxy) return 'direct';
  const last = req.headers.get('x-forwarded-for')?.split(',').map(p => p.trim()).filter(Boolean).pop();
  return last || req.headers.get('x-real-ip') || 'direct';
}

export async function createSession(user: SessionUser): Promise<string> {
  const now = Date.now();
  return new SignJWT({
    sub: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    epoch: user.epoch ?? 0,
    ...(user.teamId ? { teamId: user.teamId } : {}),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt(Math.floor(now / 1000))
    .setExpirationTime(Math.floor((now + SESSION_DURATION_MS) / 1000))
    .sign(getSessionSecret());
}

/** Signature and expiry only. resolveSession adds the revocation check against the database. */
export async function verifySession(token: string): Promise<SessionUser> {
  try {
    const { payload } = await jwtVerify(token, getSessionSecret());
    return {
      id: payload.sub as string,
      username: payload['username'] as string,
      displayName: payload['displayName'] as string,
      role: payload['role'] as SessionUser['role'],
      teamId: typeof payload['teamId'] === 'string' ? payload['teamId'] : undefined,
      epoch: typeof payload['epoch'] === 'number' ? payload['epoch'] : 0,
    };
  } catch {
    throw new AppError('UNAUTHENTICATED', 'Session expired or invalid.');
  }
}

/** Verifies a token and checks the account is still active and the session not revoked (session_epoch). */
export async function resolveSession(token: string): Promise<SessionUser> {
  const user = await verifySession(token);
  if (user.role === 'team') return user; // team sessions have no users row
  const row = dbHelper.get<{ active: number; session_epoch: number; must_change_password: number }>(
    `SELECT active, session_epoch, must_change_password FROM users WHERE id = ?`, user.id);
  if (!row || !row.active || (user.epoch ?? 0) < row.session_epoch) {
    throw new AppError('UNAUTHENTICATED', 'Session expired or invalid.');
  }
  return { ...user, mustChangePassword: row.must_change_password === 1 };
}

// Paths a user with must_change_password may still call.
const PASSWORD_CHANGE_PATHS = new Set(['/api/auth/change-password', '/api/auth/me', '/api/auth/logout']);

export async function requireUser(req: Request): Promise<SessionUser> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) throw new AppError('UNAUTHENTICATED', 'Authentication required.');
  const user = await resolveSession(token);
  if (user.mustChangePassword) {
    let path = '';
    try { path = new URL(req.url).pathname; } catch { /* no usable URL: not allowed */ }
    if (!PASSWORD_CHANGE_PATHS.has(path)) {
      throw new AppError('FORBIDDEN', 'Password change required before using the console.', { reason: 'PASSWORD_CHANGE_REQUIRED' });
    }
  }
  return user;
}

export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get('origin');
  if (!origin) {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
    throw new AppError('FORBIDDEN', 'Origin header required for state-changing requests.');
  }
  const host = req.headers.get('host');
  if (!host) return;
  try {
    const originHost = new URL(origin).host;
    if (originHost !== host) {
      throw new AppError('FORBIDDEN', 'Cross-origin request rejected.');
    }
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('FORBIDDEN', 'Invalid Origin header.');
  }
}

// bcrypt hash of an arbitrary value; only used to equalise timing for unknown or disabled users.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

export async function login(username: string, password: string): Promise<{ user: SessionUser; token: string }> {
  const row = dbHelper.get<{
    id: string; username: string; display_name: string; role: string;
    password_hash: string; active: number; session_epoch: number; must_change_password: number;
  }>(
    `SELECT id, username, display_name, role, password_hash, active, session_epoch, must_change_password
     FROM users WHERE username = ? COLLATE NOCASE`,
    username,
  );

  const valid = await bcrypt.compare(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !row.active || !valid) {
    throw new AppError('UNAUTHENTICATED', 'Invalid username or password.');
  }

  const user: SessionUser = {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role as 'organizer_admin' | 'organizer_operator',
    epoch: row.session_epoch,
    mustChangePassword: row.must_change_password === 1,
  };
  dbHelper.run(`UPDATE users SET last_login_at = ? WHERE id = ?`, new Date().toISOString(), row.id);

  const token = await createSession(user);
  return { user, token };
}

/** Secure when forced by COOKIE_SECURE=true or when the request arrived over HTTPS (X-Forwarded-Proto). */
function cookieSecure(req?: Request): boolean {
  return loadConfig().cookieSecure || req?.headers.get('x-forwarded-proto')?.split(',')[0].trim() === 'https';
}

export function setSessionCookie(response: Response, token: string, req?: Request): Response {
  const headers = new Headers(response.headers);
  headers.append(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DURATION_MS / 1000}${cookieSecure(req) ? '; Secure' : ''}`,
  );
  return new Response(response.body, { status: response.status, headers });
}

export function clearSessionCookie(req?: Request): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${cookieSecure(req) ? '; Secure' : ''}`;
}
