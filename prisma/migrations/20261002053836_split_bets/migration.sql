-- CreateTable
CREATE TABLE "BetLeg" (
    "id" TEXT NOT NULL,
    "betId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "selection" "Selection" NOT NULL,
    "stake" DOUBLE PRECISION NOT NULL,
    "odds" DOUBLE PRECISION,
    "result" "BetResult" NOT NULL DEFAULT 'PENDING',
    "profit" DOUBLE PRECISION,

    CONSTRAINT "BetLeg_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BetLeg_betId_position_key" ON "BetLeg"("betId", "position");

-- AddForeignKey
ALTER TABLE "BetLeg" ADD CONSTRAINT "BetLeg_betId_fkey" FOREIGN KEY ("betId") REFERENCES "Bet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

