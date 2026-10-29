import { describe, expect, it } from "vitest";
import { discordDate, nbaDedupeKey, parseOdds, defaultGameDay } from "@/lib/nba/parse";
import { DEFAULT_BOOKMAKERS, DEFAULT_TIPSTERS, NBA_BOOKMAKERS, bookmakerFor, canonicalBookmaker, parseBookmakers, parseTipsters, tipsterFor } from "@/lib/nba/aliases";
import { NBA_PICKS_PROMPT, normalizeNbaPicks } from "@/lib/gemini/nba";
import { nbaBetSchema, nbaBetUpdateSchema } from "@/lib/validation/nba";
import { summarize } from "@/lib/bets/profit";

const tz = "Australia/Sydney";

describe("NBA picks", () => {
  it("turns odds into decimal (American odds too)", () => {
    expect(parseOdds("1.72")).toBe(1.72);
    expect(parseOdds("1.72 odds")).toBe(1.72);
    expect(parseOdds("$2.25")).toBe(2.25);
    expect(parseOdds("+138")).toBe(2.38);
    expect(parseOdds("-150")).toBe(1.67);
    expect(parseOdds("-110")).toBe(1.91);
    expect(parseOdds("+138 FD +137 NV, +134 CZR")).toBe(2.38);
    expect(parseOdds(3.65)).toBe(3.65);
    expect(parseOdds("")).toBeNull();
    expect(parseOdds("evens?")).toBeNull();
  });

  it("reads Discord timestamps in your timezone", () => {
    const now = new Date("2026-10-13T08:00:00Z"); // Tue 13 Oct, 7pm in Sydney
    expect(discordDate("Yesterday at 6:52 PM", tz, now)?.toISOString()).toBe("2026-10-12T07:52:00.000Z");
    expect(discordDate("Today at 9:05 AM", tz, now)?.toISOString()).toBe("2026-10-12T22:05:00.000Z");
    // 12-hour clock = US month/day; 24-hour = day/month.
    expect(discordDate("6/13/2026 5:00 AM", tz, now)?.toISOString()).toBe("2026-06-12T19:00:00.000Z");
    expect(discordDate("6/10/2026 5:00 AM", tz, now)?.toISOString()).toBe("2026-06-09T19:00:00.000Z");
    expect(discordDate("06/10/2026 17:00", tz, now)?.toISOString()).toBe("2026-10-06T06:00:00.000Z");
    expect(discordDate(null, tz, now)).toBeNull();
    expect(discordDate("whenever", tz, now)).toBeNull();
  });

  it("knows whose pick it is: Winible = ADP, anyone else by name", () => {
    expect(tipsterFor("Winible Bot", DEFAULT_TIPSTERS)).toBe("ADP");
    expect(tipsterFor("Winible Bot ✓ APP", DEFAULT_TIPSTERS)).toBe("ADP");
    expect(tipsterFor("Tyvan", DEFAULT_TIPSTERS)).toBe("Tyvan");
    expect(tipsterFor("Tyvan 🏀", DEFAULT_TIPSTERS)).toBe("Tyvan");
    expect(tipsterFor("Tyvan", [{ match: "tyvan", name: "TY" }])).toBe("TY");
    expect(tipsterFor(null, DEFAULT_TIPSTERS)).toBeNull();
  });

  it("knows the bookmaker: FD = Sportsbet, the first one listed", () => {
    expect(bookmakerFor("FD", DEFAULT_BOOKMAKERS)).toBe("Sportsbet");
    expect(bookmakerFor("Sportsbet", DEFAULT_BOOKMAKERS)).toBe("Sportsbet");
    expect(bookmakerFor("All on Sportsbet", DEFAULT_BOOKMAKERS)).toBe("Sportsbet");
    expect(bookmakerFor("+138 FD +137 NV, +134 CZR, +132 DK, +131 PB", DEFAULT_BOOKMAKERS)).toBe("Sportsbet");
    expect(bookmakerFor("DK", DEFAULT_BOOKMAKERS)).toBe("DraftKings");
    expect(bookmakerFor("TAB", DEFAULT_BOOKMAKERS)).toBe("Tab");
    // One spelling per bookmaker, so "PointsBet" and "Pointsbet" are counted once.
    expect(bookmakerFor("PB", DEFAULT_BOOKMAKERS)).toBe("Pointsbet");
    expect(bookmakerFor("PointsBet", [{ code: "P", name: "PointsBet" }])).toBe("Pointsbet");
    expect(["PointsBet", "points bet", "Pointsbet", "TAB", "bet 365", "LADBROKES", "sportsbet", "DraftKings", " "].map(canonicalBookmaker)).toEqual([
      "Pointsbet",
      "Pointsbet",
      "Pointsbet",
      "Tab",
      "Bet365",
      "Ladbrokes",
      "Sportsbet",
      "DraftKings",
      null,
    ]);
    expect(NBA_BOOKMAKERS).toEqual(["Bet365", "Ladbrokes", "Tab", "Sportsbet", "Pointsbet"]);
    expect(bookmakerFor("", DEFAULT_BOOKMAKERS)).toBeNull();
    // Never edited = the built-in lists; an edited (even empty) list is used as is.
    expect(parseTipsters(null)).toEqual(DEFAULT_TIPSTERS);
    expect(parseBookmakers([])).toEqual([]);
    expect(parseTipsters([{ match: "X", name: "Y" }, { bad: 1 }])).toEqual([{ match: "X", name: "Y" }]);
  });

  it("reads several bets from one message", () => {
    const bets = normalizeNbaPicks({
      bets: [
        { sender: "Winible Bot", postedText: "Yesterday at 6:52 PM", pick: "Knicks to record 8+ consecutive wins", market: "FUTURE", units: 1.5, oddsText: "1.72", bookmakerText: "Sportsbet" },
        { sender: "Winible Bot", postedText: "Yesterday at 6:52 PM", pick: "Celtics to record 8+ consecutive wins", market: "FUTURE", units: 1, oddsText: "1.62", bookmakerText: "Sportsbet" },
        { sender: "Tyvan", postedText: "6/13/2026 5:00 AM", pick: "De'Aaron Fox Over 1.5 3PM", market: "PLAYER_PROP", player: "De'Aaron Fox", stat: "3PM", line: 1.5, side: "over", units: "0.5", oddsText: "+138", bookmakerText: "FD", game: "New York Knicks @ San Antonio Spurs" },
        { sender: "x", pick: "", market: "WHAT" },
      ],
    });
    expect(bets).toHaveLength(3);
    expect(bets[2]).toMatchObject({ market: "PLAYER_PROP", player: "De'Aaron Fox", stat: "3PM", line: 1.5, side: "OVER", units: 0.5, oddsText: "+138" });
    expect(bets[0]).toMatchObject({ market: "FUTURE", units: 1.5, game: null, side: null });
    expect(() => normalizeNbaPicks({})).toThrow();
    expect(NBA_PICKS_PROMPT).toMatch(/All on Sportsbet/);
  });

  it("validates bets; an edit only changes what it sends", () => {
    expect(nbaBetSchema.parse({ tipster: "ADP", pick: "Knicks", stake: 1.5, placedAt: "2026-10-12T07:52:00Z" })).toMatchObject({ market: "OTHER", result: "PENDING", odds: null });
    expect(nbaBetUpdateSchema.parse({ stake: 2 })).toEqual({ stake: 2 });
    expect(nbaBetSchema.safeParse({ tipster: "", pick: "Knicks", stake: 1, placedAt: "2026-10-12T07:52:00Z" }).success).toBe(false);
    expect(nbaBetSchema.safeParse({ tipster: "ADP", pick: "Knicks", stake: 1, odds: 0.9, placedAt: "2026-10-12T07:52:00Z" }).success).toBe(false);
    expect(nbaDedupeKey("ADP", "Knicks  8+ wins", new Date("2026-10-12T07:52:31Z"))).toBe(nbaDedupeKey("adp", "knicks 8+ wins", new Date("2026-10-12T07:52:05Z")));
  });

  it("totals NBA and table tennis bets the same way", () => {
    const nba = [{ stake: 1.5, odds: 1.72, result: "WON" as const, profit: 1.08 }, { stake: 1, odds: 1.62, result: "LOST" as const, profit: -1 }];
    const tt = [{ stake: 1, odds: 1.85, result: "WON" as const, profit: 0.85 }];
    expect(summarize(nba)).toMatchObject({ bets: 2, won: 1, lost: 1, profit: 0.08, staked: 2.5 });
    expect(summarize([...nba, ...tt])).toMatchObject({ bets: 3, profit: 0.93, staked: 3.5 });
  });

  it("a scanned pick with no game day shown is for tomorrow", () => {
    const tz = "Australia/Sydney";
    // Scanned on Thursday 29 Oct (2pm in Sydney) -> the 30th.
    expect(defaultGameDay(new Date("2026-10-29T03:00:00Z"), tz).toISOString()).toBe("2026-10-30T01:00:00.000Z"); // midday on the 30th, Sydney
    // Just after midnight on the 30th -> the 31st.
    expect(defaultGameDay(new Date("2026-10-29T13:30:00Z"), tz).toISOString()).toBe("2026-10-31T01:00:00.000Z");
  });
});
