-- CreateTable
CREATE TABLE "UsageDay" (
    "day" TEXT NOT NULL,
    "cpuMs" INTEGER NOT NULL DEFAULT 0,
    "requests" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UsageDay_pkey" PRIMARY KEY ("day")
);

