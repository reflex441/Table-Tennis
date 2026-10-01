-- CreateEnum
CREATE TYPE "PlayType" AS ENUM ('BOT', 'PERSONAL');

-- CreateEnum
CREATE TYPE "BetResult" AS ENUM ('PENDING', 'WON', 'LOST', 'VOID');

-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "playType" "PlayType" NOT NULL DEFAULT 'PERSONAL',
ADD COLUMN     "stakeUnits" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT '$',
ADD COLUMN     "unitSize" DOUBLE PRECISION NOT NULL DEFAULT 10;

-- CreateTable
CREATE TABLE "Bet" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "matchId" TEXT NOT NULL,
    "stake" DOUBLE PRECISION NOT NULL,
    "odds" DOUBLE PRECISION,
    "result" "BetResult" NOT NULL DEFAULT 'PENDING',
    "profit" DOUBLE PRECISION,
    "placedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMPTZ(3),

    CONSTRAINT "Bet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Bet_matchId_key" ON "Bet"("matchId");

-- CreateIndex
CREATE INDEX "Bet_result_idx" ON "Bet"("result");

-- AddForeignKey
ALTER TABLE "Bet" ADD CONSTRAINT "Bet_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing matches with an OVER/UNDER pick came from a pick badge: bot plays.
UPDATE "Match" SET "playType" = 'BOT'
 WHERE "id" IN (SELECT "matchId" FROM "MatchStatistics" WHERE "selection" IS NOT NULL);
