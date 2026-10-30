-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastSeenAt" TIMESTAMPTZ(3);


-- Until they next visit, the last sign-in is the best we know.
UPDATE "User" SET "lastSeenAt" = "lastLoginAt";
