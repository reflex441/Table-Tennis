import { buildLeagueIndex, guessCompetition } from "@/lib/bets/league-guess";
import { describe, expect, it } from "vitest";
import { canonicalCompetition, findLeagueUrl, isSafeUrl, normalizeLeague, parseLeagueLinks, withBookmakerLinks } from "@/lib/leagues";
import { settingsUpdateSchema } from "@/lib/validation/settings";

const links = [
  { league: "TT Cup", url: "https://www.ladbrokes.com.au/sports/table-tennis/tt-cup" },
  { league: "TT Elite", url: "https://www.sportsbet.com.au/betting/table-tennis/tt-elite-series" },
  { league: "Czech Liga Pro", url: "https://www.ladbrokes.com.au/sports/table-tennis/czech-liga-pro" },
];

describe("league links", () => {
  it("matches the competition name ignoring case, spaces and punctuation", () => {
    expect(normalizeLeague("  TT CUP ")).toBe("ttcup");
    expect(findLeagueUrl("TT CUP", links)).toBe(links[0].url);
    expect(findLeagueUrl("tt-elite", links)).toBe(links[1].url);
    expect(findLeagueUrl("CZECH LIGA PRO", links)).toBe(links[2].url);
  });

  it("falls back to a league contained in a longer competition name", () => {
    expect(findLeagueUrl("Czech Liga Pro - Men", links)).toBe(links[2].url);
    expect(findLeagueUrl("Setka Cup", links)).toBeNull();
    expect(findLeagueUrl(null, links)).toBeNull();
    expect(findLeagueUrl("TT Cup", [])).toBeNull();
  });

  it("never opens unsafe links", () => {
    expect(isSafeUrl("https://www.ladbrokes.com.au/x")).toBe(true);
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("data:text/html,hi")).toBe(false);
    expect(isSafeUrl("ladbrokes.com.au")).toBe(false);
    expect(findLeagueUrl("TT Cup", [{ league: "TT Cup", url: "javascript:alert(1)" }])).toBeNull();
  });

  it("validates links when saving settings", () => {
    expect(settingsUpdateSchema.parse({ leagueLinks: [{ league: " TT Cup ", url: " https://a.example/tt " }] })).toEqual({
      leagueLinks: [{ league: "TT Cup", url: "https://a.example/tt" }],
    });
    expect(settingsUpdateSchema.safeParse({ leagueLinks: [{ league: "TT Cup", url: "javascript:alert(1)" }] }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ leagueLinks: [{ league: "", url: "https://a.example" }] }).success).toBe(false);
  });

  it("reads stored links defensively", () => {
    expect(parseLeagueLinks(null)).toEqual([]);
    expect(parseLeagueLinks([{ league: "A", url: "https://a" }, { league: 1 }, "x"])).toEqual([{ league: "A", url: "https://a" }]);
  });
});

describe("bookmaker presets", () => {
  it("fills in the bookmaker's league pages and keeps other leagues", () => {
    const current = [
      { league: "TT CUP", url: "https://example.com/old-cup" },
      { league: "Czech Liga Pro", url: "https://www.ladbrokes.com.au/sports/table-tennis/czech-liga-pro" },
      { league: "Setka Cup", url: "https://example.com/setka" },
    ];
    const lad = withBookmakerLinks(current, "ladbrokes");
    expect(lad.map((l) => l.league)).toEqual(["TT Cup", "TT Elite", "Czech Liga Pro", "Setka Cup"]);
    expect(findLeagueUrl("TT ELITE", lad)).toBe("https://www.ladbrokes.com.au/sports/table-tennis/tt-elite-series");
    const sb = withBookmakerLinks(current, "sportsbet");
    expect(findLeagueUrl("TT CUP", sb)).toBe("https://www.sportsbet.com.au/betting/table-tennis/tt-cup");
    expect(findLeagueUrl("TT Elite", sb)).toBe("https://www.sportsbet.com.au/betting/table-tennis/tt-elite-series-men");
    // Sportsbet has no Czech Liga Pro: an existing link for it is kept.
    expect(findLeagueUrl("Czech Liga Pro", sb)).toBe("https://www.ladbrokes.com.au/sports/table-tennis/czech-liga-pro");
    expect(sb.filter((l) => l.league === "Setka Cup")).toHaveLength(1);
  });
});

describe("bet slip competition", () => {
  it("maps any spelling to TT Elite, TT Cup or Czech Liga Pro", () => {
    expect(canonicalCompetition("TT Elite Series - Men")).toBe("TT Elite");
    expect(canonicalCompetition("TT CUP")).toBe("TT Cup");
    expect(canonicalCompetition("Czech Liga Pro")).toBe("Czech Liga Pro");
    expect(canonicalCompetition("Liga Pro")).toBe("Czech Liga Pro");
    expect(canonicalCompetition("Setka Cup")).toBeNull();
    expect(canonicalCompetition("")).toBeNull();
  });

  it("guesses it from where the players have played before", () => {
    const at = (d: string) => new Date(`2026-10-0${d}T10:00:00Z`);
    const index = buildLeagueIndex([
      { player1: "Kovtanyuk D.", player2: "Pavlov A.", competition: "TT Cup", startsAt: at("1") },
      { player1: "Kovtanyuk D.", player2: "Ivanov S.", competition: "TT CUP", startsAt: at("2") },
      { player1: "Warpas B.", player2: "Krcil F.", competition: "TT Elite Series", startsAt: at("3") },
      { player1: "Varcl J.", player2: "Prokop T.", competition: "Czech Liga Pro", startsAt: at("4") },
      { player1: "Nobody N.", player2: "Else E.", competition: null, startsAt: at("5") },
    ]);
    // One known player is enough, by exact name or by surname.
    expect(guessCompetition("Kovtanyuk D.", "Wiekiera A.", index)).toBe("TT Cup");
    expect(guessCompetition("Dmytro Kovtanyuk", "Adam Wiekiera", index)).toBe("TT Cup");
    expect(guessCompetition("Wiekiera A.", "Blazej Warpas", index)).toBe("TT Elite");
    expect(guessCompetition("Jiri Varcl", null, index)).toBe("Czech Liga Pro");
    expect(guessCompetition("Unknown U.", "Stranger S.", index)).toBeNull();
    expect(guessCompetition("Nobody N.", null, index)).toBeNull();
  });
});

