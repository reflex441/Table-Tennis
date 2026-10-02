import { describe, expect, it } from "vitest";
import { pgConfig } from "@/lib/db-config";

describe("database connection settings", () => {
  it("encrypts without verifying for sslmode=require (hosted poolers)", () => {
    const c = pgConfig("postgresql://u:p@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres?sslmode=require", true);
    expect(c.ssl).toEqual({ rejectUnauthorized: false });
    expect(c.connectionString).toBe("postgresql://u:p@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres");
    expect(c.max).toBe(3);
  });

  it("leaves local and verify-full URLs alone", () => {
    expect(pgConfig("postgresql://tt:tt@db:5432/table_tennis?schema=public", false)).toEqual({
      connectionString: "postgresql://tt:tt@db:5432/table_tennis?schema=public",
      max: 10,
    });
    expect(pgConfig("postgresql://u:p@h/db?sslmode=verify-full", false).ssl).toBeUndefined();
  });
});
