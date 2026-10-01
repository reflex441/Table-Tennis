-- Odds are now filled in when a match is uploaded and stored with it.
ALTER TABLE "Match" ADD COLUMN "odds" DOUBLE PRECISION;

-- Average odds no longer change bets later. Bets without odds that were being
-- priced at the average keep that price: store the average as their odds.
UPDATE "Bet" b
SET "odds" = s."averageOdds",
    "profit" = CASE WHEN b."result" = 'WON' THEN ROUND((b."stake" * (s."averageOdds" - 1))::numeric, 2)::double precision ELSE b."profit" END
FROM "Settings" s
WHERE s."id" = 1 AND s."useAverageOdds" = true AND b."odds" IS NULL;
