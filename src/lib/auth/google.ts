import { createHash, randomBytes } from "node:crypto";

/** Google sign-in (OAuth 2.0 authorization code flow with PKCE). */

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/** Public URL of the app (APP_URL, else derived from the request). */
export function appOrigin(request: Request): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, "");
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0] || url.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host")?.split(",")[0] || request.headers.get("host") || url.host;
  return `${proto}://${host}`;
}

export const redirectUri = (request: Request) => `${appOrigin(request)}/api/auth/google/callback`;

export function newOAuthRequest() {
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { state, verifier, challenge };
}

export function googleAuthUrl(opts: { redirectUri: string; state: string; challenge: string }): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: opts.state,
    code_challenge: opts.challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
}

/** Exchange the code for tokens and read the user's profile from Google. */
export async function fetchGoogleProfile(opts: { code: string; verifier: string; redirectUri: string; fetchImpl?: typeof fetch }): Promise<GoogleProfile> {
  const f = opts.fetchImpl ?? fetch;
  const tokenRes = await f("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: opts.code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: opts.redirectUri,
      grant_type: "authorization_code",
      code_verifier: opts.verifier,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!tokenRes.ok) throw new Error(`Google token exchange failed (${tokenRes.status})`);
  const tokens = (await tokenRes.json()) as { access_token?: string };
  if (!tokens.access_token) throw new Error("Google returned no access token");
  const infoRes = await f("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!infoRes.ok) throw new Error(`Google profile request failed (${infoRes.status})`);
  const info = (await infoRes.json()) as { sub?: string; email?: string; email_verified?: boolean | string; name?: string };
  if (!info.sub || !info.email) throw new Error("Google did not return an email address");
  return { sub: info.sub, email: info.email, emailVerified: info.email_verified === true || info.email_verified === "true", name: info.name ?? null };
}
