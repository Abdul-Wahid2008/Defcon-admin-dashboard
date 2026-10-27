import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { getSessionSecret } from './lib/session-secret';

const SESSION_COOKIE = 'dc_session';

const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/meta'];

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Per-request CSP. Scripts need the request's nonce ('strict-dynamic' lets Next's own bootstrap load its chunks), so an
 * injected inline script cannot run. Styles keep 'unsafe-inline': React and the UI kit set style attributes, which a
 * nonce cannot cover. 'unsafe-eval' is development-only (React refresh).
 */
function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${isDev ? ' ws:' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** Continue to the route with the nonce visible to Next (it stamps it on its own scripts) and the CSP on the response. */
function proceed(req: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = contentSecurityPolicy(nonce);
  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
}

export async function proxy(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  // A malformed percent-escape must be a clean 400, not a framework 500.
  try { decodeURIComponent(pathname); } catch { return new NextResponse('Bad request', { status: 400 }); }

  // API routes return JSON and handle their own auth; they need no CSP.
  if (pathname.startsWith('/api/')) return NextResponse.next();

  // Public pages and static files
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p)) || pathname.startsWith('/_next') || pathname.startsWith('/favicon')) {
    return proceed(req);
  }

  // For page routes, verify session
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  try {
    await jwtVerify(token, getSessionSecret());
    return proceed(req);
  } catch {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    const res = NextResponse.redirect(url);
    res.cookies.delete(SESSION_COOKIE);
    return res;
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
