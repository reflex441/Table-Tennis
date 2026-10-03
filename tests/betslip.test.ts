import { describe, expect, it } from "vitest";
import { normalizeBetSlips, slipDate, slipResult, BET_SLIP_PROMPT } from "@/lib/gemini/betslip";
import { generateJsonFromImage } from "@/lib/gemini/extract";
import { pastBetSchema } from "@/lib/validation/match";

describe("bet slips", () => {
  it("'Win' is won and 'No Return' is lost", () => {
    expect(slipResult("Win")).toBe("WON");
    expect(slipResult("WON $36.00")).toBe("WON");
    expect(slipResult("No Return")).toBe("LOST");
    expect(slipResult("no return")).toBe("LOST");
    expect(slipResult("Refund")).toBe("VOID");
    expect(slipResult(null)).toBe("PENDING");
    expect(slipResult("Open")).toBe("PENDING");
  });

  it("reads the bets from Gemini's reply", () => {
    const bets = normalizeBetSlips({
      bets: [
        { player1: "Blazej Warpas", player2: "Frantisek Krcil", competition: "TT Elite Series", selection: "over", pointsLine: 73.5, odds: "1.80", stake: "$20.00", resultText: "Win", dateText: "Fri 2 Oct", timeText: "4:55 PM" },
        { player1: "Kolek M.", player2: "Lamparski M.", competition: null, selection: "UNDER", pointsLine: 74.5, odds: 1.87, stake: 10, resultText: "No Return", dateText: null, timeText: null },
        { player1: null, player2: null },
      ],
    });
    expect(bets).toHaveLength(2);
    expect(bets[0]).toMatchObject({ selection: "OVER", odds: 1.8, stake: 20, result: "WON", resultText: "Win" });
    expect(bets[1]).toMatchObject({ selection: "UNDER", result: "LOST" });
    expect(() => normalizeBetSlips({ nothing: true })).toThrow();
  });

  it("works out the date in your timezone", () => {
    const now = new Date("2026-10-03T02:00:00Z"); // 12:00 Sat 3 Oct in Sydney
    const tz = "Australia/Sydney";
    expect(slipDate("Fri 2 Oct", "4:55 PM", tz, now)?.toISOString()).toBe("2026-10-02T06:55:00.000Z");
    expect(slipDate("Friday 2nd October 2026", "16:55", tz, now)?.toISOString()).toBe("2026-10-02T06:55:00.000Z");
    expect(slipDate("02/10/2026", null, tz, now)?.toISOString()).toBe("2026-10-02T02:00:00.000Z"); // no time: midday
    expect(slipDate("28 Dec", "9:00 PM", tz, now)?.toISOString()).toBe("2025-12-28T10:00:00.000Z"); // last year, not the future
    expect(slipDate(null, "4:55 PM", tz, now)).toBeNull();
    expect(slipDate("gibberish", null, tz, now)).toBeNull();
  });

  it("sends the bet-slip prompt to Gemini", async () => {
    let prompt = "";
    const client = {
      models: {
        generateContent: async (req: { contents: { parts: { text?: string }[] }[] }) => {
          prompt = req.contents[0].parts.find((p) => p.text)?.text ?? "";
          return { text: JSON.stringify({ bets: [{ player1: "A", player2: "B", resultText: "No Return" }] }) };
        },
      },
    };
    const out = await generateJsonFromImage({ apiKey: "", client: client as never, model: "m", image: Buffer.from("x"), mimeType: "image/png", prompt: BET_SLIP_PROMPT, schema: {} });
    expect(prompt).toMatch(/No Return/);
    expect(normalizeBetSlips(out.raw)[0].result).toBe("LOST");
  });

  it("validates a past bet", () => {
    const base = { player1: "A", player2: "B", startsAt: "2026-10-02T06:55:00Z", timezone: "Australia/Sydney", playType: "BOT", stake: 1, result: "WON" };
    expect(pastBetSchema.parse({ ...base, odds: 1.8 })).toMatchObject({ odds: 1.8, selection: null, competition: null });
    expect(pastBetSchema.safeParse({ ...base, stake: 0 }).success).toBe(false);
    expect(pastBetSchema.safeParse({ ...base, result: "MAYBE" }).success).toBe(false);
  });
});
