import type { PoolConfig } from "pg";

/**
 * Connection settings for node-postgres. Hosted databases (Supabase, Neon,
 * Railway...) give URLs with `sslmode=require`, which node-postgres treats as
 * "verify the certificate chain" and rejects the pooler's own CA. Use libpq's
 * meaning instead: encrypt, don't verify (verify-ca / verify-full still verify).
 * On serverless hosts each instance keeps only a few connections.
 */
export function pgConfig(connectionString: string, serverless = Boolean(process.env.VERCEL)): PoolConfig {
  const config: PoolConfig = { connectionString, max: serverless ? 3 : 10 };
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return config;
  }
  const mode = url.searchParams.get("sslmode");
  if (mode === "require" || mode === "prefer" || mode === "no-verify") {
    url.searchParams.delete("sslmode");
    config.connectionString = url.toString();
    config.ssl = { rejectUnauthorized: false };
  }
  return config;
}
