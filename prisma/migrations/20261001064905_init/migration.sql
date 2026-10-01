-- CreateEnum
CREATE TYPE "ScreenshotStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'EXTRACTED', 'FAILED');

-- CreateEnum
CREATE TYPE "CaptureTimeSource" AS ENUM ('EXIF', 'FILE_MODIFIED', 'MANUAL', 'NONE');

-- CreateEnum
CREATE TYPE "Selection" AS ENUM ('OVER', 'UNDER');

-- CreateEnum
CREATE TYPE "AlarmStatus" AS ENUM ('SCHEDULED', 'SENDING', 'TRIGGERED', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "DeliveryChannel" AS ENUM ('PUSH', 'IN_APP');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('SENT', 'FAILED');

-- CreateTable
CREATE TABLE "Screenshot" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "capturedAt" TIMESTAMPTZ(3),
    "capturedAtSource" "CaptureTimeSource" NOT NULL DEFAULT 'NONE',
    "status" "ScreenshotStatus" NOT NULL DEFAULT 'UPLOADED',
    "error" TEXT,

    CONSTRAINT "Screenshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Extraction" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "screenshotId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "rawResponse" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "warnings" TEXT[],

    CONSTRAINT "Extraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "player1" TEXT NOT NULL,
    "player2" TEXT NOT NULL,
    "competition" TEXT,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "rawTimeText" TEXT,
    "notes" TEXT,
    "dedupeKey" TEXT NOT NULL,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchStatistics" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "selection" "Selection",
    "pointsLine" DOUBLE PRECISION,
    "ouStats" TEXT,
    "ouHitRate" DOUBLE PRECISION,
    "edge" DOUBLE PRECISION,

    CONSTRAINT "MatchStatistics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchSource" (
    "matchId" TEXT NOT NULL,
    "screenshotId" TEXT NOT NULL,

    CONSTRAINT "MatchSource_pkey" PRIMARY KEY ("matchId","screenshotId")
);

-- CreateTable
CREATE TABLE "Alarm" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "matchId" TEXT NOT NULL,
    "reminderMinutes" INTEGER NOT NULL,
    "fireAt" TIMESTAMPTZ(3) NOT NULL,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "AlarmStatus" NOT NULL DEFAULT 'SCHEDULED',
    "generation" INTEGER NOT NULL DEFAULT 1,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "triggeredAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),

    CONSTRAINT "Alarm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastSuccessAt" TIMESTAMPTZ(3),
    "lastFailureAt" TIMESTAMPTZ(3),
    "lastError" TEXT,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alarmId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "channel" "DeliveryChannel" NOT NULL DEFAULT 'PUSH',
    "subscriptionId" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InAppNotification" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alarmId" TEXT,
    "generation" INTEGER,
    "matchId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "readAt" TIMESTAMPTZ(3),

    CONSTRAINT "InAppNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "defaultReminderMinutes" INTEGER NOT NULL DEFAULT 5,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "timezoneConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "dateOrder" TEXT NOT NULL DEFAULT 'DMY',
    "pushEnabled" BOOLEAN NOT NULL DEFAULT true,
    "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
    "soundEnabled" BOOLEAN NOT NULL DEFAULT true,
    "includeStatsInNotification" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Screenshot_sha256_idx" ON "Screenshot"("sha256");

-- CreateIndex
CREATE INDEX "Screenshot_createdAt_idx" ON "Screenshot"("createdAt");

-- CreateIndex
CREATE INDEX "Extraction_screenshotId_createdAt_idx" ON "Extraction"("screenshotId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Match_dedupeKey_key" ON "Match"("dedupeKey");

-- CreateIndex
CREATE INDEX "Match_startsAt_idx" ON "Match"("startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "MatchStatistics_matchId_key" ON "MatchStatistics"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "Alarm_matchId_key" ON "Alarm"("matchId");

-- CreateIndex
CREATE INDEX "Alarm_status_nextAttemptAt_idx" ON "Alarm"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_alarmId_generation_subscriptionId_key" ON "NotificationDelivery"("alarmId", "generation", "subscriptionId");

-- CreateIndex
CREATE INDEX "InAppNotification_createdAt_idx" ON "InAppNotification"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InAppNotification_alarmId_generation_key" ON "InAppNotification"("alarmId", "generation");

-- AddForeignKey
ALTER TABLE "Extraction" ADD CONSTRAINT "Extraction_screenshotId_fkey" FOREIGN KEY ("screenshotId") REFERENCES "Screenshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchStatistics" ADD CONSTRAINT "MatchStatistics_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchSource" ADD CONSTRAINT "MatchSource_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchSource" ADD CONSTRAINT "MatchSource_screenshotId_fkey" FOREIGN KEY ("screenshotId") REFERENCES "Screenshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alarm" ADD CONSTRAINT "Alarm_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_alarmId_fkey" FOREIGN KEY ("alarmId") REFERENCES "Alarm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "PushSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InAppNotification" ADD CONSTRAINT "InAppNotification_alarmId_fkey" FOREIGN KEY ("alarmId") REFERENCES "Alarm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
