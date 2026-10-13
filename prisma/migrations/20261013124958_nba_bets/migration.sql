-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "nbaBookmakers" JSONB,
ADD COLUMN     "nbaTipsters" JSONB;

-- CreateTable
CREATE TABLE "NbaBet" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "tipster" TEXT NOT NULL,
    "pick" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'OTHER',
    "game" TEXT,
    "player" TEXT,
    "stat" TEXT,
    "line" DOUBLE PRECISION,
    "side" TEXT,
    "stake" DOUBLE PRECISION NOT NULL,
    "odds" DOUBLE PRECISION,
    "bookmaker" TEXT,
    "placedAt" TIMESTAMPTZ(3) NOT NULL,
    "result" "BetResult" NOT NULL DEFAULT 'PENDING',
    "profit" DOUBLE PRECISION,
    "settledAt" TIMESTAMPTZ(3),
    "notes" TEXT,
    "dedupeKey" TEXT NOT NULL,

    CONSTRAINT "NbaBet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NbaBet_userId_placedAt_idx" ON "NbaBet"("userId", "placedAt");

-- CreateIndex
CREATE UNIQUE INDEX "NbaBet_userId_dedupeKey_key" ON "NbaBet"("userId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "NbaBet" ADD CONSTRAINT "NbaBet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

