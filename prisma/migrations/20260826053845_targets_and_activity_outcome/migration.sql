-- CreateEnum
CREATE TYPE "ActivityOutcome" AS ENUM ('CONNECTED', 'NO_ANSWER', 'LEFT_MESSAGE', 'HELD', 'NO_SHOW', 'RESCHEDULED');

-- CreateEnum
CREATE TYPE "TargetPeriod" AS ENUM ('MONTH', 'QUARTER');

-- CreateEnum
CREATE TYPE "TargetMetric" AS ENUM ('REVENUE_WON', 'DEALS_WON', 'LEADS_CONVERTED', 'CALLS_LOGGED', 'MEETINGS_HELD', 'FIRST_TOUCHES');

-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "durationMinutes" INTEGER,
ADD COLUMN     "outcome" "ActivityOutcome";

-- CreateTable
CREATE TABLE "Target" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "metric" "TargetMetric" NOT NULL,
    "period" "TargetPeriod" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "currency" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Target_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Target_organizationId_periodStart_idx" ON "Target"("organizationId", "periodStart");

-- CreateIndex
CREATE INDEX "Target_organizationId_userId_periodStart_idx" ON "Target"("organizationId", "userId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "Target_organizationId_userId_metric_periodStart_key" ON "Target"("organizationId", "userId", "metric", "periodStart");

-- AddForeignKey
ALTER TABLE "Target" ADD CONSTRAINT "Target_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Target" ADD CONSTRAINT "Target_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Target" ADD CONSTRAINT "Target_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
