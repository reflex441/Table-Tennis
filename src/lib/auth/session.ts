import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Signed session cookie: "v2.<userId>.<expires>.<signature>". The signing key
 * is SESSION_SECRET, or a random key generated once and stored in the
 * database, so sessions survive restarts with no configuration.
 */

export const SESSION_COOKIE = "tt_session";
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30;

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function createSessionToken(userId: string, secret: string, now = Date.now()): string {
  if (!secret) throw new Error("Session secret missing");
  const expires = Math.floor(now / 1000) + SESSION_MAX_AGE_S;
  const payload = `v2.${userId}.${expires}`;
  return `${payload}.${sign(payload, secret)}`;
}

/** The user id in a valid, unexpired token; otherwise null. */
export function verifySessionToken(token: string | undefined, secret: string, now = Date.now()): string | null {
  if (!token || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v2" || !/^[a-z0-9]+$/i.test(parts[1])) return null;
  const payload = parts.slice(0, 3).join(".");
  const expected = Buffer.from(sign(payload, secret));
  const actual = Buffer.from(parts[3]);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return Number(parts[2]) * 1000 > now ? parts[1] : null;
}

let cachedSecret: string | null = null;

/** SESSION_SECRET, else a persistent random secret stored in the database. */
export async function getSessionSecret(prisma: PrismaClient): Promise<string> {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16) return process.env.SESSION_SECRET;
  if (cachedSecret) return cachedSecret;
  await prisma.appSecret.createMany({ data: [{ name: "session", value: randomBytes(32).toString("base64url") }], skipDuplicates: true });
  const row = await prisma.appSecret.findUniqueOrThrow({ where: { name: "session" } });
  cachedSecret = row.value;
  return cachedSecret;
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
  path: "/",
  maxAge: SESSION_MAX_AGE_S,
};
