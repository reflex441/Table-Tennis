-- CreateTable
CREATE TABLE "InviteKey" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "usedAt" TIMESTAMPTZ(3),
    "usedById" TEXT,

    CONSTRAINT "InviteKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InviteKey_code_key" ON "InviteKey"("code");

-- AddForeignKey
ALTER TABLE "InviteKey" ADD CONSTRAINT "InviteKey_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InviteKey" ADD CONSTRAINT "InviteKey_usedById_fkey" FOREIGN KEY ("usedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

