import type { PoolConfig } from "pg";

/**
 * Connection settings for node-postgres. Hosted databases (Supabase, Neon,
 * Railway...) give URLs with `sslmode=require`, which node-postgres treats as
 * "verify the certificate chain" and rejects the pooler's own CA. Use libpq's
 * meaning instead: encrypt, don't verify (verify-ca / verify-full still verify).
 * Supabase/Neon URLs without sslmode get the same. On serverless hosts each
 * instance keeps only a few connections.
 */
export function pgConfig(connectionString: string, serverless = Boolean(process.env.VERCEL)): PoolConfig {
  // Serverless: few connections per instance, released quickly when idle.
  const config: PoolConfig = serverless ? { connectionString, max: 3, idleTimeoutMillis: 5_000 } : { connectionString, max: 10 };
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return config;
  }
  const mode = url.searchParams.get("sslmode");
  // Hosted Postgres that requires SSL, even when the URL doesn't say so.
  const hostedNeedsSsl = mode === null && /\.(supabase\.(com|co)|neon\.tech)$/i.test(url.hostname);
  if (mode === "require" || mode === "prefer" || mode === "no-verify" || hostedNeedsSsl) {
    url.searchParams.delete("sslmode");
    config.connectionString = url.toString();
    config.ssl = { rejectUnauthorized: false };
  }
  return config;
}
