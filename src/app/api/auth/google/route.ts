import { NextResponse } from "next/server";
import { appOrigin, googleAuthUrl, googleConfigured, newOAuthRequest, redirectUri } from "@/lib/auth/google";
import { safeNext } from "@/lib/validation/auth";

const OAUTH_COOKIE = "tt_oauth";

/** Start "Continue with Google": redirect to Google's consent screen. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!googleConfigured()) return NextResponse.redirect(new URL("/login?error=google_not_configured", appOrigin(request)));
  const { state, verifier, challenge } = newOAuthRequest();
  const next = safeNext(url.searchParams.get("next"));
  const res = NextResponse.redirect(googleAuthUrl({ redirectUri: redirectUri(request), state, challenge }));
  res.cookies.set(OAUTH_COOKIE, `${state}.${verifier}.${Buffer.from(next).toString("base64url")}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
    path: "/api/auth/google",
    maxAge: 10 * 60,
  });
  return res;
}
