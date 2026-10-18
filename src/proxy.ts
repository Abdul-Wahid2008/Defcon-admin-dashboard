import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { getSessionSecret } from './lib/session-secret';

const SESSION_COOKIE = 'dc_session';

const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/meta'];

export async function proxy(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  // Allow public paths and static files
  if (
    PUBLIC_PATHS.some(p => pathname.startsWith(p)) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon')
  ) {
    return NextResponse.next();
  }

  // Allow all other /api/* routes to handle their own auth
  if (pathname.startsWith('/api/')) {
    return NextResponse.next();
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
    return NextResponse.next();
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
