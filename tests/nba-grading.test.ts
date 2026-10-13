import { describe, expect, it } from "vitest";
import { createEspnClient, espnDay, parseBoxScore, parseScoreboard } from "@/lib/nba/espn";
import { findPlayer, gameTimeFromText, gradeBet, mentionsTeam, statCode, type Gradable } from "@/lib/nba/grade";
import { KNICKS, SCOREBOARD_20260613, SIXERS, SUMMARY_401, SUMMARY_402, fakeEspn } from "./fixtures/espn";

const tipOff = new Date("2026-06-14T00:40:00Z"); // Sat 8:40 PM ET
const after = new Date("2026-06-14T04:00:00Z");
const bet = (b: Partial<Gradable>): Gradable => ({ market: "PLAYER_PROP", pick: "", team: null, game: null, player: null, stat: null, line: null, side: null, placedAt: tipOff, ...b });

describe("NBA results from ESPN", () => {
  it("reads ESPN's scoreboard and box scores", () => {
    const games = parseScoreboard(SCOREBOARD_20260613);
    expect(games.map((g) => [g.id, g.state, g.completed, g.statusName])).toEqual([
      ["401", "post", true, "STATUS_FINAL"],
      ["402", "in", false, "STATUS_IN_PROGRESS"],
      ["403", "post", true, "STATUS_POSTPONED"],
    ]);
    expect(games[0].teams.map((t) => [t.name, t.score, t.winner, t.homeAway])).toEqual([
      ["Spurs", 112, true, "home"],
      ["Knicks", 108, false, "away"],
    ]);
    const box = parseBoxScore(SUMMARY_401);
    expect(box.find((p) => p.name === "De'Aaron Fox")).toMatchObject({ didNotPlay: false, stats: { pts: 23, reb: 4, ast: 7, threes: 3, stl: 2, blk: 0, to: 2, min: 34 } });
    expect(box.find((p) => p.name === "Mitchell Robinson")).toMatchObject({ didNotPlay: true, stats: null });
    // Labels only (no keys) still works.
    expect(parseBoxScore(SUMMARY_402)[0]).toMatchObject({ name: "Jayson Tatum", stats: { pts: 16, threes: 2, reb: 6 } });
    // Anything unexpected = nothing, never a crash.
    expect(parseScoreboard({ nope: 1 })).toEqual([]);
    expect(parseScoreboard(null)).toEqual([]);
    expect(parseBoxScore({ boxscore: { players: [{ statistics: [{ athletes: [{ athlete: {} }] }] }] } })).toEqual([]);
    expect(espnDay(tipOff)).toBe("20260613");
  });

  it("finds players and teams the way tipsters write them", () => {
    const box = parseBoxScore(SUMMARY_401);
    expect(findPlayer("De'Aaron Fox", box)?.name).toBe("De'Aaron Fox");
    expect(findPlayer("Deaaron Fox", box)?.name).toBe("De'Aaron Fox");
    expect(findPlayer("D. Fox", box)?.name).toBe("De'Aaron Fox");
    expect(findPlayer("Fox", box)?.name).toBe("De'Aaron Fox");
    expect(findPlayer("Wemby", box)).toBeNull();
    expect(findPlayer("J. Fox", box)).toBeNull();
    expect(mentionsTeam("knicks", KNICKS)).toBe(true);
    expect(mentionsTeam("New York Knicks @ San Antonio Spurs", KNICKS)).toBe(true);
    expect(mentionsTeam("NY @ SA", KNICKS)).toBe(true);
    expect(mentionsTeam("ny", KNICKS)).toBe(false);
    expect(mentionsTeam("Sixers ML", SIXERS)).toBe(true);
    expect(mentionsTeam("Celtics -4.5", KNICKS)).toBe(false);
    expect(statCode("2+ MADE THREES")).toBe("3PM");
    expect(statCode("Pts + Reb + Ast")).toBe("PRA");
  });

  it("settles player props from the box score", async () => {
    const espn = fakeEspn();
    const fox = { player: "De'Aaron Fox", stat: "3PM", game: "New York Knicks @ San Antonio Spurs", pick: "De'Aaron Fox Over 1.5 3PM" };
    expect(await gradeBet(bet({ ...fox, line: 1.5, side: "OVER" }), espn, after)).toEqual({ kind: "settled", result: "WON", note: "De'Aaron Fox: 3 threes (line 1.5).", eventId: "401" });
    expect(await gradeBet(bet({ ...fox, line: 2.5, side: "UNDER" }), espn, after)).toMatchObject({ result: "LOST" });
    expect(await gradeBet(bet({ ...fox, line: 3, side: "OVER" }), espn, after)).toMatchObject({ result: "VOID" }); // push
    expect(await gradeBet(bet({ ...fox, line: 1.5 }), espn, after)).toMatchObject({ result: "WON" }); // no side = over
    // No team given: found by looking through the day's box scores.
    expect(await gradeBet(bet({ player: "Jalen Brunson", stat: "PRA", line: 38.5, side: "OVER" }), espn, after)).toMatchObject({ result: "WON", note: "Jalen Brunson: 40 pts+reb+ast (line 38.5)." });
    // Didn't play = void.
    expect(await gradeBet(bet({ player: "Mitchell Robinson", stat: "REB", line: 7.5, side: "OVER", team: "Knicks" }), espn, after)).toMatchObject({ result: "VOID", note: "Mitchell Robinson didn't play - void." });
    // Game still on: wait.
    expect(await gradeBet(bet({ player: "Jayson Tatum", stat: "PTS", line: 25.5, side: "OVER" }), espn, after)).toMatchObject({ kind: "wait", eventId: "402" });
    // Missing details: left for you.
    expect(await gradeBet(bet({ player: "De'Aaron Fox", stat: "3PM" }), espn, after)).toMatchObject({ kind: "manual" });
    expect(await gradeBet(bet({ stat: "3PM", line: 1.5 }), espn, after)).toMatchObject({ kind: "manual" });
    // Not found yet: keep looking for 2 days, then leave it to you.
    expect(await gradeBet(bet({ player: "Nobody Atall", stat: "PTS", line: 1.5 }), espn, after)).toMatchObject({ kind: "wait" });
    expect(await gradeBet(bet({ player: "Nobody Atall", stat: "PTS", line: 1.5 }), espn, new Date("2026-06-17T00:00:00Z"))).toMatchObject({ kind: "manual" });
  });

  it("settles moneylines, spreads and totals from the final score", async () => {
    const espn = fakeEspn();
    const game = "Knicks @ Spurs";
    expect(await gradeBet(bet({ market: "MONEYLINE", pick: "Knicks ML", team: "Knicks" }), espn, after)).toMatchObject({ result: "LOST", note: "Knicks lost. Final: Knicks 108 - 112 Spurs." });
    expect(await gradeBet(bet({ market: "MONEYLINE", pick: "Spurs ML" }), espn, after)).toMatchObject({ result: "WON" });
    expect(await gradeBet(bet({ market: "SPREAD", pick: "Spurs -3.5", team: "Spurs", line: -3.5 }), espn, after)).toMatchObject({ result: "WON" });
    expect(await gradeBet(bet({ market: "SPREAD", pick: "Spurs -4.5", team: "Spurs", line: -4.5 }), espn, after)).toMatchObject({ result: "LOST" });
    expect(await gradeBet(bet({ market: "SPREAD", pick: "Knicks +4", team: "Knicks", line: 4 }), espn, after)).toMatchObject({ result: "VOID" });
    expect(await gradeBet(bet({ market: "TOTAL", pick: "Over 215.5", game, line: 215.5, side: "OVER" }), espn, after)).toMatchObject({ result: "WON", note: "220 points in total. Final: Knicks 108 - 112 Spurs." });
    expect(await gradeBet(bet({ market: "TOTAL", pick: "Under 215.5", game, line: 215.5, side: "UNDER" }), espn, after)).toMatchObject({ result: "LOST" });
    // Both teams in the pick: which one is the bet on? Left for you.
    expect(await gradeBet(bet({ market: "MONEYLINE", pick: "Knicks vs Spurs" }), espn, after)).toMatchObject({ kind: "manual" });
    expect(await gradeBet(bet({ market: "MONEYLINE", pick: "Celtics ML", team: "Celtics" }), espn, after)).toMatchObject({ kind: "wait" });
    expect(await gradeBet(bet({ market: "MONEYLINE", pick: "Sixers ML", team: "76ers" }), espn, after)).toMatchObject({ kind: "manual", note: expect.stringMatching(/postponed/) });
    expect(await gradeBet(bet({ market: "FUTURE", pick: "Knicks to record 8+ consecutive wins" }), espn, after)).toMatchObject({ kind: "manual" });
    // Posted the day before (Sydney time): still finds the next game.
    expect(await gradeBet(bet({ market: "MONEYLINE", pick: "Spurs", team: "Spurs", placedAt: new Date("2026-06-12T19:00:00Z") }), espn, after)).toMatchObject({ result: "WON" });
  });

  it("reads the game time from a slip", () => {
    const posted = new Date("2026-06-12T19:00:00Z"); // Fri 12 Jun, 3 PM ET
    expect(gameTimeFromText("SAT 8:40PM ET", posted, "Australia/Sydney")?.toISOString()).toBe("2026-06-14T00:40:00.000Z");
    expect(gameTimeFromText("Tonight 7:30 PM ET", posted, "Australia/Sydney")?.toISOString()).toBe("2026-06-12T23:30:00.000Z");
    expect(gameTimeFromText("Oct 12 7:00 PM ET", posted, "Australia/Sydney")?.toISOString()).toBe("2026-10-12T23:00:00.000Z");
    expect(gameTimeFromText("6/14 8:00PM ET", posted, "Australia/Sydney")?.toISOString()).toBe("2026-06-15T00:00:00.000Z");
    expect(gameTimeFromText(null, posted, "Australia/Sydney")).toBeNull();
    expect(gameTimeFromText("no idea", posted, "Australia/Sydney")).toBeNull();
  });

  it("asks ESPN once per day and game per pass", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify(url.includes("scoreboard") ? SCOREBOARD_20260613 : SUMMARY_401), { status: 200 });
    }) as unknown as typeof fetch;
    const espn = createEspnClient({ baseUrl: "https://espn.test/nba/", fetchImpl });
    await espn.scoreboard("20260613");
    await espn.scoreboard("20260613");
    await espn.boxScore("401");
    await espn.boxScore("401");
    expect(urls).toEqual(["https://espn.test/nba/scoreboard?dates=20260613", "https://espn.test/nba/summary?event=401"]);
    const failing = createEspnClient({ fetchImpl: (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch });
    await expect(failing.scoreboard("20260613")).rejects.toThrow(/503/);
  });
});
