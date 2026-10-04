import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, jsonError, parseJson } from "@/lib/api";
import { ACCESS_COOKIE, ACCESS_MAX_AGE_S, accessCode, accessToken, codeMatches } from "@/lib/auth/access";

const schema = z.object({ code: z.string().max(200) });

/** Check the access code and remember this device. */
export const POST = handle(async (request: Request) => {
  const code = accessCode();
  if (!code) return NextResponse.json({ ok: true });
  const { code: entered } = await parseJson(request, schema);
  if (!codeMatches(entered, code)) {
    // Slow down guessing.
    await new Promise((r) => setTimeout(r, 800));
    return jsonError(403, "wrong_code", "That code isn't right.");
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ACCESS_COOKIE, await accessToken(code), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
    path: "/",
    maxAge: ACCESS_MAX_AGE_S,
  });
  return res;
});
