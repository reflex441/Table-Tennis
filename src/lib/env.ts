import { z } from "zod";

/**
 * Server-side environment variables. Never import this module from client
 * components: it contains secrets (Gemini key, VAPID private key, ...).
 */
/**
 * Tidies a value pasted into a hosting dashboard: surrounding spaces,
 * quotes ("..." or '...') and an accidental "NAME=" prefix.
 */
export function cleanEnvValue(value: string, name?: string): string {
  let v = value.trim();
  if (name && v.startsWith(`${name}=`)) v = v.slice(name.length + 1).trim();
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) v = v.slice(1, -1).trim();
  return v;
}

const pasted = (name: string) =>
  z
    .string()
    .optional()
    .default("")
    .transform((v) => cleanEnvValue(v, name));

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  /** Optional API base URL override (e.g. a corporate proxy or a local mock). */
  GEMINI_BASE_URL: z.string().optional().default(""),
  VAPID_PUBLIC_KEY: pasted("VAPID_PUBLIC_KEY"),
  VAPID_PRIVATE_KEY: pasted("VAPID_PRIVATE_KEY"),
  VAPID_SUBJECT: z.string().optional().default("mailto:admin@example.com"),
  CRON_SECRET: pasted("CRON_SECRET"),
  SCHEDULER_MODE: z.enum(["inprocess", "worker", "external"]).optional().default(process.env.VERCEL ? "external" : "inprocess"),
  SCHEDULER_INTERVAL_MS: z.coerce.number().int().min(1000).max(60_000).optional().default(10_000),
  /** Signs session cookies. Optional: a random secret is generated and stored in the database if unset. */
  SESSION_SECRET: z.string().optional().default(""),
  /** Google sign-in (optional). */
  GOOGLE_CLIENT_ID: z.string().optional().default(""),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(""),
  /** Public URL of the app, e.g. https://tt.example.com (used for the Google redirect URL). */
  APP_URL: z.string().optional().default(""),
  /** Comma-separated emails ranked on the leaderboard even below the 100-bet minimum. */
  LEADERBOARD_ALWAYS_SHOW: z.string().optional().default(""),
  /** The account everyone tails (default: the first account created). */
  TAILING_ACCOUNT_EMAIL: z.string().optional().default(""),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | null = null;

export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/**
 * What's wrong with the VAPID keys, in plain words, or null when they look
 * right. A public key is 87 base64url characters (65 bytes, starting with
 * "B"); a private key is 43 characters (32 bytes).
 */
export function vapidKeyProblem(publicKey: string, privateKey: string): string | null {
  if (!publicKey || !privateKey) return "Push notifications are not configured on the server (VAPID keys missing).";
  const b64url = /^[A-Za-z0-9_-]+=*$/;
  if (!b64url.test(publicKey) || !b64url.test(privateKey)) {
    return "The server's VAPID keys contain invalid characters. Re-paste them in your hosting settings without quotes or spaces.";
  }
  const pub = publicKey.replace(/=+$/, "");
  const priv = privateKey.replace(/=+$/, "");
  if (pub.length === 43 && priv.length === 87) return "The server's VAPID public and private keys are swapped. Swap VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in your hosting settings.";
  if (pub.length !== 87 || !pub.startsWith("B")) return "The server's VAPID_PUBLIC_KEY is not a valid public key (it should be 87 characters starting with B). Re-paste it, or generate a new pair with npm run vapid.";
  if (priv.length !== 43) return "The server's VAPID_PRIVATE_KEY is not a valid private key (it should be 43 characters). Re-paste it, or generate a new pair with npm run vapid.";
  return null;
}

export function isPushConfigured(): boolean {
  const e = env();
  return Boolean(e.VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY);
}
