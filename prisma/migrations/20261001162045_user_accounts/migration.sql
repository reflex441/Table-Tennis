-- User accounts: every match, screenshot, device, notification and settings row belongs to a user.
-- Existing rows keep userId NULL until the first account is created, which claims them.
-- DropIndex
DROP INDEX "InAppNotification_createdAt_idx";

-- DropIndex
DROP INDEX "Match_dedupeKey_key";

-- DropIndex
DROP INDEX "Screenshot_createdAt_idx";

-- DropIndex
DROP INDEX "Screenshot_sha256_idx";

-- AlterTable
ALTER TABLE "InAppNotification" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "PushSubscription" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "Screenshot" ADD COLUMN     "userId" TEXT;

-- AlterTable
CREATE SEQUENCE settings_id_seq;
ALTER TABLE "Settings" ADD COLUMN     "showOnLeaderboard" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "userId" TEXT,
ALTER COLUMN "id" SET DEFAULT nextval('settings_id_seq');
ALTER SEQUENCE settings_id_seq OWNED BY "Settings"."id";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "googleId" TEXT,
    "lastLoginAt" TIMESTAMPTZ(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSecret" (
    "name" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppSecret_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");

-- CreateIndex
CREATE INDEX "InAppNotification_userId_createdAt_idx" ON "InAppNotification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Match_userId_startsAt_idx" ON "Match"("userId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Match_userId_dedupeKey_key" ON "Match"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE INDEX "Screenshot_userId_sha256_idx" ON "Screenshot"("userId", "sha256");

-- CreateIndex
CREATE INDEX "Screenshot_userId_createdAt_idx" ON "Screenshot"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Settings_userId_key" ON "Settings"("userId");

-- AddForeignKey
ALTER TABLE "Screenshot" ADD CONSTRAINT "Screenshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InAppNotification" ADD CONSTRAINT "InAppNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Continue the Settings id sequence after the existing single row.
SELECT setval('settings_id_seq', GREATEST((SELECT COALESCE(MAX("id"), 0) FROM "Settings"), 1));
