import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handle, jsonError, parseJson } from "@/lib/api";
import { registerUser, toPublicUser } from "@/lib/auth/accounts";
import { SESSION_COOKIE, createSessionToken, getSessionSecret, sessionCookieOptions } from "@/lib/auth/session";
import { clientIp, rateLimited } from "@/lib/auth/rate-limit";
import { registerSchema } from "@/lib/validation/auth";

/** Create an account with email + password and sign in. */
export const POST = handle(async (request: Request) => {
  if (rateLimited(`register:${clientIp(request)}`, 10, 60 * 60_000)) {
    return jsonError(429, "rate_limited", "Too many sign-ups from this network. Try again later.");
  }
  const input = await parseJson(request, registerSchema);
  const prisma = db();
  const user = await registerUser(prisma, input);
  const res = NextResponse.json({ user: toPublicUser(user) }, { status: 201 });
  res.cookies.set(SESSION_COOKIE, createSessionToken(user.id, await getSessionSecret(prisma)), sessionCookieOptions);
  return res;
});
