import { describe, expect, it } from "vitest";
import { createEspnClient, espnDay, parseBoxScore, parseScoreboard } from "@/lib/nba/espn";
import { findPlayer, gameTimeFromText, gradeBet, mentionsTeam, type Gradable } from "@/lib/nba/grade";
import { statCode } from "@/lib/nba/stats";
import { KNICKS, PRESEASON_20261012, SCOREBOARD_20260613, SIXERS, SUMMARY_401, SUMMARY_402, SUMMARY_501, fakeEspn } from "./fixtures/espn";

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
    expect(await gradeBet(bet({ ...fox, line: 1.5, side: "OVER" }), espn, after)).toEqual({
      kind: "settled",
      result: "WON",
      note: "De'Aaron Fox: 3 threes (line 1.5).",
      eventId: "401",
      gameStart: new Date("2026-06-14T00:40:00Z"),
    });
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
    // Not found yet: keep looking for 2 days, then leave it to you - saying what was looked at.
    expect(await gradeBet(bet({ player: "Nobody Atall", stat: "PTS", line: 1.5 }), espn, after)).toMatchObject({
      kind: "wait",
      note: "Couldn't find Nobody Atall in the box scores of the 2 games on Sat 13 Jun.",
    });
    expect(await gradeBet(bet({ player: "Nobody Atall", stat: "PTS", line: 1.5, team: "Knicks" }), espn, after)).toMatchObject({
      note: "Couldn't find Nobody Atall in the New York Knicks at San Antonio Spurs box score.",
    });
    expect(await gradeBet(bet({ player: "De'Aaron Fox", stat: "PTS", line: 1.5, team: "Bulls" }), espn, after)).toMatchObject({ note: "No Bulls game on ESPN on Sat 13 Jun (3 games then)." });
    expect(await gradeBet(bet({ player: "De'Aaron Fox", stat: "PTS", line: 1.5, placedAt: new Date("2026-07-20T00:00:00Z") }), espn, after)).toMatchObject({
      note: "ESPN lists no NBA games on Sun 19 Jul.",
    });
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
    // Posted the day before (Sydney time): the next game after the post.
    expect(await gradeBet(bet({ market: "MONEYLINE", pick: "Spurs", team: "Spurs", placedAt: new Date("2026-06-12T19:00:00Z"), dateKind: "POSTED" }), espn, after)).toMatchObject({ result: "WON" });
  });

  it("finds the game from a typed-in game date (any time of day) or a posted time", async () => {
    const espn = fakeEspn();
    const knicksMl = { market: "MONEYLINE" as const, pick: "Knicks ML", team: "Knicks", timezone: "Australia/Sydney" };
    // The game is Sun 14 Jun 10:40 AM in Sydney: typing that day with any time finds it...
    expect(await gradeBet(bet({ ...knicksMl, placedAt: new Date("2026-06-14T05:00:00Z") }), espn, after)).toMatchObject({ result: "LOST" }); // 3 PM
    expect(await gradeBet(bet({ ...knicksMl, placedAt: new Date("2026-06-14T13:30:00Z") }), espn, after)).toMatchObject({ result: "LOST" }); // 11:30 PM
    // ...and so does the US date (Sat 13 Jun).
    expect(await gradeBet(bet({ ...knicksMl, placedAt: new Date("2026-06-13T05:00:00Z") }), espn, after)).toMatchObject({ result: "LOST" });
    // A pick posted after the game had started isn't on that game (back-to-backs).
    expect(await gradeBet(bet({ ...knicksMl, dateKind: "POSTED", placedAt: new Date("2026-06-14T03:00:00Z") }), espn, after)).toMatchObject({ kind: "wait" });
    // Posted that morning (US): the game that night.
    expect(await gradeBet(bet({ ...knicksMl, dateKind: "POSTED", placedAt: new Date("2026-06-13T14:00:00Z") }), espn, after)).toMatchObject({ result: "LOST" });
  });

  it("settles the Banchero test bet: 10 points vs Over 10.5 = lost", async () => {
    // Game date typed as 13/10/2026 (12:50 AM) in Sydney; the game was Mon 12 Oct 7 PM ET = Tue 13 Oct 10 AM in Sydney.
    const banchero = bet({
      player: "Paolo Banchero",
      stat: "PTS",
      line: 10.5,
      side: "OVER",
      game: "Orlando Magic @ Cleveland Cavaliers",
      pick: "Paolo Banchero O10.5 Points",
      placedAt: new Date("2026-10-12T13:50:00Z"),
      timezone: "Australia/Sydney",
    });
    const now = new Date("2026-10-14T00:00:00Z");
    expect(await gradeBet(banchero, fakeEspn(), now)).toMatchObject({ kind: "settled", result: "LOST", note: "Paolo Banchero: 10 points (line 10.5)." });
    expect(await gradeBet({ ...banchero, line: 9.5 }, fakeEspn(), now)).toMatchObject({ result: "WON" });
    expect(await gradeBet({ ...banchero, placedAt: new Date("2026-10-13T01:00:00Z") }, fakeEspn(), now)).toMatchObject({ result: "LOST" }); // midday 13 Oct
    expect(await gradeBet({ ...banchero, game: null, team: "Magic" }, fakeEspn(), now)).toMatchObject({ result: "LOST" });
    expect(await gradeBet({ ...banchero, player: "Jonathan Isaac" }, fakeEspn(), now)).toMatchObject({ result: "VOID" });
  });

  it("tries ESPN's second address, and asks for preseason games when a day is empty", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      urls.push(url);
      expect(new Headers(init?.headers).get("user-agent")).toMatch(/Mozilla/);
      if (url.startsWith("https://site.api.espn.com")) return new Response("blocked", { status: 403 });
      if (url.includes("scoreboard") && !url.includes("seasontype=1")) return new Response(JSON.stringify({ events: [] }), { status: 200 });
      return new Response(JSON.stringify(url.includes("scoreboard") ? PRESEASON_20261012 : SUMMARY_501), { status: 200 });
    }) as unknown as typeof fetch;
    const espn = createEspnClient({ fetchImpl });
    expect((await espn.scoreboard("20261012")).map((g) => g.name)).toEqual(["Orlando Magic at Cleveland Cavaliers"]);
    expect(urls.map((u) => u.replace(/^https:\/\/([^/]+).*\/(scoreboard|summary)/, "$1 $2"))).toEqual([
      "site.api.espn.com scoreboard?dates=20261012&limit=200",
      "site.web.api.espn.com scoreboard?dates=20261012&limit=200",
      "site.api.espn.com scoreboard?dates=20261012&limit=200&seasontype=1",
      "site.web.api.espn.com scoreboard?dates=20261012&limit=200&seasontype=1",
    ]);
    const down = createEspnClient({ fetchImpl: (async () => Promise.reject(Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }))) as unknown as typeof fetch });
    await expect(down.scoreboard("20261012")).rejects.toThrow("fetch failed: ENOTFOUND");
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
    expect(urls).toEqual(["https://espn.test/nba/scoreboard?dates=20260613&limit=200", "https://espn.test/nba/summary?event=401"]);
    const failing = createEspnClient({ fetchImpl: (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch });
    await expect(failing.scoreboard("20260613")).rejects.toThrow(/503/);
  });
});
