-- Bot plays are Over / Under only: sweep and spread picks stored as bot plays become personal plays.

-- Picks of split bets that count as bot plays (their own, or following a bot match), e.g. the SWEEP of a bot OVER + SWEEP.
UPDATE "BetLeg" l
   SET "playType" = 'PERSONAL'
  FROM "Bet" b
  JOIN "Match" m ON m."id" = b."matchId"
 WHERE l."betId" = b."id"
   AND l."selection" NOT IN ('OVER', 'UNDER')
   AND COALESCE(l."playType", m."playType") = 'BOT';

-- Other bot matches whose pick is a sweep or spread (split bets keep the match's type for their Over / Under picks).
UPDATE "Match" m
   SET "playType" = 'PERSONAL'
  FROM "MatchStatistics" s
 WHERE s."matchId" = m."id"
   AND m."playType" = 'BOT'
   AND s."selection" IS NOT NULL
   AND s."selection" NOT IN ('OVER', 'UNDER')
   AND NOT EXISTS (SELECT 1 FROM "BetLeg" l JOIN "Bet" b ON b."id" = l."betId" WHERE b."matchId" = m."id");
