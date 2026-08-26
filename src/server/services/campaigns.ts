import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";

import { db } from "@/lib/db";
import { type Ctx, requireDelete, requireWrite, visibleTo } from "@/server/authz";
import { type Result, err, ok } from "@/server/result";
import { writeAudit } from "@/server/services/audit";
import { createTask } from "@/server/services/tasks";
import { copyFor, pickVariantLabel, renderCopy } from "@/server/services/templates";

/**
 * Campaigns, sequences and enrollments — outbound cadence *without* sending.
 *
 * No email provider has been chosen (plan/04-features/outreach/plan.md), and
 * this file does not pretend otherwise. There is no send, no stub sender, no
 * "queued" state that means nothing. The cadence is real and the clock is
 * real; when a step comes due the work lands on a human as a Task carrying the
 * step's instruction and the template's subject and body, and a rep sends it
 * by hand. When a provider exists, the sweep's task-creation call is the one
 * place that changes.
 *
 * Two positional conventions, both from the schema's own doc comments:
 *
 *  - `Enrollment.currentPosition` is the last step REACHED. 0 means nothing
 *    has happened yet, so the step that is pending is the lowest step with
 *    `position > currentPosition`.
 *  - `SequenceStep.delayMinutes` is measured from the previous step
 *    completing, not from enrollment — so `nextDueAt` is always computed from
 *    the step that is about to become pending, never from `createdAt`.
 *
 * BUSINESS HOURS: deliberately not applied to sequence delays — see the note
 * on `sweepDueEnrollments`.
 */

// ─────────────────────────── validation ───────────────────────────

export const campaignNameSchema = z
  .string()
  .trim()
  .min(1, "Give the campaign a name")
  .max(80, "Campaign names are 80 characters or fewer");

/** Empty string and null both mean "not set" — stored as NULL, never as "". */
const optionalText = (max: number, message?: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .nullish()
    .transform((value) => (value ? value : null));

export const campaignCreateSchema = z.object({
  name: campaignNameSchema,
  goal: optionalText(500, "Keep the goal to 500 characters"),
  listId: z.string().cuid().nullish(),
});

export const campaignUpdateSchema = campaignCreateSchema.partial();

/**
 * A step needs *something* for a person to do.
 *
 * Until sending exists a step is worked by hand, so a step with neither a
 * template nor an instruction produces a task that says nothing. The refine is
 * what stops that reaching a rep's queue.
 */
const stepFields = z.object({
  // A year of delay is already absurd; the cap is there to stop a typo'd
  // 100000000 silently parking an enrollment past the heat death of the sun.
  delayMinutes: z.coerce
    .number()
    .int("Delays are whole minutes")
    .min(0, "A delay cannot be negative")
    .max(525_600, "That delay is longer than a year")
    .default(0),
  templateId: z.string().cuid().nullish(),
  instruction: optionalText(1000, "Keep the instruction to 1000 characters"),
});

export const stepCreateSchema = stepFields.refine(
  (step) => Boolean(step.templateId ?? step.instruction),
  { message: "A step needs a template or an instruction", path: ["templateId"] },
);

export const stepUpdateSchema = stepFields.partial();

/**
 * An enrollment points at exactly one record.
 *
 * `.strict()` on each member enforces "exactly one" — a payload carrying both
 * ids matches no member and is rejected, rather than quietly taking whichever
 * branch is tested first. Mirrors `tagTargetSchema`.
 */
export const enrollTargetSchema = z.union([
  z.object({ contactId: z.string().cuid() }).strict(),
  z.object({ leadId: z.string().cuid() }).strict(),
]);

export type CampaignCreateInput = z.infer<typeof campaignCreateSchema>;
export type EnrollTarget = z.infer<typeof enrollTargetSchema>;

// ─────────────────────────── internals ───────────────────────────

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

const minutesAfter = (from: Date, minutes: number) => new Date(from.getTime() + minutes * 60_000);

/**
 * A campaign the caller may READ: tenant scope only.
 *
 * Campaigns are shared context — a rep needs to see the team's cadence to know
 * what a prospect is already receiving.
 */
function findCampaign(ctx: Ctx, campaignId: string) {
  return db.campaign.findFirst({
    where: { id: campaignId, organizationId: ctx.organizationId },
    select: { id: true, name: true, goal: true, status: true, ownerId: true, listId: true, startedAt: true },
  });
}

/**
 * A campaign the caller may EDIT: tenant scope AND record visibility.
 *
 * Editing the definition — renaming it, reordering steps, starting or pausing
 * it — changes what every enrolled prospect receives, so for a REP it is
 * restricted to their own campaigns. This is the same split
 * `services/companies.ts` uses: shared to read, owner-scoped to write.
 *
 * Enrolling and stopping deliberately do NOT go through here (see `enroll`).
 */
async function findCampaignForEdit(ctx: Ctx, campaignId: string) {
  return db.campaign.findFirst({
    where: { id: campaignId, organizationId: ctx.organizationId, ...visibleTo(ctx) },
    select: { id: true, name: true, goal: true, status: true, ownerId: true, listId: true, startedAt: true },
  });
}

function findCampaignByName(ctx: Ctx, name: string, excludeId?: string) {
  // Case-insensitive, because `@@unique([organizationId, name])` is a plain
  // Postgres index and would hold both "Q3 Outbound" and "q3 outbound".
  return db.campaign.findFirst({
    where: {
      organizationId: ctx.organizationId,
      name: { equals: name, mode: "insensitive" },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, name: true },
  });
}

/** The steps of one campaign, always ordered — every position rule reads this. */
function stepsOf(campaignId: string) {
  return db.sequenceStep.findMany({
    where: { campaignId },
    orderBy: { position: "asc" },
    select: { id: true, position: true, delayMinutes: true, templateId: true, instruction: true },
  });
}

/** Rejects a template id belonging to another tenant, or to nothing at all. */
async function assertTemplate(ctx: Ctx, templateId: string | null | undefined): Promise<boolean> {
  if (!templateId) return true;
  const found = await db.emailTemplate.findFirst({
    where: { id: templateId, organizationId: ctx.organizationId },
    select: { id: true },
  });
  return Boolean(found);
}

// ─────────────────────────── campaign lifecycle ───────────────────────────

export async function listCampaigns(ctx: Ctx) {
  const rows = await db.campaign.findMany({
    where: { organizationId: ctx.organizationId }, // tenant scope — non-negotiable
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 200,
    select: {
      id: true,
      name: true,
      goal: true,
      status: true,
      startedAt: true,
      completedAt: true,
      owner: { select: { id: true, name: true, email: true } },
      _count: { select: { steps: true, enrollments: true } },
    },
  });

  return rows.map(({ _count, ...campaign }) => ({
    ...campaign,
    stepCount: _count.steps,
    enrollmentCount: _count.enrollments,
  }));
}

/**
 * One campaign with its sequence and a per-state enrollment breakdown.
 *
 * The breakdown is org-wide even for a REP, for the same reason tag counts
 * are: this is the campaign's health, and two people disagreeing about how
 * many prospects are enrolled would make the number useless.
 */
export async function getCampaign(ctx: Ctx, campaignId: string) {
  const campaign = await db.campaign.findFirst({
    where: { id: campaignId, organizationId: ctx.organizationId },
    select: {
      id: true,
      name: true,
      goal: true,
      status: true,
      listId: true,
      startedAt: true,
      completedAt: true,
      owner: { select: { id: true, name: true, email: true } },
      steps: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          position: true,
          delayMinutes: true,
          instruction: true,
          template: { select: { id: true, name: true, subject: true } },
        },
      },
    },
  });
  if (!campaign) return null;

  const counts = await db.enrollment.groupBy({
    by: ["state"],
    where: { organizationId: ctx.organizationId, campaignId },
    _count: { _all: true },
  });

  const enrollments = { ACTIVE: 0, PAUSED: 0, COMPLETED: 0, STOPPED: 0 };
  for (const row of counts) enrollments[row.state] = row._count._all;

  return { ...campaign, enrollments };
}

