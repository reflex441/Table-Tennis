-- AlterTable
ALTER TABLE "User" ADD COLUMN     "nbaTailing" BOOLEAN NOT NULL DEFAULT false;


-- NBA tailing starts with one account: Lyu.
UPDATE "User" SET "nbaTailing" = true WHERE lower(trim("name")) = 'lyu';
