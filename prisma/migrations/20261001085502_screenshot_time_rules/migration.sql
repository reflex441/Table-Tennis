-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "screenshotTimesAreLocal" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "screenshotsAreToday" BOOLEAN NOT NULL DEFAULT true;
