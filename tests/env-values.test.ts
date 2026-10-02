import { describe, expect, it } from "vitest";
import { cleanEnvValue, vapidKeyProblem } from "@/lib/env";

const PUB = "BKdM9TaZDnqxYLD3vgs-Sfa3rWjUYtZXXFbatUneeplFpEIvswtYTWWcosBJF2TZcK3MFRnAqC-TtxNK53csDNM";
const PRIV = "pzH7vc49QwHlExQfIsGfIld2xIpjsApA4Ib0oYQwr7g";

describe("pasted environment values", () => {
  it("strips spaces, quotes and a NAME= prefix", () => {
    expect(cleanEnvValue(`  "${PUB}" `, "VAPID_PUBLIC_KEY")).toBe(PUB);
    expect(cleanEnvValue(`'${PRIV}'`, "VAPID_PRIVATE_KEY")).toBe(PRIV);
    expect(cleanEnvValue(`VAPID_PUBLIC_KEY="${PUB}"`, "VAPID_PUBLIC_KEY")).toBe(PUB);
    expect(cleanEnvValue(PUB, "VAPID_PUBLIC_KEY")).toBe(PUB);
  });

  it("explains broken VAPID keys", () => {
    expect(vapidKeyProblem(PUB, PRIV)).toBeNull();
    expect(vapidKeyProblem("", "")).toMatch(/not configured/);
    expect(vapidKeyProblem(PRIV, PUB)).toMatch(/swapped/);
    expect(vapidKeyProblem(PUB.slice(0, 60), PRIV)).toMatch(/VAPID_PUBLIC_KEY is not a valid public key/);
    expect(vapidKeyProblem(PUB, PRIV + "xx")).toMatch(/VAPID_PRIVATE_KEY is not a valid private key/);
    expect(vapidKeyProblem(`${PUB} extra`, PRIV)).toMatch(/invalid characters/);
  });
});
