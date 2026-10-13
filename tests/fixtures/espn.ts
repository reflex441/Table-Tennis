import { parseBoxScore, parseScoreboard, type EspnClient } from "@/lib/nba/espn";

/** ESPN-shaped NBA data (scoreboard + game summaries) for the grading tests. */

const KEYS = [
  "minutes",
  "fieldGoalsMade-fieldGoalsAttempted",
  "threePointFieldGoalsMade-threePointFieldGoalsAttempted",
  "freeThrowsMade-freeThrowsAttempted",
  "offensiveRebounds",
  "defensiveRebounds",
  "rebounds",
  "assists",
  "steals",
  "blocks",
  "turnovers",
  "fouls",
  "plusMinus",
  "points",
];
const LABELS = ["MIN", "FG", "3PT", "FT", "OREB", "DREB", "REB", "AST", "STL", "BLK", "TO", "PF", "+/-", "PTS"];

const team = (displayName: string, name: string, abbreviation: string, location: string) => ({ id: abbreviation, displayName, name, shortDisplayName: name, abbreviation, location });

const event = (id: string, date: string, state: "pre" | "in" | "post", statusName: string, home: [ReturnType<typeof team>, string], away: [ReturnType<typeof team>, string]) => ({
  id,
  date,
  name: `${away[0].displayName} at ${home[0].displayName}`,
  shortName: `${away[0].abbreviation} @ ${home[0].abbreviation}`,
  status: { type: { name: statusName, state, completed: state === "post", description: statusName } },
  competitions: [
    {
      id,
      date,
      competitors: [
        { homeAway: "home", score: home[1], winner: state === "post" ? Number(home[1]) > Number(away[1]) : undefined, team: home[0] },
        { homeAway: "away", score: away[1], winner: state === "post" ? Number(away[1]) > Number(home[1]) : undefined, team: away[0] },
      ],
    },
  ],
});

export const KNICKS = team("New York Knicks", "Knicks", "NY", "New York");
export const SPURS = team("San Antonio Spurs", "Spurs", "SA", "San Antonio");
export const CELTICS = team("Boston Celtics", "Celtics", "BOS", "Boston");
export const LAKERS = team("Los Angeles Lakers", "Lakers", "LAL", "Los Angeles");
export const SIXERS = team("Philadelphia 76ers", "76ers", "PHI", "Philadelphia");
export const HEAT = team("Miami Heat", "Heat", "MIA", "Miami");

/** Sat 13 Jun 2026 (US): Knicks @ Spurs final 108-112, Lakers @ Celtics in progress, 76ers @ Heat postponed. */
export const SCOREBOARD_20260613 = {
  events: [
    event("401", "2026-06-14T00:40Z", "post", "STATUS_FINAL", [SPURS, "112"], [KNICKS, "108"]),
    event("402", "2026-06-14T02:00Z", "in", "STATUS_IN_PROGRESS", [CELTICS, "50"], [LAKERS, "48"]),
    event("403", "2026-06-13T23:00Z", "post", "STATUS_POSTPONED", [HEAT, "0"], [SIXERS, "0"]),
  ],
};

const player = (displayName: string, shortName: string, stats: string[] | null, didNotPlay = false) => ({
  active: !didNotPlay,
  athlete: { id: displayName, displayName, shortName },
  starter: true,
  didNotPlay,
  reason: didNotPlay ? "DNP-INJURY" : undefined,
  stats: stats ?? [],
});

export const SUMMARY_401 = {
  boxscore: {
    players: [
      {
        team: KNICKS,
        statistics: [
          {
            names: LABELS,
            keys: KEYS,
            labels: LABELS,
            athletes: [
              //                                       MIN    FG       3PT    FT     OR   DR   REB  AST  STL  BLK  TO   PF   +/-   PTS
              player("Jalen Brunson", "J. Brunson", ["36", "10-20", "3-8", "5-5", "1", "3", "4", "8", "1", "0", "3", "2", "-4", "28"]),
              player("Mitchell Robinson", "M. Robinson", null, true),
            ],
          },
        ],
      },
      {
        team: SPURS,
        statistics: [
          {
            names: LABELS,
            keys: KEYS,
            labels: LABELS,
            athletes: [
              player("De'Aaron Fox", "D. Fox", ["34", "9-17", "3-6", "2-2", "0", "4", "4", "7", "2", "0", "2", "1", "+6", "23"]),
              player("Victor Wembanyama", "V. Wembanyama", ["35", "11-19", "2-5", "4-4", "3", "10", "13", "3", "1", "5", "2", "3", "+8", "28"]),
            ],
          },
        ],
      },
    ],
  },
};

export const SUMMARY_402 = {
  boxscore: {
    players: [
      {
        team: CELTICS,
        statistics: [
          {
            // Labels only (no keys) - read by label instead.
            labels: LABELS,
            athletes: [player("Jayson Tatum", "J. Tatum", ["20", "6-12", "2-5", "2-2", "1", "5", "6", "3", "1", "1", "1", "1", "+2", "16"])],
          },
        ],
      },
    ],
  },
};

export const MAGIC = team("Orlando Magic", "Magic", "ORL", "Orlando");
export const CAVS = team("Cleveland Cavaliers", "Cavaliers", "CLE", "Cleveland");

/** Preseason, Mon 12 Oct 2026 (US): Magic 105 @ Cavaliers 119 (the user's test game). */
export const PRESEASON_20261012 = {
  events: [event("501", "2026-10-12T23:00Z", "post", "STATUS_FINAL", [CAVS, "119"], [MAGIC, "105"])],
};
export const SUMMARY_501 = {
  boxscore: {
    players: [
      {
        team: MAGIC,
        statistics: [
          {
            names: LABELS,
            keys: KEYS,
            labels: LABELS,
            athletes: [
              player("Paolo Banchero", "P. Banchero", ["18", "1-10", "1-3", "7-10", "2", "5", "7", "2", "0", "1", "3", "2", "-9", "10"]),
              player("Jonathan Isaac", "J. Isaac", null, true),
            ],
          },
        ],
      },
    ],
  },
};

/** ESPN client over the fixtures: Sat 13 Jun 2026 (US). Records what was asked. */
export function fakeEspn(): EspnClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async scoreboard(day) {
      calls.push(`day:${day}`);
      return day === "20260613" ? parseScoreboard(SCOREBOARD_20260613) : day === "20261012" ? parseScoreboard(PRESEASON_20261012) : [];
    },
    async boxScore(id) {
      calls.push(`box:${id}`);
      return parseBoxScore(id === "401" ? SUMMARY_401 : id === "402" ? SUMMARY_402 : id === "501" ? SUMMARY_501 : {});
    },
  };
}
