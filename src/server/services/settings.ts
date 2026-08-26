import { db } from "@/lib/db";
import {
  organizationSchema,
  pipelineSchema,
  reorderSchema,
  stageSchema,
} from "@/lib/validation/settings";
import { type Ctx, requireRole } from "@/server/authz";
import { type Result, err, ok } from "@/server/result";
import { writeAudit } from "@/server/services/audit";

// ─────────────────────────── organization ───────────────────────────

export async function getOrganization(ctx: Ctx) {
  return db.organization.findUniqueOrThrow({
    where: { id: ctx.organizationId },
    select: {
      id: true,
      name: true,
      slug: true,
      industry: true,
      website: true,
      timezone: true,
      businessHoursEnabled: true,
      businessDays: true,
      businessStartMinute: true,
      businessEndMinute: true,
      rawPayloadRetentionDays: true,
      slaFirstTouchMinutes: true,
      slaEscalateMinutes: true,
    },
  });
}

export async function updateOrganization(ctx: Ctx, raw: unknown): Promise<Result<{ id: string }>> {
  requireRole(ctx, "ADMIN");

  const parsed = organizationSchema.safeParse(raw);
  if (!parsed.success) {
    return err("Check the highlighted fields", parsed.error.flatten().fieldErrors);
  }

  // An escalation window at or before the first-touch target would fire both
  // stages on the same sweep, so the nudge would never be seen alone.
  if (parsed.data.slaEscalateMinutes <= parsed.data.slaFirstTouchMinutes) {
    return err("Escalation must come after the first-touch target", {
      slaEscalateMinutes: ["Set this higher than the first-touch target"],
    });
  }

  const before = await getOrganization(ctx);

  await db.$transaction(async (tx) => {
    await tx.organization.update({ where: { id: ctx.organizationId }, data: parsed.data });
    await writeAudit(tx, ctx, {
      entity: "Organization",
      entityId: ctx.organizationId,
      action: "update",
      before,
      after: parsed.data,
    });
  });

  return ok({ id: ctx.organizationId });
}

// ─────────────────────────── pipelines ───────────────────────────

export async function listPipelines(ctx: Ctx) {
  return db.pipeline.findMany({
    where: { organizationId: ctx.organizationId, deletedAt: null },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      isDefault: true,
      stages: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          name: true,
          order: true,
          probability: true,
          isWon: true,
          isLost: true,
          _count: { select: { deals: true } },
        },
      },
    },
  });
}

export async function createPipeline(ctx: Ctx, raw: unknown): Promise<Result<{ id: string }>> {
  requireRole(ctx, "ADMIN");

  const parsed = pipelineSchema.safeParse(raw);
  if (!parsed.success) return err("Give the pipeline a name");

  const clash = await db.pipeline.findFirst({
    where: { organizationId: ctx.organizationId, name: parsed.data.name, deletedAt: null },
    select: { id: true },
  });
  if (clash) return err("A pipeline with that name already exists");

  const pipeline = await db.$transaction(async (tx) => {
    const created = await tx.pipeline.create({
      data: { organizationId: ctx.organizationId, name: parsed.data.name },
      select: { id: true },
    });

    // A pipeline with no stages cannot hold a deal, so it is never created empty.
    await tx.stage.createMany({
      data: [
        { pipelineId: created.id, name: "New", order: 1, probability: 10 },
        { pipelineId: created.id, name: "Won", order: 2, probability: 100, isWon: true },
        { pipelineId: created.id, name: "Lost", order: 3, probability: 0, isLost: true },
      ],
    });

    await writeAudit(tx, ctx, {
      entity: "Pipeline",
      entityId: created.id,
      action: "create",
      after: parsed.data,
    });
    return created;
  });

  return ok({ id: pipeline.id });
}

