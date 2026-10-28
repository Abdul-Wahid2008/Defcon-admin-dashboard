/**
 * Clears the login limiter of a RUNNING server without a restart — run with: npm run unlock
 * Reads SESSION_SECRET from .env (so it only works on the machine that holds the secret) and calls the machine route
 * POST /api/auth/unlock-limiter. Env: UNLOCK_URL (default http://127.0.0.1:$PORT or :3000).
 */
import crypto from 'node:crypto';

try {
  process.loadEnvFile('.env');
} catch {
  // No .env file: rely on the process environment.
}

const secret = process.env.SESSION_SECRET ?? '';
if (secret.length < 32) {
  console.error('SESSION_SECRET is not set (or too short) in .env or the environment.');
  process.exit(1);
}
// Same derivation as unlockToken() in src/lib/server/auth.ts (that file is server-only, so it is repeated here).
const token = crypto.createHmac('sha256', secret).update('unlock-login-limiter').digest('hex');
const base = process.env.UNLOCK_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`;

async function main() {
  try {
    const res = await fetch(`${base}/api/auth/unlock-limiter`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      console.error(`Unlock failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      process.exit(1);
    }
    console.log('Login limiter cleared.');
  } catch (e) {
    console.error(`Could not reach ${base}: ${(e as Error).message}`);
    process.exit(1);
  }
}

void main();
