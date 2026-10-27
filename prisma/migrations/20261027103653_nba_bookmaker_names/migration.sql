-- One spelling per bookmaker, so each is counted once ("PointsBet" and "Pointsbet" were two rows).
UPDATE "NbaBet"
   SET "bookmaker" = CASE lower(regexp_replace("bookmaker", '[^a-zA-Z0-9]', '', 'g'))
         WHEN 'bet365' THEN 'Bet365'
         WHEN 'ladbrokes' THEN 'Ladbrokes'
         WHEN 'tab' THEN 'Tab'
         WHEN 'sportsbet' THEN 'Sportsbet'
         WHEN 'pointsbet' THEN 'Pointsbet'
         ELSE "bookmaker"
       END
 WHERE "bookmaker" IS NOT NULL;
