-- AlterTable
ALTER TABLE "NbaBet" ADD COLUMN     "autoGraded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "espnEventId" TEXT,
ADD COLUMN     "gradeCheckedAt" TIMESTAMPTZ(3),
ADD COLUMN     "gradeNote" TEXT,
ADD COLUMN     "team" TEXT;

