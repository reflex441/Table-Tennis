-- AlterTable
ALTER TABLE "Bet" ADD COLUMN     "autoFilled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "autoRecordBets" BOOLEAN NOT NULL DEFAULT true;

