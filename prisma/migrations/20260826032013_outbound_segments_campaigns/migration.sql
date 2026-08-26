-- CreateEnum
CREATE TYPE "SegmentEntity" AS ENUM ('LEAD', 'CONTACT', 'COMPANY');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EnrollmentState" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'STOPPED');

-- CreateTable
CREATE TABLE "Segment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "entity" "SegmentEntity" NOT NULL,
    "filter" JSONB NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT true,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Segment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProspectList" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProspectList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProspectListMember" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "contactId" TEXT,
    "leadId" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProspectListMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateVariant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "ownerId" TEXT NOT NULL,
    "listId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SequenceStep" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "delayMinutes" INTEGER NOT NULL DEFAULT 0,
    "templateId" TEXT,
    "instruction" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SequenceStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enrollment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contactId" TEXT,
    "leadId" TEXT,
    "state" "EnrollmentState" NOT NULL DEFAULT 'ACTIVE',
    "currentPosition" INTEGER NOT NULL DEFAULT 0,
    "nextDueAt" TIMESTAMP(3),
    "variantLabel" TEXT,
    "stoppedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Segment_organizationId_entity_idx" ON "Segment"("organizationId", "entity");

-- CreateIndex
CREATE UNIQUE INDEX "Segment_organizationId_entity_name_key" ON "Segment"("organizationId", "entity", "name");

-- CreateIndex
CREATE INDEX "ProspectList_organizationId_name_idx" ON "ProspectList"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ProspectList_organizationId_name_key" ON "ProspectList"("organizationId", "name");

-- CreateIndex
CREATE INDEX "ProspectListMember_organizationId_listId_idx" ON "ProspectListMember"("organizationId", "listId");

-- CreateIndex
CREATE UNIQUE INDEX "ProspectListMember_listId_contactId_key" ON "ProspectListMember"("listId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "ProspectListMember_listId_leadId_key" ON "ProspectListMember"("listId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailTemplate_organizationId_name_key" ON "EmailTemplate"("organizationId", "name");

-- CreateIndex
CREATE INDEX "TemplateVariant_organizationId_templateId_idx" ON "TemplateVariant"("organizationId", "templateId");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateVariant_templateId_label_key" ON "TemplateVariant"("templateId", "label");

-- CreateIndex
CREATE INDEX "Campaign_organizationId_status_idx" ON "Campaign"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_organizationId_name_key" ON "Campaign"("organizationId", "name");

-- CreateIndex
CREATE INDEX "SequenceStep_organizationId_campaignId_idx" ON "SequenceStep"("organizationId", "campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "SequenceStep_campaignId_position_key" ON "SequenceStep"("campaignId", "position");

-- CreateIndex
CREATE INDEX "Enrollment_organizationId_state_nextDueAt_idx" ON "Enrollment"("organizationId", "state", "nextDueAt");

-- CreateIndex
CREATE UNIQUE INDEX "Enrollment_campaignId_contactId_key" ON "Enrollment"("campaignId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "Enrollment_campaignId_leadId_key" ON "Enrollment"("campaignId", "leadId");

-- AddForeignKey
ALTER TABLE "Segment" ADD CONSTRAINT "Segment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Segment" ADD CONSTRAINT "Segment_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectList" ADD CONSTRAINT "ProspectList_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectList" ADD CONSTRAINT "ProspectList_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectListMember" ADD CONSTRAINT "ProspectListMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectListMember" ADD CONSTRAINT "ProspectListMember_listId_fkey" FOREIGN KEY ("listId") REFERENCES "ProspectList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectListMember" ADD CONSTRAINT "ProspectListMember_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectListMember" ADD CONSTRAINT "ProspectListMember_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateVariant" ADD CONSTRAINT "TemplateVariant_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "EmailTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_listId_fkey" FOREIGN KEY ("listId") REFERENCES "ProspectList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceStep" ADD CONSTRAINT "SequenceStep_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceStep" ADD CONSTRAINT "SequenceStep_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceStep" ADD CONSTRAINT "SequenceStep_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "EmailTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
