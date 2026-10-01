import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Optional single-user password protection. When APP_PASSWORD is set every
 * page and API route (except login, the cron endpoint and static assets)
 * requires a signed session cookie.
 */

export const SESSION_COOKIE = "tt_session";
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30;

export function authEnabled(): boolean {
  return Boolean(process.env.APP_PASSWORD);
}

function secret(): string {
  const s = process.env.SESSION_SECRET || process.env.APP_PASSWORD || "";
  return s;
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

export function createSessionToken(now = Date.now()): string {
  const expires = Math.floor(now / 1000) + SESSION_MAX_AGE_S;
  const payload = `v1.${expires}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const payload = `${parts[0]}.${parts[1]}`;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(parts[2]);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
  return Number(parts[1]) * 1000 > now;
}

export function checkPassword(candidate: string): boolean {
  const expected = Buffer.from(process.env.APP_PASSWORD ?? "");
  const actual = Buffer.from(candidate);
  return expected.length > 0 && expected.length === actual.length && timingSafeEqual(expected, actual);
}
