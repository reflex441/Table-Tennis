-- AlterTable
ALTER TABLE "Alarm" ADD COLUMN     "ackAction" TEXT,
ADD COLUMN     "ackAt" TIMESTAMPTZ(3),
ADD COLUMN     "nextRepeatAt" TIMESTAMPTZ(3),
ADD COLUMN     "repeatCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "repeatSeconds" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "ringUntilAck" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "Alarm_status_nextRepeatAt_idx" ON "Alarm"("status", "nextRepeatAt");