export async function renamePipeline(
  ctx: Ctx,
  pipelineId: string,
  raw: unknown,
): Promise<Result<{ id: string }>> {
  requireRole(ctx, "ADMIN");

  const parsed = pipelineSchema.safeParse(raw);
  if (!parsed.success) return err("Give the pipeline a name");

  const pipeline = await db.pipeline.findFirst({
    where: { id: pipelineId, organizationId: ctx.organizationId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!pipeline) return err("Pipeline not found");

  await db.$transaction(async (tx) => {
    await tx.pipeline.update({ where: { id: pipelineId }, data: { name: parsed.data.name } });
    await writeAudit(tx, ctx, {
      entity: "Pipeline",
      entityId: pipelineId,
      action: "rename",
      before: { name: pipeline.name },
      after: parsed.data,
    });
  });

  return ok({ id: pipelineId });
}

export async function setDefaultPipeline(ctx: Ctx, pipelineId: string): Promise<Result<{ id: string }>> {
  requireRole(ctx, "ADMIN");

  const pipeline = await db.pipeline.findFirst({
    where: { id: pipelineId, organizationId: ctx.organizationId, deletedAt: null },
    select: { id: true },
  });
  if (!pipeline) return err("Pipeline not found");

  await db.$transaction(async (tx) => {
    // Exactly one default, always.
    await tx.pipeline.updateMany({
      where: { organizationId: ctx.organizationId },
      data: { isDefault: false },
    });
    await tx.pipeline.update({ where: { id: pipelineId }, data: { isDefault: true } });
    await writeAudit(tx, ctx, {
      entity: "Pipeline",
      entityId: pipelineId,
      action: "set_default",
    });
  });

  return ok({ id: pipelineId });
}

// ─────────────────────────── stages ───────────────────────────

export async function addStage(
  ctx: Ctx,
  pipelineId: string,
  raw: unknown,
): Promise<Result<{ id: string }>> {
  requireRole(ctx, "ADMIN");

  const parsed = stageSchema.safeParse(raw);
  if (!parsed.success) {
    return err("Check the highlighted fields", parsed.error.flatten().fieldErrors);
  }

  const pipeline = await db.pipeline.findFirst({
    where: { id: pipelineId, organizationId: ctx.organizationId, deletedAt: null },
    select: { id: true, stages: { select: { order: true } } },
  });
  if (!pipeline) return err("Pipeline not found");

  const nextOrder = Math.max(0, ...pipeline.stages.map((s) => s.order)) + 1;

  const stage = await db.$transaction(async (tx) => {
    const created = await tx.stage.create({
      data: {
        pipelineId,
        name: parsed.data.name,
        order: nextOrder,
        probability: parsed.data.probability,
        isWon: parsed.data.outcome === "won",
        isLost: parsed.data.outcome === "lost",
      },
      select: { id: true },
    });
    await writeAudit(tx, ctx, {
      entity: "Stage",
      entityId: created.id,
      action: "create",
      after: parsed.data,
    });
    return created;
  });

  return ok({ id: stage.id });
}

export async function updateStage(
  ctx: Ctx,
  stageId: string,
  raw: unknown,
): Promise<Result<{ id: string }>> {
  requireRole(ctx, "ADMIN");

  const parsed = stageSchema.safeParse(raw);
  if (!parsed.success) {
    return err("Check the highlighted fields", parsed.error.flatten().fieldErrors);
  }

  // The stage is reached through its pipeline, which is how tenancy is proven.
  const stage = await db.stage.findFirst({
    where: { id: stageId, pipeline: { organizationId: ctx.organizationId, deletedAt: null } },
    select: { id: true, name: true, probability: true, isWon: true, isLost: true },
  });
  if (!stage) return err("Stage not found");

  await db.$transaction(async (tx) => {
    await tx.stage.update({
      where: { id: stageId },
      data: {
        name: parsed.data.name,
        probability: parsed.data.probability,
        isWon: parsed.data.outcome === "won",
        isLost: parsed.data.outcome === "lost",
      },
    });
    await writeAudit(tx, ctx, {
      entity: "Stage",
      entityId: stageId,
      action: "update",
      before: stage,
      after: parsed.data,
    });
  });

  return ok({ id: stageId });
}

export async function deleteStage(ctx: Ctx, stageId: string): Promise<Result<{ id: string }>> {
  requireRole(ctx, "ADMIN");

  const stage = await db.stage.findFirst({
    where: { id: stageId, pipeline: { organizationId: ctx.organizationId, deletedAt: null } },
    select: {
      id: true,
      name: true,
      pipelineId: true,
      _count: { select: { deals: true } },
      pipeline: { select: { _count: { select: { stages: true } } } },
    },
  });
  if (!stage) return err("Stage not found");

  // Deals reference stages with onDelete: Restrict, so this would throw at the
  // database. Catching it here says something useful instead.
  if (stage._count.deals > 0) {
    return err(
      `${stage.name} still holds ${stage._count.deals} ${stage._count.deals === 1 ? "deal" : "deals"}. Move them first.`,
    );
  }
  if (stage.pipeline._count.stages <= 1) {
    return err("A pipeline needs at least one stage");
  }

  await db.$transaction(async (tx) => {
    await tx.stage.delete({ where: { id: stageId } });
    await writeAudit(tx, ctx, {
      entity: "Stage",
      entityId: stageId,
      action: "delete",
      before: { name: stage.name },
    });
  });

  return ok({ id: stageId });
}

/**
 * Rewrites stage order.
 *
 * `Stage` has a unique constraint on (pipelineId, order), so a naive swap
 * collides mid-transaction. Every row is parked on a negative order first,
 * then written to its final position — two passes, no collision, no need for a
 * deferrable constraint.
 */
export async function reorderStages(ctx: Ctx, raw: unknown): Promise<Result<{ count: number }>> {
  requireRole(ctx, "ADMIN");

  const parsed = reorderSchema.safeParse(raw);
  if (!parsed.success) return err("That reorder request was not valid");

  const pipeline = await db.pipeline.findFirst({
    where: { id: parsed.data.pipelineId, organizationId: ctx.organizationId, deletedAt: null },
    select: { id: true, stages: { select: { id: true } } },
  });
  if (!pipeline) return err("Pipeline not found");

  const owned = new Set(pipeline.stages.map((s) => s.id));
  const requested = parsed.data.stageIds;

  // Must be a permutation of exactly this pipeline's stages — a partial list
  // would leave gaps, and a foreign id would move another pipeline's stage.
  if (requested.length !== owned.size || !requested.every((id) => owned.has(id))) {
    return err("That order does not match this pipeline's stages");
  }

  await db.$transaction(async (tx) => {
    for (const [index, id] of requested.entries()) {
      await tx.stage.update({ where: { id }, data: { order: -(index + 1) } });
    }
    for (const [index, id] of requested.entries()) {
      await tx.stage.update({ where: { id }, data: { order: index + 1 } });
    }
    await writeAudit(tx, ctx, {
      entity: "Pipeline",
      entityId: pipeline.id,
      action: "reorder_stages",
      after: { stageIds: requested },
    });
  });

  return ok({ count: requested.length });
}
