import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handle, jsonError, parseJson } from "@/lib/api";
import { authenticate, normalizeEmail, toPublicUser } from "@/lib/auth/accounts";
import { SESSION_COOKIE, createSessionToken, getSessionSecret, sessionCookieOptions } from "@/lib/auth/session";
import { clientIp, rateLimited } from "@/lib/auth/rate-limit";
import { loginSchema } from "@/lib/validation/auth";

/** Sign in with email + password. */
export const POST = handle(async (request: Request) => {
  const { email, password } = await parseJson(request, loginSchema);
  const ip = clientIp(request);
  if (rateLimited(`login:${ip}`, 30, 15 * 60_000) || rateLimited(`login:${normalizeEmail(email)}`, 10, 15 * 60_000)) {
    return jsonError(429, "rate_limited", "Too many sign-in attempts. Wait 15 minutes and try again.");
  }
  const prisma = db();
  const user = await authenticate(prisma, email, password);
  if (!user) return jsonError(401, "invalid_credentials", "Wrong email or password. If you signed up with Google, use Continue with Google.");
  const res = NextResponse.json({ user: toPublicUser(user) });
  res.cookies.set(SESSION_COOKIE, createSessionToken(user.id, await getSessionSecret(prisma)), sessionCookieOptions);
  return res;
});
