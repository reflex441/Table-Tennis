import { describe, expect, it } from "vitest";
import { leagueIndexOf, nameFits, searchGames, searchPlayers, type KnownPlayer, type PastGame } from "@/lib/bets/past-games";
import { buildLeagueIndex, guessCompetition } from "@/lib/bets/league-index";

const players: KnownPlayer[] = [
  { name: "Lewczuk M.", games: 12, leagues: [["TT ELITE", 12, 3]] },
  { name: "Lewandowski K.", games: 30, leagues: [["TT CUP", 30, 2]] },
  { name: "Staniczek A.", games: 8, leagues: [["TT ELITE", 7, 3], ["TT CUP", 1, 1]] },
  { name: "Kowalewski M.", games: 50, leagues: [] },
];

const game = (player1: string, player2: string, startsAt: string): PastGame => ({
  player1,
  player2,
  competition: "TT ELITE",
  startsAt,
  playType: "BOT",
  selection: "UNDER",
  pointsLine: 74.5,
  mine: false,
  bet: false,
});

describe("past bet form: searching past games and players", () => {
  it("a name fits when every typed word starts one of its words", () => {
    expect(nameFits("Lewczuk M.", "lewc")).toBe(true);
    expect(nameFits("Lewczuk M.", "m lew")).toBe(true);
    expect(nameFits("Lewczuk M.", "Mateusz Lewczuk")).toBe(true); // full first name vs the initial
    expect(nameFits("Lewczuk M.", "czuk")).toBe(false);
    expect(nameFits("Lewczuk M.", "Adam Lewczuk")).toBe(false);
    expect(nameFits("Lewczuk M.", " ")).toBe(false);
  });

  it("players: surname matches first, then the most games", () => {
    expect(searchPlayers(players, "lew").map((p) => p.name)).toEqual(["Lewandowski K.", "Lewczuk M."]);
    // "Kowalewski M." only fits "m" through the initial: after the surnames.
    expect(searchPlayers(players, "m").map((p) => p.name)).toEqual(["Kowalewski M.", "Lewczuk M."]);
  });

  it("games: latest first, and with the other player typed in, games of the two first", () => {
    const games = [game("Lewczuk M.", "Kubik P.", "2026-11-12T09:00:00Z"), game("Staniczek A.", "Lewczuk M.", "2026-11-12T08:30:00Z"), game("Nowak J.", "Kubik P.", "2026-11-12T08:00:00Z")];
    expect(searchGames(games, "lewc").map((g) => g.player2)).toEqual(["Kubik P.", "Lewczuk M."]);
    expect(searchGames(games, "lewc", "Stan").map((g) => g.player1)).toEqual(["Staniczek A.", "Lewczuk M."]);
    expect(searchGames(games, "zzz")).toEqual([]);
  });

  it("the league comes from the players' past matches, the same as from the matches themselves", () => {
    const index = leagueIndexOf(players);
    expect(guessCompetition("Lewczuk M.", "Staniczek A.", index)).toBe("TT ELITE");
    expect(guessCompetition("Mateusz Lewczuk", "Someone New", index)).toBe("TT ELITE"); // by surname
    expect(guessCompetition("Kowalewski M.", "Someone New", index)).toBeNull(); // no league known
    // Same answers as the index built from the matches.
    const rows = [
      { player1: "Lewczuk M.", player2: "Staniczek A.", competition: "TT ELITE", startsAt: new Date(3) },
      { player1: "Lewandowski K.", player2: "Staniczek A.", competition: "TT CUP", startsAt: new Date(1) },
      { player1: "Lewandowski K.", player2: "Kubik P.", competition: "TT CUP", startsAt: new Date(2) },
    ];
    const fromRows = buildLeagueIndex(rows);
    const fromPlayers = leagueIndexOf([
      { name: "Lewczuk M.", games: 1, leagues: [["TT ELITE", 1, 3]] },
      { name: "Staniczek A.", games: 2, leagues: [["TT ELITE", 1, 3], ["TT CUP", 1, 1]] },
      { name: "Lewandowski K.", games: 2, leagues: [["TT CUP", 2, 2]] },
      { name: "Kubik P.", games: 1, leagues: [["TT CUP", 1, 2]] },
    ]);
    expect(fromPlayers).toEqual(fromRows);
  });
});
