-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "slaEscalatedAt" TIMESTAMP(3),
ADD COLUMN     "slaNotifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "slaEscalateMinutes" INTEGER NOT NULL DEFAULT 120,
ADD COLUMN     "slaFirstTouchMinutes" INTEGER NOT NULL DEFAULT 30;

-- CreateIndex
CREATE INDEX "Lead_firstTouchedAt_status_createdAt_idx" ON "Lead"("firstTouchedAt", "status", "createdAt");
