import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { ACCESS_COOKIE, hasAccess } from "@/lib/auth/access";

/**
 * Two gates, in order:
 * 1. Access code (ACCESS_CODE): when set, nothing - not even the login page -
 *    opens without it. The alarm checker (cron) and the service worker stay
 *    reachable.
 * 2. Account: everything requires signing in. This is a fast check on the
 *    session cookie; every page and API route also verifies the session
 *    against the database before touching any data.
 */
const ACCESS_FREE = ["/access", "/api/access", "/api/cron/dispatch", "/api/health", "/sw.js", "/manifest.webmanifest"];
const PUBLIC_PATHS = ["/login", "/signup", "/api/cron/dispatch", "/api/health", "/sw.js", "/manifest.webmanifest", "/access", "/api/access"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const next = encodeURIComponent(pathname + request.nextUrl.search);

  if (!ACCESS_FREE.includes(pathname) && !(await hasAccess(request.cookies.get(ACCESS_COOKIE)?.value))) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: { code: "access_required", message: "Enter the access code first." } }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/access";
    url.search = `?next=${next}`;
    return NextResponse.redirect(url);
  }

  if (PUBLIC_PATHS.includes(pathname) || pathname.startsWith("/api/auth/")) return NextResponse.next();
  if (request.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Sign in required." } }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${next}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/).*)"],
};
