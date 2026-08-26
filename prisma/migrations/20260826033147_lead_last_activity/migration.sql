-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "lastActivityAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Lead_organizationId_lastActivityAt_idx" ON "Lead"("organizationId", "lastActivityAt");
