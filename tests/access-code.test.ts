import { afterEach, describe, expect, it } from "vitest";
import { accessCode, accessToken, codeMatches, hasAccess } from "@/lib/auth/access";

describe("access code", () => {
  afterEach(() => {
    delete process.env.ACCESS_CODE;
  });

  it("no code set: everyone gets in", async () => {
    expect(accessCode()).toBe("");
    expect(await hasAccess(undefined)).toBe(true);
  });

  it("with a code: only the right cookie gets in", async () => {
    process.env.ACCESS_CODE = ' "Pingpong2026" ';
    expect(accessCode()).toBe("Pingpong2026");
    expect(await hasAccess(undefined)).toBe(false);
    expect(await hasAccess("nope")).toBe(false);
    const token = await accessToken("Pingpong2026");
    expect(token).not.toContain("Pingpong2026");
    expect(await hasAccess(token)).toBe(true);
    // Changing the code locks old devices out.
    process.env.ACCESS_CODE = "NewCode";
    expect(await hasAccess(token)).toBe(false);
  });

  it("compares codes ignoring case and surrounding spaces", () => {
    expect(codeMatches(" pingpong2026 ", "Pingpong2026")).toBe(true);
    expect(codeMatches("pingpong", "Pingpong2026")).toBe(false);
    expect(codeMatches("", "x")).toBe(false);
  });
});
