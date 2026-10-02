-- Tailing is now automatic: everyone tails the app owner's account, so follows and the opt-out switch are no longer stored.
-- DropForeignKey
ALTER TABLE "Follow" DROP CONSTRAINT "Follow_followeeId_fkey";

-- DropForeignKey
ALTER TABLE "Follow" DROP CONSTRAINT "Follow_followerId_fkey";

-- AlterTable
ALTER TABLE "Settings" DROP COLUMN "allowTailing";

-- DropTable
DROP TABLE "Follow";

