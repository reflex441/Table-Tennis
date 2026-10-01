import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, jsonError, parseJson } from "@/lib/api";
import { SESSION_COOKIE, SESSION_MAX_AGE_S, authEnabled, checkPassword, createSessionToken } from "@/lib/auth/session";

const schema = z.object({ password: z.string().min(1).max(200) });

export const POST = handle(async (request: Request) => {
  if (!authEnabled()) return NextResponse.json({ ok: true });
  const { password } = await parseJson(request, schema);
  if (!checkPassword(password)) {
    await new Promise((r) => setTimeout(r, 500));
    return jsonError(401, "invalid_password", "Incorrect password.");
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
  return res;
});