export async function createCampaign(ctx: Ctx, raw: unknown): Promise<Result<{ id: string }>> {
  requireWrite(ctx);

  const parsed = campaignCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return err("Check the highlighted fields", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const clash = await findCampaignByName(ctx, input.name);
  if (clash) return err(`A campaign called "${clash.name}" already exists`);

  if (input.listId) {
    const list = await db.prospectList.findFirst({
      where: { id: input.listId, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!list) return err("That prospect list does not exist");
  }

  try {
    const created = await db.$transaction(async (tx) => {
      const row = await tx.campaign.create({
        data: {
          organizationId: ctx.organizationId,
          name: input.name,
          goal: input.goal,
          listId: input.listId ?? null,
          // Always DRAFT: a campaign starts through `activateCampaign`, which
          // is where the "has steps" rule lives. Letting create set ACTIVE
          // would be a second door into the same state with no guard on it.
          status: "DRAFT",
          ownerId: ctx.userId,
        },
        select: { id: true },
      });
      await writeAudit(tx, ctx, {
        entity: "Campaign",
        entityId: row.id,
        action: "create",
        after: input,
      });
      return row;
    });

    return ok({ id: created.id });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    return err(`A campaign called "${input.name}" already exists`);
  }
}

export async function updateCampaign(
  ctx: Ctx,
  campaignId: string,
  raw: unknown,
): Promise<Result<{ id: string }>> {
  requireWrite(ctx);

  const parsed = campaignUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return err("Check the highlighted fields", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const before = await findCampaignForEdit(ctx, campaignId);
  if (!before) return err("Campaign not found");

  if (input.name) {
    const clash = await findCampaignByName(ctx, input.name, campaignId);
    if (clash) return err(`A campaign called "${clash.name}" already exists`);
  }

  if (input.listId) {
    const list = await db.prospectList.findFirst({
      where: { id: input.listId, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!list) return err("That prospect list does not exist");
  }

  try {
    await db.$transaction(async (tx) => {
      await tx.campaign.update({
        where: { id: campaignId },
        data: {
          // `undefined` means "leave the column alone" to Prisma, which is
          // exactly the semantics of a partial update — so the keys are only
          // set when the caller sent them.
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.goal === undefined ? {} : { goal: input.goal }),
          ...(input.listId === undefined ? {} : { listId: input.listId ?? null }),
        },
      });
      await writeAudit(tx, ctx, {
        entity: "Campaign",
        entityId: campaignId,
        action: "update",
        before,
        after: input,
      });
    });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    return err(`A campaign called "${input.name}" already exists`);
  }

  return ok({ id: campaignId });
}

/**
 * Starts a campaign, or resumes a paused one.
 *
 * Two rules, both enforced here rather than at the edge:
 *
 *  1. A campaign with no steps cannot start. An ACTIVE campaign with no steps
 *     would enroll prospects into nothing and complete them instantly.
 *  2. Positions must be contiguous from 1. A gap means a step was removed
 *     without renumbering, and `nextDueAt` would then be computed from the
 *     wrong step. `addStep` / `removeStep` / `reorderSteps` maintain this; the
 *     check is the backstop that keeps a corrupted sequence off the road.
 *
 * On resume, PAUSED enrollments restart their wait from *now* rather than
 * keeping the due date they had when the pause started. Deliberate: a campaign
 * paused for a week would otherwise wake up with every enrollment overdue and
 * fire the whole backlog in one sweep — the classic paused-campaign blast.
 * STOPPED enrollments are untouched: see `stopEnrollment`.
 */
export async function activateCampaign(
  ctx: Ctx,
  campaignId: string,
  now = new Date(),
): Promise<Result<{ id: string; resumed: number }>> {
  requireWrite(ctx);

  const campaign = await findCampaignForEdit(ctx, campaignId);
  if (!campaign) return err("Campaign not found");
  if (campaign.status === "COMPLETED") return err("That campaign has already finished");
  if (campaign.status === "ARCHIVED") return err("That campaign is archived");
  if (campaign.status === "ACTIVE") return ok({ id: campaignId, resumed: 0 });

  const steps = await stepsOf(campaignId);
  if (steps.length === 0) return err("Add at least one step before starting the campaign");

  const contiguous = steps.every((step, index) => step.position === index + 1);
  if (!contiguous) return err("The steps are numbered wrong — reorder them and try again");

  const resumed = await db.$transaction(async (tx) => {
    await tx.campaign.update({
      where: { id: campaignId },
      data: { status: "ACTIVE", startedAt: campaign.startedAt ?? now },
    });

    // One updateMany per step rather than a row-by-row loop: every paused
    // enrollment sitting at the same position gets the same new due date, and
    // the number of statements is bounded by the sequence length, not by how
    // many prospects are enrolled.
    let count = 0;
    for (const step of steps) {
      const { count: updated } = await tx.enrollment.updateMany({
        where: { campaignId, state: "PAUSED", currentPosition: step.position - 1 },
        data: { state: "ACTIVE", nextDueAt: minutesAfter(now, step.delayMinutes) },
      });
      count += updated;
    }

    // Anything paused past the last step has nothing left to do. Without this
    // it would resume ACTIVE with a due date and be completed by the next
    // sweep anyway — doing it here keeps the state honest in the meantime.
    const { count: finished } = await tx.enrollment.updateMany({
      where: { campaignId, state: "PAUSED", currentPosition: { gte: steps.length } },
      data: { state: "COMPLETED", completedAt: now, nextDueAt: null },
    });

    await writeAudit(tx, ctx, {
      entity: "Campaign",
      entityId: campaignId,
      action: "activate",
      before: { status: campaign.status },
      after: { status: "ACTIVE", resumed: count, completed: finished },
    });

    return count;
  });

  return ok({ id: campaignId, resumed });
}

/**
 * Pauses a campaign and every ACTIVE enrollment on it.
 *
 * `nextDueAt` is nulled, as the schema's doc comment requires — the sweep
 * selects on `(state, nextDueAt)` and a paused row with no due date falls out
 * of the index for free.
 *
 * STOPPED enrollments are not in the `where` and never will be: stopping is a
 * per-prospect decision (replied, bounced, unsubscribed) and outranks the
 * campaign's state in both directions.
 */
export async function pauseCampaign(
  ctx: Ctx,
  campaignId: string,
): Promise<Result<{ id: string; paused: number }>> {
  requireWrite(ctx);

  const campaign = await findCampaignForEdit(ctx, campaignId);
  if (!campaign) return err("Campaign not found");
  if (campaign.status !== "ACTIVE") return err("Only a running campaign can be paused");

  const paused = await db.$transaction(async (tx) => {
    await tx.campaign.update({ where: { id: campaignId }, data: { status: "PAUSED" } });

    const { count } = await tx.enrollment.updateMany({
      where: { campaignId, state: "ACTIVE" },
      data: { state: "PAUSED", nextDueAt: null },
    });

    await writeAudit(tx, ctx, {
      entity: "Campaign",
      entityId: campaignId,
      action: "pause",
      before: { status: campaign.status },
      after: { status: "PAUSED", paused: count },
    });

    return count;
  });

  return ok({ id: campaignId, paused });
}

/**
 * Ends a campaign for good: nobody else advances, nobody else is enrolled.
 *
 * In-flight enrollments are marked COMPLETED rather than STOPPED — they ended
 * because the campaign ended, not because the prospect did something, and
 * `stoppedReason` is reserved for the latter.
 */
export async function completeCampaign(
  ctx: Ctx,
  campaignId: string,
  now = new Date(),
): Promise<Result<{ id: string; closed: number }>> {
  requireWrite(ctx);

  const campaign = await findCampaignForEdit(ctx, campaignId);
  if (!campaign) return err("Campaign not found");
  if (campaign.status === "COMPLETED") return ok({ id: campaignId, closed: 0 });
  if (campaign.status === "ARCHIVED") return err("That campaign is archived");

  const closed = await db.$transaction(async (tx) => {
    await tx.campaign.update({
      where: { id: campaignId },
      data: { status: "COMPLETED", completedAt: now },
    });

    const { count } = await tx.enrollment.updateMany({
      where: { campaignId, state: { in: ["ACTIVE", "PAUSED"] } },
      data: { state: "COMPLETED", completedAt: now, nextDueAt: null },
    });

    await writeAudit(tx, ctx, {
      entity: "Campaign",
      entityId: campaignId,
      action: "complete",
      before: { status: campaign.status },
      after: { status: "COMPLETED", closed: count },
    });

    return count;
  });

  return ok({ id: campaignId, closed });
}

/**
 * Archives a campaign — the soft delete, and MANAGER+ for that reason.
 *
 * In-flight enrollments are STOPPED with a reason rather than completed: they
 * did not finish the sequence, and reporting that they did would overstate how
 * many prospects saw the whole cadence.
 */
export async function archiveCampaign(
  ctx: Ctx,
  campaignId: string,
): Promise<Result<{ id: string; stopped: number }>> {
  requireDelete(ctx);

  const campaign = await findCampaign(ctx, campaignId);
  if (!campaign) return err("Campaign not found");
  if (campaign.status === "ARCHIVED") return ok({ id: campaignId, stopped: 0 });

  const stopped = await db.$transaction(async (tx) => {
    await tx.campaign.update({ where: { id: campaignId }, data: { status: "ARCHIVED" } });

    const { count } = await tx.enrollment.updateMany({
      where: { campaignId, state: { in: ["ACTIVE", "PAUSED"] } },
      data: { state: "STOPPED", stoppedReason: "Campaign archived", nextDueAt: null },
    });

    await writeAudit(tx, ctx, {
      entity: "Campaign",
      entityId: campaignId,
      action: "archive",
      before: { status: campaign.status },
      after: { status: "ARCHIVED", stopped: count },
    });

    return count;
  });

  return ok({ id: campaignId, stopped });
}

/**
 * Deletes a campaign outright. MANAGER+.
 *
 * Steps and enrollments cascade — which also destroys the record of who was
 * contacted through it. `archiveCampaign` is the reversible choice and should
 * be the default in any UI built on this.
 */
export async function deleteCampaign(ctx: Ctx, campaignId: string): Promise<Result<{ id: string }>> {
  requireDelete(ctx);

  const existing = await findCampaign(ctx, campaignId);
  if (!existing) return err("Campaign not found");

  const enrolled = await db.enrollment.count({
    where: { organizationId: ctx.organizationId, campaignId },
  });

  await db.$transaction(async (tx) => {
    await tx.campaign.delete({ where: { id: campaignId } });
    await writeAudit(tx, ctx, {
      entity: "Campaign",
      entityId: campaignId,
      action: "delete",
      before: { ...existing, enrollmentsDestroyed: enrolled },
    });
  });

  return ok({ id: campaignId });
}

// ─────────────────────────── sequence steps ───────────────────────────

/**
 * Appends a step to the end of the sequence.
 *
 * Position is derived, never taken from the caller: `@@unique([campaignId,
 * position])` makes a client-supplied position a race waiting to happen, and
 * "insert in the middle" is `addStep` followed by `reorderSteps`.
 */
export async function addStep(
  ctx: Ctx,
  campaignId: string,
  raw: unknown,
): Promise<Result<{ id: string; position: number }>> {
  requireWrite(ctx);

  const parsed = stepCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return err("Check the highlighted fields", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const campaign = await findCampaignForEdit(ctx, campaignId);
  if (!campaign) return err("Campaign not found");
  if (!(await assertTemplate(ctx, input.templateId))) return err("That template does not exist");

  const created = await db.$transaction(async (tx) => {
    const last = await tx.sequenceStep.findFirst({
      where: { campaignId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const position = (last?.position ?? 0) + 1;

    const step = await tx.sequenceStep.create({
      data: {
        organizationId: ctx.organizationId,
        campaignId,
        position,
        delayMinutes: input.delayMinutes,
        templateId: input.templateId ?? null,
        instruction: input.instruction,
      },
      select: { id: true, position: true },
    });

    await writeAudit(tx, ctx, {
      entity: "SequenceStep",
      entityId: step.id,
      action: "create",
      after: { campaignId, ...input, position },
    });

    return step;
  });

  return ok(created);
}

export async function updateStep(
  ctx: Ctx,
  stepId: string,
  raw: unknown,
): Promise<Result<{ id: string }>> {
  requireWrite(ctx);

  const parsed = stepUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return err("Check the highlighted fields", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const before = await db.sequenceStep.findFirst({
    where: { id: stepId, organizationId: ctx.organizationId },
    select: {
      id: true,
      campaignId: true,
      position: true,
      delayMinutes: true,
      templateId: true,
      instruction: true,
    },
  });
  if (!before) return err("Step not found");

  const campaign = await findCampaignForEdit(ctx, before.campaignId);
  if (!campaign) return err("Step not found");

  if (input.templateId !== undefined && !(await assertTemplate(ctx, input.templateId))) {
    return err("That template does not exist");
  }

  // The "something to do" rule has to hold after the merge, not just on
  // create — clearing the instruction of a step that has no template would
  // otherwise leave a blank task in someone's queue.
  const templateAfter = input.templateId === undefined ? before.templateId : input.templateId;
  const instructionAfter = input.instruction === undefined ? before.instruction : input.instruction;
  if (!templateAfter && !instructionAfter) {
    return err("A step needs a template or an instruction");
  }

  await db.$transaction(async (tx) => {
    await tx.sequenceStep.update({
      where: { id: stepId },
      data: {
        ...(input.delayMinutes === undefined ? {} : { delayMinutes: input.delayMinutes }),
        ...(input.templateId === undefined ? {} : { templateId: input.templateId ?? null }),
        ...(input.instruction === undefined ? {} : { instruction: input.instruction }),
      },
    });
    await writeAudit(tx, ctx, {
      entity: "SequenceStep",
      entityId: stepId,
      action: "update",
      before,
      after: input,
    });
  });

  return ok({ id: stepId });
}

/**
 * Removes a step and closes the gap it leaves.
 *
 * MANAGER+, like every delete. Renumbering is not cosmetic: `nextDueAt` is
 * computed from "the lowest step above my current position", so a hole would
 * silently change which copy a prospect receives next.
 *
 * Enrollments already past the removed step keep their `currentPosition`, so
 * renumbering can move a prospect's pointer relative to the sequence. That is
 * unavoidable with positional steps and is why editing a running campaign's
 * sequence should be rare — the alternative, immutable positions, leaves the
 * gaps that `activateCampaign` rejects.
 */
export async function removeStep(ctx: Ctx, stepId: string): Promise<Result<{ id: string }>> {
  requireDelete(ctx);

  const step = await db.sequenceStep.findFirst({
    where: { id: stepId, organizationId: ctx.organizationId },
    select: { id: true, campaignId: true, position: true },
  });
  if (!step) return err("Step not found");

  await db.$transaction(async (tx) => {
    await tx.sequenceStep.delete({ where: { id: stepId } });

    const remaining = await tx.sequenceStep.findMany({
      where: { campaignId: step.campaignId },
      orderBy: { position: "asc" },
      select: { id: true, position: true },
    });

    await renumber(tx, remaining.map((row) => row.id));

    await writeAudit(tx, ctx, {
      entity: "SequenceStep",
      entityId: stepId,
      action: "delete",
      before: step,
    });
  });

  return ok({ id: stepId });
}

/**
 * Writes positions 1..n for `orderedIds`, in two passes.
 *
 * The two passes are the whole point. `@@unique([campaignId, position])` is
 * checked per statement, so assigning final positions directly collides the
 * moment any step moves into a slot another step has not vacated yet —
 * swapping steps 1 and 2 fails on the first write. Parking every row on a
 * NEGATIVE position first guarantees an empty positive range to write into,
 * and negatives can never collide with a real position.
 *
 * Runs inside the caller's transaction, so a failure mid-renumber cannot leave
 * the sequence parked on negative positions.
 */
async function renumber(tx: Prisma.TransactionClient, orderedIds: string[]): Promise<void> {
  for (const [index, id] of orderedIds.entries()) {
    await tx.sequenceStep.update({ where: { id }, data: { position: -(index + 1) } });
  }
  for (const [index, id] of orderedIds.entries()) {
    await tx.sequenceStep.update({ where: { id }, data: { position: index + 1 } });
  }
}

/**
 * Reorders the whole sequence in one shot.
 *
 * Takes the complete list of step ids rather than a move instruction: a
 * partial list cannot express the result unambiguously, and validating it
 * against the campaign's actual steps is what stops a step from another
 * campaign — or another tenant — being dragged in.
 */
export async function reorderSteps(
  ctx: Ctx,
  campaignId: string,
  orderedIds: unknown,
): Promise<Result<{ id: string; positions: Record<string, number> }>> {
  requireWrite(ctx);

  const parsed = z.array(z.string().cuid()).min(1).safeParse(orderedIds);
  if (!parsed.success) return err("Send the steps in the order you want them");
  const ids = parsed.data;

  const campaign = await findCampaignForEdit(ctx, campaignId);
  if (!campaign) return err("Campaign not found");

  const existing = await stepsOf(campaignId);
  const known = new Set(existing.map((step) => step.id));
  const requested = new Set(ids);

  if (requested.size !== ids.length) return err("That order lists the same step twice");
  if (requested.size !== known.size || ids.some((id) => !known.has(id))) {
    return err("That order does not match the campaign's steps");
  }

  await db.$transaction(async (tx) => {
    await renumber(tx, ids);
    await writeAudit(tx, ctx, {
      entity: "Campaign",
      entityId: campaignId,
      action: "reorder-steps",
      before: { order: existing.map((step) => step.id) },
      after: { order: ids },
    });
  });

  return ok({
    id: campaignId,
    positions: Object.fromEntries(ids.map((id, index) => [id, index + 1])),
  });
}

// ─────────────────────────── enrollment ───────────────────────────

/**
 * The distinct variant labels in play across a campaign's templates.
 *
 * An enrollment carries ONE label for the whole sequence, so the bucket has to
 * be drawn from the campaign as a whole rather than per step. A step whose
 * template has no arm with that label falls back to the template's own copy
 * (`copyFor`), which is what makes "A/B the first email only" work.
 */
async function variantLabelsFor(organizationId: string, campaignId: string): Promise<string[]> {
  const rows = await db.templateVariant.findMany({
    where: { organizationId, template: { steps: { some: { campaignId } } } },
    select: { label: true },
    distinct: ["label"],
  });
  return rows.map((row) => row.label);
}

/**
 * Enrolls one contact or lead.
 *
 * IDEMPOTENT. Enrolling someone already enrolled returns the existing
 * enrollment with `created: false` — not an error, and not a second row. This
 * is the behaviour the feature actually needs: enrollment is driven from lists
 * and imports that get re-run, and a retry that either throws or double-sends
 * is the difference between a campaign and a complaint. The unique constraints
 * are the real guarantee; `P2002` is caught as the race backstop.
 *
 * Visibility, not just tenancy: a REP may only enroll records they own. Being
 * able to enroll a colleague's contact would let a rep both learn of its
 * existence and put copy in front of it.
 *
 * Deliberately NOT restricted to the campaign owner — enrolling a prospect is
 * working the prospect, not editing the cadence, and a rep adding their own
 * contacts to the team's campaign is the normal case.
 */
export async function enroll(
  ctx: Ctx,
  campaignId: string,
  rawTarget: unknown,
  now = new Date(),
): Promise<Result<{ id: string; created: boolean; variantLabel: string | null }>> {
  requireWrite(ctx);

  const parsedTarget = enrollTargetSchema.safeParse(rawTarget);
  if (!parsedTarget.success) return err("Enroll exactly one contact or lead");
  const target = parsedTarget.data;

  const campaign = await findCampaign(ctx, campaignId);
  if (!campaign) return err("Campaign not found");
  if (campaign.status === "COMPLETED") return err("That campaign has already finished");
  if (campaign.status === "ARCHIVED") return err("That campaign is archived");

  const steps = await stepsOf(campaignId);
  if (steps.length === 0) return err("Add at least one step before enrolling anyone");

  // Both tables carry organizationId, ownerId and deletedAt, so one scope
  // fragment serves either branch.
  const scope = { organizationId: ctx.organizationId, deletedAt: null, ...visibleTo(ctx) };
  const recordId =
    "contactId" in target
      ? (await db.contact.findFirst({ where: { id: target.contactId, ...scope }, select: { id: true } }))?.id
      : (await db.lead.findFirst({ where: { id: target.leadId, ...scope }, select: { id: true } }))?.id;
  if (!recordId) return err("That record does not exist");

  const columns =
    "contactId" in target
      ? { contactId: recordId, leadId: null }
      : { contactId: null, leadId: recordId };

  // Fast path: already enrolled. The unique indexes below still do the real
  // work — this only saves the round trip in the common re-run case.
  const existing = await db.enrollment.findFirst({
    where: { organizationId: ctx.organizationId, campaignId, ...columns },
    select: { id: true, variantLabel: true },
  });
  if (existing) return ok({ id: existing.id, created: false, variantLabel: existing.variantLabel });

  /*
   * The bucket is decided HERE, once, and stored.
   *
   * The seed is `(campaignId, recordId)` — not the enrollment id, which does
   * not exist yet, and not a random number. So a failed enroll retried a
   * second later lands the prospect in the same arm it would have had, and a
   * deleted-then-recreated enrollment does not silently move them between arms
   * mid-experiment.
   */
  const variantLabel = pickVariantLabel(
    await variantLabelsFor(ctx.organizationId, campaignId),
    `${campaignId}:${recordId}`,
  );

  // A prospect enrolled into a paused campaign waits with it. Not an error:
  // building the audience while the cadence is held is a normal thing to do.
  const state = campaign.status === "PAUSED" ? "PAUSED" : "ACTIVE";
  // Step 1's delay is the one measured from enrollment; every later step is
  // measured from its predecessor completing.
  const nextDueAt = state === "ACTIVE" ? minutesAfter(now, steps[0].delayMinutes) : null;

  try {
    const created = await db.$transaction(async (tx) => {
      const row = await tx.enrollment.create({
        data: {
          organizationId: ctx.organizationId,
          campaignId,
          ...columns,
          state,
          currentPosition: 0,
          nextDueAt,
          variantLabel,
        },
        select: { id: true },
      });
      await writeAudit(tx, ctx, {
        entity: "Enrollment",
        entityId: row.id,
        action: "enroll",
        after: { campaignId, ...columns, variantLabel, nextDueAt },
      });
      return row;
    });

    return ok({ id: created.id, created: true, variantLabel });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    // Lost a race with a concurrent enroll. The end state is what was asked
    // for, so this is a no-op rather than an error.
    const raced = await db.enrollment.findFirst({
      where: { organizationId: ctx.organizationId, campaignId, ...columns },
      select: { id: true, variantLabel: true },
    });
    return raced
      ? ok({ id: raced.id, created: false, variantLabel: raced.variantLabel })
      : err("That record could not be enrolled");
  }
}

/**
 * Enrolls every member of the campaign's prospect list.
 *
 * SEQUENTIAL, not `Promise.all`. Each `enroll` opens an interactive
 * transaction, and running those concurrently over the pg adapter corrupts the
 * protocol: `08P01: bind message supplies N parameters, but prepared statement
 * "" requires 0`. The same rule governs `sweepDueEnrollments` and the cron
 * route; it is documented in plan/06-ops/local-development.md.
 *
 * Idempotent by construction, because `enroll` is — re-running it after adding
 * people to the list enrolls only the newcomers.
 */
export async function enrollList(
  ctx: Ctx,
  campaignId: string,
  options: { limit?: number; now?: Date } = {},
): Promise<Result<{ enrolled: number; alreadyEnrolled: number; skipped: number }>> {
  requireWrite(ctx);

  const now = options.now ?? new Date();
  const limit = options.limit ?? 500;

  const campaign = await findCampaign(ctx, campaignId);
  if (!campaign) return err("Campaign not found");
  if (!campaign.listId) return err("That campaign has no prospect list attached");

  const members = await db.prospectListMember.findMany({
    where: { organizationId: ctx.organizationId, listId: campaign.listId },
    orderBy: { addedAt: "asc" },
    take: limit,
    select: { contactId: true, leadId: true },
  });

  const results = { enrolled: 0, alreadyEnrolled: 0, skipped: 0 };

  for (const member of members) {
    const target = member.contactId
      ? { contactId: member.contactId }
      : member.leadId
        ? { leadId: member.leadId }
        : null;
    // A member row with neither id cannot happen through the service, but a
    // silent `continue` beats a crash if one ever does.
    if (!target) {
      results.skipped++;
      continue;
    }

    const outcome = await enroll(ctx, campaignId, target, now);
    // A refusal here is nearly always "not visible to this rep", which is a
    // skip rather than a failure of the whole run.
    if (!outcome.ok) results.skipped++;
    else if (outcome.data.created) results.enrolled++;
    else results.alreadyEnrolled++;
  }

  return ok(results);
}

/**
 * Stops one prospect's enrollment for good.
 *
 * `requireWrite`, not `requireDelete`: stopping is part of working a prospect —
 * they replied, bounced or unsubscribed — and nothing is destroyed. It is also
 * terminal by design. `activateCampaign` never resumes a STOPPED enrollment,
 * because the reason it stopped has nothing to do with the campaign's state,
 * and "we paused the campaign, then resumed it, and it emailed the person who
 * asked us to stop" is the failure this rule exists to prevent.
 */
export async function stopEnrollment(
  ctx: Ctx,
  enrollmentId: string,
  reason: string,
): Promise<Result<{ id: string; stopped: boolean }>> {
  requireWrite(ctx);

  const parsed = z.string().trim().min(1, "Why is it stopping?").max(200).safeParse(reason);
  if (!parsed.success) return err("Say why the enrollment is stopping");

  const existing = await db.enrollment.findFirst({
    where: { id: enrollmentId, organizationId: ctx.organizationId },
    select: { id: true, state: true, stoppedReason: true, currentPosition: true },
  });
  if (!existing) return err("Enrollment not found");
  if (existing.state === "STOPPED") return ok({ id: enrollmentId, stopped: false });

  await db.$transaction(async (tx) => {
    await tx.enrollment.update({
      where: { id: enrollmentId },
      data: { state: "STOPPED", stoppedReason: parsed.data, nextDueAt: null },
    });
    await writeAudit(tx, ctx, {
      entity: "Enrollment",
      entityId: enrollmentId,
      action: "stop",
      before: existing,
      after: { state: "STOPPED", stoppedReason: parsed.data },
    });
  });

  return ok({ id: enrollmentId, stopped: true });
}

/** One prospect's position in a campaign, for a record detail view. */
export async function listEnrollments(
  ctx: Ctx,
  filter: { campaignId?: string; contactId?: string; leadId?: string } = {},
) {
  return db.enrollment.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(filter.campaignId ? { campaignId: filter.campaignId } : {}),
      ...(filter.contactId ? { contactId: filter.contactId } : {}),
      ...(filter.leadId ? { leadId: filter.leadId } : {}),
    },
    orderBy: [{ nextDueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: 200,
    select: {
      id: true,
      state: true,
      currentPosition: true,
      nextDueAt: true,
      variantLabel: true,
      stoppedReason: true,
      completedAt: true,
      contactId: true,
      leadId: true,
      campaign: { select: { id: true, name: true, status: true } },
    },
  });
}

// ─────────────────────────── the sweep ───────────────────────────

export type SweepResult = {
  scanned: number;
  tasksCreated: number;
  advanced: number;
  completed: number;
  failed: number;
};

/** Cached role lookup — a sweep touches the same few owners over and over. */
async function ctxForUser(
  cache: Map<string, Ctx | null>,
  organizationId: string,
  userId: string,
): Promise<Ctx | null> {
  const cached = cache.get(userId);
  if (cached !== undefined) return cached;

  const user = await db.user.findFirst({
    where: { id: userId, organizationId, deletedAt: null },
    select: { id: true, role: true },
  });
  const resolved: Ctx | null = user ? { userId: user.id, organizationId, role: user.role } : null;
  cache.set(userId, resolved);
  return resolved;
}

/**
 * `createTask` as an outcome rather than an exception.
 *
 * It calls `requireWrite`, which THROWS for a READ_ONLY caller — and the actor
 * here is whoever happened to own the campaign, whose role may have been
 * downgraded since. One demoted user must not abort the sweep for every other
 * tenant, so the throw is turned into the same `Result` shape the rest of the
 * loop already handles.
 */
async function attemptTask(
  actor: Ctx,
  payload: Parameters<typeof createTask>[1],
): Promise<Result<{ id: string }>> {
  try {
    return await createTask(actor, payload);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

/** The person this step lands on: whoever owns the record, else the campaign. */
function describeRecord(record: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  companyName?: string | null;
}): string {
  return (
    [record.firstName, record.lastName].filter(Boolean).join(" ") ||
    record.email ||
    record.companyName ||
    "this prospect"
  );
}

/**
 * Advances every enrollment whose next step is due.
 *
 * THIS IS WHERE AN EMAIL WOULD BE SENT, AND IS NOT. There is no provider, so
 * the due step becomes a Task assigned to the record's owner (falling back to
 * the campaign's owner) carrying the step's instruction and the resolved
 * template copy, and the enrollment is recorded as having reached that step.
 * Nothing anywhere claims a message went out. When a provider is chosen, the
 * `createTask` call below is the single line that changes.
 *
 * SEQUENTIAL, not `Promise.all`. Every iteration opens an interactive
 * transaction, and running those concurrently over the pg adapter produces
 * `08P01: bind message supplies N parameters, but prepared statement ""
 * requires 0`. This has bitten twice, once in a sweep exactly like this one.
 *
 * BOUNDED. `limit` caps the rows per organization per run, so a backlog drains
 * over several ticks instead of one run timing out at the 60s function limit
 * and losing everything it had not committed.
 *
 * Ordering is task-first, then advance: a crash between the two repeats a task
 * next tick, which is noise, while advancing first and crashing would skip a
 * prospect's step entirely, which is a lost deal. At-least-once is the right
 * bias for outreach — and the advance is a compare-and-set on the position it
 * read, so it cannot double-advance either.
 *
 * BUSINESS HOURS: deliberately not applied. `lib/business-hours.ts` MEASURES
 * elapsed working minutes between two instants (`businessMinutesBetween`); it
 * has no inverse that ADDS working minutes to a date, so scheduling in
 * business time would mean inverting it by search — a new algorithm, not a use
 * of the existing contract. It would also buy nothing today: what comes due is
 * a task in a queue, not a message in an inbox, and a rep picks it up when
 * they start their day. Once sending exists, send-window shaping (quiet hours,
 * per-domain rate limits, warm-up) belongs in the sender, where the deliver-
 * ability rules live — not in the enrollment clock.
 */
export async function sweepDueEnrollments(
  options: { limit?: number; organizationId?: string; now?: Date } = {},
): Promise<SweepResult> {
  const limit = options.limit ?? 100;
  const now = options.now ?? new Date();
  const results: SweepResult = { scanned: 0, tasksCreated: 0, advanced: 0, completed: 0, failed: 0 };

  // Per-organization, like `sweepSlaBreaches`: it matches
  // `@@index([organizationId, state, nextDueAt])`, and it lets support
  // reprocess one customer without touching the rest.
  const organizations = await db.organization.findMany({
    where: options.organizationId ? { id: options.organizationId } : undefined,
    select: { id: true },
  });

  for (const org of organizations) {
    const due = await db.enrollment.findMany({
      where: {
        organizationId: org.id,
        state: "ACTIVE",
        nextDueAt: { lte: now },
        // An enrollment only advances while its campaign is running. A DRAFT
        // campaign can have an audience built in advance without that audience
        // quietly receiving anything.
        campaign: { status: "ACTIVE" },
      },
      orderBy: { nextDueAt: "asc" }, // oldest debt first
      take: limit,
      select: {
        id: true,
        campaignId: true,
        currentPosition: true,
        variantLabel: true,
        contactId: true,
        leadId: true,
        campaign: {
          select: {
            id: true,
            name: true,
            ownerId: true,
            steps: {
              orderBy: { position: "asc" },
              select: {
                id: true,
                position: true,
                delayMinutes: true,
                instruction: true,
                template: {
                  select: {
                    subject: true,
                    body: true,
                    variants: { select: { label: true, subject: true, body: true } },
                  },
                },
              },
            },
          },
        },
        contact: { select: { id: true, firstName: true, lastName: true, email: true, ownerId: true } },
        lead: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            companyName: true,
            ownerId: true,
          },
        },
      },
    });

    const ctxCache = new Map<string, Ctx | null>();

    for (const enrollment of due) {
      results.scanned++;

      const steps = enrollment.campaign.steps;
      // "The lowest step above where I am" — reads correctly even if a step
      // was removed and positions shifted underneath this enrollment.
      const step = steps.find((candidate) => candidate.position > enrollment.currentPosition);

      if (!step) {
        // Nothing left to do: finish, and stop selecting this row forever.
        const { count } = await db.enrollment.updateMany({
          where: { id: enrollment.id, state: "ACTIVE" },
          data: { state: "COMPLETED", completedAt: now, nextDueAt: null },
        });
        if (count > 0) results.completed++;
        continue;
      }

      const record = enrollment.contact ?? enrollment.lead;
      if (!record) {
        // Both sides null — the record was hard-deleted out from under a row
        // the cascade should have taken. Stop the enrollment rather than
        // looping on it every five minutes.
        await db.enrollment.updateMany({
          where: { id: enrollment.id, state: "ACTIVE" },
          data: { state: "STOPPED", stoppedReason: "Record no longer exists", nextDueAt: null },
        });
        results.failed++;
        continue;
      }

      // The actor is the campaign's owner — the cron acts on their behalf —
      // while the task lands on whoever owns the record, because they are the
      // one with the relationship. When those differ, `createTask` notifies.
      const actor = await ctxForUser(ctxCache, org.id, enrollment.campaign.ownerId);
      if (!actor) {
        results.failed++;
        continue;
      }
      const assigneeId = record.ownerId ?? enrollment.campaign.ownerId;

      const copy = step.template
        ? renderCopy(copyFor(step.template, enrollment.variantLabel), {
            first_name: record.firstName,
            last_name: record.lastName,
            email: record.email,
            company: "companyName" in record ? record.companyName : null,
          })
        : null;

      const action =
        step.instruction ?? (copy ? `Send "${copy.subject}"` : `Work step ${step.position}`);

      const notes = [
        `Campaign: ${enrollment.campaign.name} · step ${step.position}`,
        step.instruction,
        copy ? `Subject: ${copy.subject}` : null,
        copy ? `\n${copy.body}` : null,
        enrollment.variantLabel ? `Variant: ${enrollment.variantLabel}` : null,
        // Said plainly, because the whole design rests on it.
        "Sending is not automated yet — send this by hand, then mark the task done.",
      ]
        .filter(Boolean)
        .join("\n\n");

      const payload = {
        title: truncate(`${describeRecord(record)} · ${action}`, 200),
        notes: truncate(notes, 5000),
        dueAt: now,
        assigneeId,
        ...(enrollment.contactId
          ? { contactId: enrollment.contactId }
          : { leadId: enrollment.leadId }),
      };

      let task = await attemptTask(actor, payload);
      if (!task.ok && assigneeId !== actor.userId) {
        // The campaign's owner cannot see this record — ownership moved after
        // enrollment. The record's owner always can, so re-run as them rather
        // than stalling the enrollment on every future tick.
        const fallback = await ctxForUser(ctxCache, org.id, assigneeId);
        if (fallback) task = await attemptTask(fallback, payload);
      }
      if (!task.ok) {
        // Left untouched on purpose: nextDueAt still points at now, so the
        // next tick retries. Counted so a stuck enrollment shows in telemetry
        // instead of disappearing.
        results.failed++;
        continue;
      }
      results.tasksCreated++;

      const following = steps.find((candidate) => candidate.position > step.position);
      const taskId = task.data.id;

      const moved = await db.$transaction(async (tx) => {
        const { count } = await tx.enrollment.updateMany({
          // Compare-and-set on the position this iteration read: a concurrent
          // sweep that already advanced this row updates nothing here.
          where: { id: enrollment.id, state: "ACTIVE", currentPosition: enrollment.currentPosition },
          data: following
            ? {
                currentPosition: step.position,
                nextDueAt: minutesAfter(now, following.delayMinutes),
              }
            : {
                currentPosition: step.position,
                state: "COMPLETED",
                completedAt: now,
                nextDueAt: null,
              },
        });
        if (count === 0) return false;

        // The record that the step was reached. Not "sent" — reached.
        await writeAudit(tx, actor, {
          entity: "Enrollment",
          entityId: enrollment.id,
          action: "step-due",
          before: { currentPosition: enrollment.currentPosition },
          after: {
            currentPosition: step.position,
            stepId: step.id,
            taskId,
            variantLabel: enrollment.variantLabel,
            completed: !following,
          },
        });

        return true;
      });

      // Counted outside the transaction: a rolled-back advance must not be
      // reported as one.
      if (moved) {
        results.advanced++;
        if (!following) results.completed++;
      }
    }
  }

  return results;
}
