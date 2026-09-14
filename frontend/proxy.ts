import { NextResponse, type NextRequest } from 'next/server';

/**
 * Next 16 renamed the middleware convention to proxy. It runs on the Node
 * runtime only and the runtime is not configurable.
 *
 * This is an optimistic gate and nothing more: it reads whether a session cookie
 * is present so an unauthenticated visitor is redirected before a dashboard
 * flashes. It never decodes a role and never grants anything. Every real
 * authorization decision is made again in Express, next to the data, on every
 * request. See docs/adr/0004.
 */
const PROTECTED = ['/owner', '/reseller'];

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has('cm_at') || request.cookies.has('cm_rt');

  /*
   * The root is the landing page for a visitor and the app for someone signed
   * in, because it is also the installed app's start URL and the same icon is
   * tapped by the owner and by resellers. The role is not read here, so a
   * signed-in visitor goes to /login, which already sends a live session to its
   * own dashboard and shows the form to a dead one.
   */
  if (pathname === '/') {
    return hasSession ? NextResponse.redirect(new URL('/login', request.url)) : NextResponse.next();
  }

  const needsSession = PROTECTED.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  if (!needsSession) return NextResponse.next();

  if (hasSession) return NextResponse.next();

  const login = new URL('/login', request.url);
  login.searchParams.set('next', pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/', '/owner/:path*', '/reseller/:path*'],
};
