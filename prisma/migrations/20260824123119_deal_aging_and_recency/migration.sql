-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "lastActivityAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "lastActivityAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "lostReason" TEXT,
ADD COLUMN     "stageEnteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "Company_organizationId_lastActivityAt_idx" ON "Company"("organizationId", "lastActivityAt");

-- CreateIndex
CREATE INDEX "Contact_organizationId_lastActivityAt_idx" ON "Contact"("organizationId", "lastActivityAt");

-- CreateIndex
CREATE INDEX "Deal_organizationId_stageEnteredAt_idx" ON "Deal"("organizationId", "stageEnteredAt");

