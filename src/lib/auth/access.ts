/**
 * Site-wide access code (ACCESS_CODE): when set, every page - including the
 * login page - first asks for the code. A device that entered it keeps a
 * cookie holding a hash of the code, so changing ACCESS_CODE locks everyone
 * out again until they enter the new one. Uses Web Crypto so it also runs in
 * the proxy.
 */

export const ACCESS_COOKIE = "tt_access";
export const ACCESS_MAX_AGE_S = 365 * 24 * 60 * 60;

/** The configured code, tidied like other pasted values ("" = no gate). */
export function accessCode(): string {
  let v = (process.env.ACCESS_CODE ?? "").trim();
  if (v.startsWith("ACCESS_CODE=")) v = v.slice("ACCESS_CODE=".length).trim();
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) v = v.slice(1, -1).trim();
  return v;
}

/** Cookie value for a code: a hash, so the code itself is never stored in the browser. */
export async function accessToken(code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`tt-access:${code}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Does this cookie value unlock the site? Always true when no code is set. */
export async function hasAccess(cookieValue: string | undefined): Promise<boolean> {
  const code = accessCode();
  if (!code) return true;
  return Boolean(cookieValue) && cookieValue === (await accessToken(code));
}

/** Codes are compared case-insensitively, ignoring spaces around them. */
export function codeMatches(entered: string, code: string): boolean {
  const a = entered.trim().toLowerCase();
  const b = code.trim().toLowerCase();
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
