import { z } from "zod";

/**
 * Server-side environment variables. Never import this module from client
 * components: it contains secrets (Gemini key, VAPID private key, ...).
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  GEMINI_API_KEY: z.string().optional().default(""),
  GEMINI_MODEL: z.string().optional().default("gemini-flash-latest"),
  VAPID_PUBLIC_KEY: z.string().optional().default(""),
  VAPID_PRIVATE_KEY: z.string().optional().default(""),
  VAPID_SUBJECT: z.string().optional().default("mailto:admin@example.com"),
  CRON_SECRET: z.string().optional().default(""),
  SCHEDULER_MODE: z.enum(["inprocess", "worker", "external"]).optional().default("inprocess"),
  SCHEDULER_INTERVAL_MS: z.coerce.number().int().min(1000).max(60_000).optional().default(10_000),
  APP_PASSWORD: z.string().optional().default(""),
  SESSION_SECRET: z.string().optional().default(""),
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

export function isGeminiConfigured(): boolean {
  return Boolean(env().GEMINI_API_KEY);
}
