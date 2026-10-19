import { describe, expect, it } from "vitest";
import { POLL_SECONDS, savingLevel, type SavingLevel } from "@/lib/usage/budget";

const H = 3_600_000;

describe("staying within the free server time", () => {
  it("steps up saving at 35%, 55% and 75% of the allowance", () => {
    const budget = 4 * H;
    expect(savingLevel(0, budget)).toBe(0);
    expect(savingLevel(1.39 * H, budget)).toBe(0);
    expect(savingLevel(1.4 * H, budget)).toBe(1);
    expect(savingLevel(2.2 * H, budget)).toBe(2);
    expect(savingLevel(3 * H, budget)).toBe(3);
    expect(savingLevel(10 * H, budget)).toBe(3);
  });

  it("each step checks the server less often, never more", () => {
    const levels: SavingLevel[] = [0, 1, 2, 3];
    for (let i = 1; i < levels.length; i++) {
      const a = POLL_SECONDS[levels[i - 1]];
      const b = POLL_SECONDS[levels[i]];
      expect(b.notifications).toBeGreaterThanOrEqual(a.notifications);
      expect(b.ringer).toBeGreaterThanOrEqual(a.ringer);
      // 0 = no timed reload at all.
      expect(b.dashboard === 0 || b.dashboard >= a.dashboard).toBe(true);
    }
    // The computer alarm always keeps checking at least every minute.
    expect(Math.max(...levels.map((l) => POLL_SECONDS[l].ringer))).toBeLessThanOrEqual(60);
  });
});
