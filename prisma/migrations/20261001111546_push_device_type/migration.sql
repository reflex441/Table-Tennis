-- AlterTable
ALTER TABLE "PushSubscription" ADD COLUMN     "deviceType" TEXT NOT NULL DEFAULT 'desktop';

-- Classify existing subscriptions from their browser user agent.
UPDATE "PushSubscription" SET "deviceType" = 'mobile' WHERE "userAgent" ~* '(Android|iPhone|iPad|iPod|Mobile)';
