import { describe, expect, it } from "vitest";
import { leagueIndexOf, nameFits, searchPlayers, type KnownPlayer } from "@/lib/bets/past-games";
import { buildLeagueIndex, guessCompetition } from "@/lib/bets/league-index";

const players: KnownPlayer[] = [
  { name: "Lewczuk M.", games: 12, leagues: [["TT ELITE", 12, 3]] },
  { name: "Lewandowski K.", games: 30, leagues: [["TT CUP", 30, 2]] },
  { name: "Staniczek A.", games: 8, leagues: [["TT ELITE", 7, 3], ["TT CUP", 1, 1]] },
  { name: "Kowalewski M.", games: 50, leagues: [] },
];

describe("past bet form: searching players", () => {
  it("a name fits when the typed surname starts it and the initial is its initial", () => {
    expect(nameFits("Lewczuk M.", "lewc")).toBe(true);
    expect(nameFits("Lewczuk M.", "m lew")).toBe(true);
    expect(nameFits("Lewczuk M.", "Lewczuk M.")).toBe(true);
    expect(nameFits("Lewczuk M.", "Mateusz Lewczuk")).toBe(true); // full first name vs the initial
    expect(nameFits("Lewczuk M.", "czuk")).toBe(false);
    expect(nameFits("Lewczuk M.", "Lewczuk K.")).toBe(false); // another initial
    expect(nameFits("Lewczuk M.", "Adam Lewczuk")).toBe(false);
    expect(nameFits("Lewczuk M.", " ")).toBe(false);
    // "Jablonski K." isn't "Komorowicz J." (K is the initial, not the start of a surname).
    expect(nameFits("Komorowicz J.", "Jablonski K.")).toBe(false);
    expect(nameFits("Komorowicz J.", "Jablonski")).toBe(false);
  });

  it("searching a full name shows just that player", () => {
    const list: KnownPlayer[] = [
      { name: "Komorowicz J.", games: 40, leagues: [["TT CUP", 40, 5]] },
      { name: "Wiekiera A.", games: 30, leagues: [["TT CUP", 30, 5]] },
      { name: "Jablonski K.", games: 9, leagues: [["TT CUP", 9, 5]] },
      { name: "Jablonski P.", games: 20, leagues: [["TT ELITE", 20, 5]] },
      { name: "Kosowski J.", games: 25, leagues: [["TT ELITE", 25, 5]] },
    ];
    expect(searchPlayers(list, "Jablonski K.").map((p) => p.name)).toEqual(["Jablonski K."]);
    // Just the surname: both Jablonskis (most games first).
    expect(searchPlayers(list, "jabl").map((p) => p.name)).toEqual(["Jablonski P.", "Jablonski K."]);
  });

  it("players: the exact name first, then surname matches, then the most games", () => {
    expect(searchPlayers(players, "lew").map((p) => p.name)).toEqual(["Lewandowski K.", "Lewczuk M."]);
    expect(searchPlayers(players, "Lewczuk M.").map((p) => p.name)).toEqual(["Lewczuk M."]);
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
