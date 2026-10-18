import 'server-only';
import { dbHelper } from './db';
import { AppError } from './errors';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const SESSION_COOKIE = 'dc_session';
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000; // 8 hours

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET || 'change-me-32-chars-minimum-secret!';
  return new TextEncoder().encode(secret);
}

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: 'organizer_admin' | 'organizer_operator';
}

// In-memory login rate limiter: key = `${ip}:${username}` → { count, resetAt }
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const LOCKOUT_MS = 60 * 1000;     // 1 minute

export function checkLoginRateLimit(ip: string, username: string): void {
  const key = `${ip}:${username.toLowerCase()}`;
  const now = Date.now();
  const entry = loginAttempts.get(key);

  if (entry && now < entry.resetAt) {
    if (entry.count >= MAX_ATTEMPTS) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      throw new AppError('RATE_LIMITED', `Too many login attempts. Retry after ${retryAfter}s.`, {
        retryAfter,
      });
    }
  }
}

export function recordLoginFailure(ip: string, username: string): void {
  const key = `${ip}:${username.toLowerCase()}`;
  const now = Date.now();
  const entry = loginAttempts.get(key);

  if (!entry || now >= entry.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    entry.count++;
    if (entry.count >= MAX_ATTEMPTS) {
      entry.resetAt = now + LOCKOUT_MS;
    }
  }
}

export function clearLoginAttempts(ip: string, username: string): void {
  loginAttempts.delete(`${ip}:${username.toLowerCase()}`);
}

export async function createSession(user: SessionUser): Promise<string> {
  const now = Date.now();
  const token = await new SignJWT({
    sub: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(Math.floor(now / 1000))
    .setExpirationTime(Math.floor((now + SESSION_DURATION_MS) / 1000))
    .sign(getSecret());

  return token;
}

export async function verifySession(token: string): Promise<SessionUser> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return {
      id: payload.sub as string,
      username: payload['username'] as string,
      displayName: payload['displayName'] as string,
      role: payload['role'] as 'organizer_admin' | 'organizer_operator',
    };
  } catch {
    throw new AppError('UNAUTHENTICATED', 'Session expired or invalid.');
  }
}

export async function requireUser(req: Request): Promise<SessionUser> {
  void req;
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) throw new AppError('UNAUTHENTICATED', 'Authentication required.');
  return verifySession(token);
}

export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get('origin');
  if (!origin) return; // same-origin browser requests may omit Origin on GET; only enforce for mutations
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

export async function login(username: string, password: string): Promise<{ user: SessionUser; token: string }> {
  const row = dbHelper.get<{
    id: string; username: string; display_name: string; role: string;
    password_hash: string; active: number;
  }>(
    `SELECT id, username, display_name, role, password_hash, active FROM users WHERE username = ? COLLATE NOCASE`,
    username,
  );

  if (!row || !row.active) {
    throw new AppError('UNAUTHENTICATED', 'Invalid username or password.');
  }

  const valid = await bcrypt.compare(password, row.password_hash);
  if (!valid) {
    throw new AppError('UNAUTHENTICATED', 'Invalid username or password.');
  }

  const user: SessionUser = {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role as 'organizer_admin' | 'organizer_operator',
  };

  const token = await createSession(user);
  return { user, token };
}

export function setSessionCookie(response: Response, token: string): Response {
  const isHttps = process.env.NODE_ENV === 'production';
  const headers = new Headers(response.headers);
  headers.append(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DURATION_MS / 1000}${isHttps ? '; Secure' : ''}`,
  );
  return new Response(response.body, { status: response.status, headers });
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}
