-- AlterTable
ALTER TABLE "IngestionEvent" ADD COLUMN     "payloadPrunedAt" TIMESTAMP(3),
ALTER COLUMN "payload" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "businessDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
ADD COLUMN     "businessEndMinute" INTEGER NOT NULL DEFAULT 1020,
ADD COLUMN     "businessHoursEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "businessStartMinute" INTEGER NOT NULL DEFAULT 540,
ADD COLUMN     "industry" TEXT,
ADD COLUMN     "rawPayloadRetentionDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'UTC',
ADD COLUMN     "website" TEXT;

