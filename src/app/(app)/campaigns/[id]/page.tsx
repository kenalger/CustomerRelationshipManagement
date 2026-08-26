import { notFound } from "next/navigation";
import { z } from "zod";

import { PageHeader } from "@/components/page-header";
import type { Tone } from "@/components/ui/badge";
import { Callout } from "@/components/ui/callout";
import { db } from "@/lib/db";
import { hasRole, seesAllRecords } from "@/server/authz";
import { requireCtx } from "@/server/context";
import { getCampaign, listEnrollments } from "@/server/services/campaigns";
import { listTemplates } from "@/server/services/templates";
import { CampaignDetails } from "./campaign-details";
import { EnrollmentsTable } from "./enrollments-table";
import { LifecycleActions } from "./lifecycle-actions";
import { SequenceSteps } from "./sequence-steps";

const STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  ACTIVE: { label: "Running", tone: "success" },
  PAUSED: { label: "Paused", tone: "warning" },
  COMPLETED: { label: "Finished", tone: "info" },
  ARCHIVED: { label: "Archived", tone: "neutral" },
};

const PER_PAGE = 25;

/**
 * `.catch()` rather than `.default()`: a default only covers a MISSING value,
 * so `?page=banana` would throw out of the parse and render the error
 * boundary instead of the first page.
 */
const pageSchema = z.coerce.number().int().min(1).catch(1);

export default async function CampaignDetailPage({
  params,
  searchParams,
}: PageProps<"/campaigns/[id]">) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;

  const campaign = await getCampaign(ctx, id);
  if (!campaign) notFound();

  const [enrollments, templates, lists] = await Promise.all([
    listEnrollments(ctx, { campaignId: campaign.id }),
    listTemplates(ctx),
    db.prospectList.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  /*
   * `listEnrollments` returns the ids of the enrolled records but not their
   * names, so the names are resolved here.
   *
   * Tenant scope, not `visibleTo(ctx)` — deliberately matching the service,
   * which returns every enrollment in the organization to every role because
   * a campaign's audience is shared context. Scoping the names but not the
   * rows would produce a table of anonymous placeholders.
   */
  const contactIds = enrollments.map((e) => e.contactId).filter((v): v is string => Boolean(v));
  const leadIds = enrollments.map((e) => e.leadId).filter((v): v is string => Boolean(v));

  const [contacts, leads] = await Promise.all([
    contactIds.length
      ? db.contact.findMany({
          where: { id: { in: contactIds }, organizationId: ctx.organizationId },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [],
    leadIds.length
      ? db.lead.findMany({
          where: { id: { in: leadIds }, organizationId: ctx.organizationId },
          select: { id: true, firstName: true, lastName: true, email: true, companyName: true },
        })
      : [],
  ]);

  const nameOf = (parts: (string | null)[]) => parts.filter(Boolean).join(" ").trim();
  const people = new Map<string, { name: string; detail: string | null }>();
  for (const c of contacts) {
    people.set(c.id, {
      name: nameOf([c.firstName, c.lastName]) || c.email || "Unnamed contact",
      detail: c.email,
    });
  }
  for (const l of leads) {
    people.set(l.id, {
      name: nameOf([l.firstName, l.lastName]) || l.email || "Unnamed lead",
      detail: l.companyName ?? l.email,
    });
  }

  const status = STATUS[campaign.status] ?? { label: campaign.status, tone: "neutral" as Tone };

  /*
   * Two different permissions, because the service uses two.
   *
   * Editing the DEFINITION — renaming, steps, lifecycle — runs through
   * `findCampaignForEdit`, which applies `visibleTo`, so a REP may only touch
   * campaigns they own. Enrolling and stopping run through `findCampaign`,
   * which is tenant-scope only: working a prospect is not editing the cadence.
   */
  const canWrite = hasRole(ctx, "REP");
  const canManage =
    canWrite && (seesAllRecords(ctx) || campaign.owner?.id === ctx.userId);
  const canDelete = hasRole(ctx, "MANAGER");

  const steps = campaign.steps;
  const contiguous = steps.every((step, index) => step.position === index + 1);

  const page = pageSchema.parse(sp.page ?? 1);
  const pageCount = Math.max(1, Math.ceil(enrollments.length / PER_PAGE));
  const clamped = Math.min(page, pageCount);
  const rows = enrollments.slice((clamped - 1) * PER_PAGE, clamped * PER_PAGE);

  return (
    <>
      <PageHeader
        title={campaign.name}
        description={campaign.goal ?? "No goal written down yet."}
        action={
          <LifecycleActions
            campaignId={campaign.id}
            status={campaign.status}
            statusLabel={status.label}
            stepCount={steps.length}
            contiguous={contiguous}
            canManage={canManage}
            canDelete={canDelete}
          />
        }
      />

      <div className="mx-auto w-full max-w-[1080px] space-y-6 p-8">
        <Callout tone="info">
          This campaign will not send any email — no email provider is connected. When a step falls
          due it creates a task for whoever owns the prospect, carrying the step&rsquo;s instruction
          and the template&rsquo;s subject and body, and that person sends the message themselves
          and ticks the task off.
        </Callout>

        <CampaignDetails
          campaignId={campaign.id}
          name={campaign.name}
          goal={campaign.goal}
          listId={campaign.listId}
          lists={lists}
          status={campaign.status}
          statusLabel={status.label}
          statusTone={status.tone}
          ownerName={campaign.owner?.name ?? campaign.owner?.email ?? null}
          startedAt={campaign.startedAt}
          completedAt={campaign.completedAt}
          counts={campaign.enrollments}
          stepCount={steps.length}
          canManage={canManage}
          canWrite={canWrite}
          canDelete={canDelete}
        />

        <SequenceSteps
          campaignId={campaign.id}
          status={campaign.status}
          steps={steps.map((step) => ({
            id: step.id,
            position: step.position,
            delayMinutes: step.delayMinutes,
            instruction: step.instruction,
            template: step.template
              ? { id: step.template.id, name: step.template.name, subject: step.template.subject }
              : null,
          }))}
          templates={templates.map((template) => ({ id: template.id, name: template.name }))}
          canManage={canManage}
          canDelete={canDelete}
        />

        <EnrollmentsTable
          campaignId={campaign.id}
          rows={rows.map((row) => {
            const recordId = row.contactId ?? row.leadId;
            const person = recordId ? people.get(recordId) : undefined;
            return {
              id: row.id,
              kind: row.contactId ? ("contact" as const) : ("lead" as const),
              recordId,
              name: person?.name ?? "Record no longer exists",
              detail: person?.detail ?? null,
              state: row.state,
              currentPosition: row.currentPosition,
              nextDueAt: row.nextDueAt,
              completedAt: row.completedAt,
              variantLabel: row.variantLabel,
              stoppedReason: row.stoppedReason,
            };
          })}
          stepCount={steps.length}
          total={enrollments.length}
          page={clamped}
          pageCount={pageCount}
          capped={enrollments.length >= 200}
          canWrite={canWrite}
        />
      </div>
    </>
  );
}
