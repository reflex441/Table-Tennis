import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth/current";
import { handle, jsonError, parseJson } from "@/lib/api";
import { setPassword } from "@/lib/auth/accounts";
import { clientIp, rateLimited } from "@/lib/auth/rate-limit";
import { setPasswordSchema } from "@/lib/validation/auth";

/** Set a password (accounts without one) or change it (needs the current one). */
export const POST = handle(async (request: Request) => {
  const userId = await requireUserId();
  if (rateLimited(`password:${userId}:${clientIp(request)}`, 10, 15 * 60_000)) {
    return jsonError(429, "rate_limited", "Too many attempts. Wait 15 minutes and try again.");
  }
  await setPassword(db(), userId, await parseJson(request, setPasswordSchema));
  return new NextResponse(null, { status: 204 });
});
