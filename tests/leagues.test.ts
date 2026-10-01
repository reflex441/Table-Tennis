import { describe, expect, it } from "vitest";
import { findLeagueUrl, isSafeUrl, normalizeLeague, parseLeagueLinks } from "@/lib/leagues";
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
