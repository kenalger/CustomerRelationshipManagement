-- AlterTable
ALTER TABLE "Connection" ADD COLUMN     "fieldMapping" JSONB;

-- AlterTable
ALTER TABLE "IngestionEvent" ADD COLUMN     "nextAttemptAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "IngestionEvent_status_nextAttemptAt_idx" ON "IngestionEvent"("status", "nextAttemptAt");
