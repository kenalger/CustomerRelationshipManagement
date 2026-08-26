-- CreateEnum
CREATE TYPE "TagColour" AS ENUM ('GRAY', 'BROWN', 'ORANGE', 'YELLOW', 'GREEN', 'BLUE', 'PURPLE', 'PINK', 'RED');

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "score" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "scoredAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "colour" "TagColour" NOT NULL DEFAULT 'GRAY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tagging" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contactId" TEXT,
    "companyId" TEXT,
    "leadId" TEXT,

    CONSTRAINT "Tagging_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Tag_organizationId_name_idx" ON "Tag"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_organizationId_name_key" ON "Tag"("organizationId", "name");

-- CreateIndex
CREATE INDEX "Tagging_organizationId_tagId_idx" ON "Tagging"("organizationId", "tagId");

-- CreateIndex
CREATE INDEX "Tagging_contactId_idx" ON "Tagging"("contactId");

-- CreateIndex
CREATE INDEX "Tagging_companyId_idx" ON "Tagging"("companyId");

-- CreateIndex
CREATE INDEX "Tagging_leadId_idx" ON "Tagging"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "Tagging_tagId_contactId_key" ON "Tagging"("tagId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "Tagging_tagId_companyId_key" ON "Tagging"("tagId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Tagging_tagId_leadId_key" ON "Tagging"("tagId", "leadId");

-- CreateIndex
CREATE INDEX "Lead_organizationId_status_score_idx" ON "Lead"("organizationId", "status", "score");

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tagging" ADD CONSTRAINT "Tagging_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tagging" ADD CONSTRAINT "Tagging_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tagging" ADD CONSTRAINT "Tagging_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tagging" ADD CONSTRAINT "Tagging_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tagging" ADD CONSTRAINT "Tagging_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

