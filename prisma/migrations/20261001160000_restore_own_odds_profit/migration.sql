-- Average odds no longer override odds entered on a bet: restore the profit
-- of won bets that have their own odds (they may have been priced at the
-- average while the setting was on).
UPDATE "Bet"
SET "profit" = ROUND(("stake" * ("odds" - 1))::numeric, 2)::double precision
WHERE "result" = 'WON' AND "odds" IS NOT NULL AND "odds" > 1;
