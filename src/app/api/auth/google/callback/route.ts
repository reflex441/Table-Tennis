import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { appOrigin, fetchGoogleProfile, redirectUri } from "@/lib/auth/google";
import { signInWithGoogle } from "@/lib/auth/accounts";
import { SESSION_COOKIE, createSessionToken, getSessionSecret, sessionCookieOptions } from "@/lib/auth/session";
import { ServiceError } from "@/lib/alarms/service-error";
import { safeNext } from "@/lib/validation/auth";

const OAUTH_COOKIE = "tt_oauth";

/** Google redirects back here with a code; sign the user in (creating the account if new). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  // Behind a proxy request.url can be an internal address: build redirects from the public origin.
  const origin = appOrigin(request);
  const fail = (code: string) => {
    const res = NextResponse.redirect(new URL(`/login?error=${code}`, origin));
    res.cookies.delete({ name: OAUTH_COOKIE, path: "/api/auth/google" });
    return res;
  };
  const [state, verifier, nextB64] = ((await cookies()).get(OAUTH_COOKIE)?.value ?? "").split(".");
  const returned = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error")) return fail("google_cancelled");
  if (!state || !verifier || !code || state.length !== returned.length || !timingSafeEqual(Buffer.from(state), Buffer.from(returned))) {
    return fail("google_state");
  }
  try {
    const profile = await fetchGoogleProfile({ code, verifier, redirectUri: redirectUri(request) });
    const prisma = db();
    const user = await signInWithGoogle(prisma, profile);
    const next = safeNext(nextB64 ? Buffer.from(nextB64, "base64url").toString() : "/");
    const res = NextResponse.redirect(new URL(next, origin));
    res.cookies.set(SESSION_COOKIE, createSessionToken(user.id, await getSessionSecret(prisma)), sessionCookieOptions);
    res.cookies.delete({ name: OAUTH_COOKIE, path: "/api/auth/google" });
    return res;
  } catch (err) {
    console.error("Google sign-in failed", err);
    return fail(err instanceof ServiceError ? err.code : "google_failed");
  }
}
