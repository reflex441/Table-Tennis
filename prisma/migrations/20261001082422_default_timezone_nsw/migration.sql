-- AlterTable
ALTER TABLE "Settings" ALTER COLUMN "timezone" SET DEFAULT 'Australia/Sydney',
ALTER COLUMN "timezoneConfirmed" SET DEFAULT true;

-- Existing installs that never chose a timezone switch to NSW.
UPDATE "Settings" SET "timezone" = 'Australia/Sydney', "timezoneConfirmed" = true WHERE "timezoneConfirmed" = false;
