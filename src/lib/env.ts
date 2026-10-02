import { z } from "zod";

/**
 * Server-side environment variables. Never import this module from client
 * components: it contains secrets (Gemini key, VAPID private key, ...).
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  /** Optional API base URL override (e.g. a corporate proxy or a local mock). */
  GEMINI_BASE_URL: z.string().optional().default(""),
  VAPID_PUBLIC_KEY: z.string().optional().default(""),
  VAPID_PRIVATE_KEY: z.string().optional().default(""),
  VAPID_SUBJECT: z.string().optional().default("mailto:admin@example.com"),
  CRON_SECRET: z.string().optional().default(""),
  SCHEDULER_MODE: z.enum(["inprocess", "worker", "external"]).optional().default("inprocess"),
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

export function isPushConfigured(): boolean {
  const e = env();
  return Boolean(e.VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY);
}
