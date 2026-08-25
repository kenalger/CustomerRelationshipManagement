import { db } from "@/lib/db";
import { dealCreateSchema, dealListFilterSchema, dealUpdateSchema } from "@/lib/validation/crm";
import { type Ctx, requireWrite } from "@/server/authz";
import { type Result, err, ok } from "@/server/result";
import { writeAudit } from "@/server/services/audit";

export async function listDeals(ctx: Ctx, rawFilter: unknown) {
  const filter = dealListFilterSchema.parse(rawFilter);

  const stageFilter =
    filter.open === "open"
      ? { stage: { isWon: false, isLost: false } }
      : filter.open === "won"
        ? { stage: { isWon: true } }
        : filter.open === "lost"
          ? { stage: { isLost: true } }
          : {};

  const where = {
    organizationId: ctx.organizationId,
    deletedAt: null,
    ...stageFilter,
    ...(filter.ownerId ? { ownerId: filter.ownerId } : {}),
    ...(filter.q ? { title: { contains: filter.q, mode: "insensitive" as const } } : {}),
  };

  const [rows, total] = await Promise.all([
    db.deal.findMany({
      where,
      orderBy: [{ expectedCloseDate: "asc" }, { createdAt: "desc" }],
      skip: (filter.page - 1) * filter.perPage,
      take: filter.perPage,
      select: {
        id: true,
        title: true,
        value: true,
        currency: true,
        expectedCloseDate: true,
        stage: { select: { id: true, name: true, probability: true, isWon: true, isLost: true } },
        company: { select: { id: true, name: true } },
        contact: { select: { id: true, firstName: true, lastName: true } },
        owner: { select: { id: true, name: true, email: true } },
      },
    }),
    db.deal.count({ where }),
  ]);

  return { rows, total, page: filter.page, perPage: filter.perPage };
}

/** The board: every stage of a pipeline with its open deals. */
export async function getPipelineBoard(ctx: Ctx, pipelineId?: string) {
  const pipeline = await db.pipeline.findFirst({
    where: {
      organizationId: ctx.organizationId,
      deletedAt: null,
      ...(pipelineId ? { id: pipelineId } : {}),
    },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      stages: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          name: true,
          order: true,
          probability: true,
          isWon: true,
          isLost: true,
          deals: {
            where: { organizationId: ctx.organizationId, deletedAt: null },
            orderBy: { updatedAt: "desc" },
            take: 50,
            select: {
              id: true,
              title: true,
              value: true,
              currency: true,
              stageEnteredAt: true,
              company: { select: { name: true } },
              owner: { select: { name: true, email: true } },
            },
          },
        },
      },
    },
  });

  return pipeline;
}

export async function createDeal(ctx: Ctx, raw: unknown): Promise<Result<{ id: string }>> {
  requireWrite(ctx);

  const parsed = dealCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return err("Check the highlighted fields", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const pipeline = await db.pipeline.findFirst({
    where: {
      organizationId: ctx.organizationId,
      deletedAt: null,
      ...(input.pipelineId ? { id: input.pipelineId } : {}),
    },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { id: true, stages: { orderBy: { order: "asc" }, select: { id: true } } },
  });
  if (!pipeline) return err("No pipeline is configured — an admin needs to create one first");

  // A supplied stageId must belong to this pipeline, which belongs to this org.
  const stageId = input.stageId ?? pipeline.stages[0]?.id;
  if (!stageId || !pipeline.stages.some((s) => s.id === stageId)) {
    return err("That stage does not belong to this pipeline");
  }

  for (const [field, table] of [
    ["contactId", "contact"],
    ["companyId", "company"],
  ] as const) {
    const id = input[field];
    if (!id) continue;
    const found = await (table === "contact"
      ? db.contact.findFirst({ where: { id, organizationId: ctx.organizationId, deletedAt: null }, select: { id: true } })
      : db.company.findFirst({ where: { id, organizationId: ctx.organizationId, deletedAt: null }, select: { id: true } }));
    if (!found) return err(`That ${table} does not exist`);
  }

  const deal = await db.$transaction(async (tx) => {
    const created = await tx.deal.create({
      data: {
        organizationId: ctx.organizationId,
        title: input.title,
        value: input.value,
        currency: input.currency,
        pipelineId: pipeline.id,
        stageId,
        contactId: input.contactId ?? null,
        companyId: input.companyId ?? null,
        ownerId: input.ownerId ?? ctx.userId,
        expectedCloseDate: input.expectedCloseDate ?? null,
      },
      select: { id: true },
    });
    await writeAudit(tx, ctx, {
      entity: "Deal",
      entityId: created.id,
      action: "create",
      after: { ...input, stageId },
    });
    return created;
  });

  return ok({ id: deal.id });
}

/**
 * Moves a deal to another stage. Writes an audit row and a STAGE_CHANGE
 * activity in the same transaction — a pipeline you cannot explain after the
 * fact is a pipeline nobody trusts.
 */
export async function moveDealToStage(
  ctx: Ctx,
  dealId: string,
  stageId: string,
  lostReason?: string | null,
): Promise<Result<{ id: string }>> {
  requireWrite(ctx);

  const deal = await db.deal.findFirst({
    where: { id: dealId, organizationId: ctx.organizationId, deletedAt: null },
    select: { id: true, pipelineId: true, stageId: true, stage: { select: { name: true } } },
  });
  if (!deal) return err("Deal not found");
  if (deal.stageId === stageId) return ok({ id: dealId });

  // The target stage must belong to this deal's pipeline — which is already
  // proven to be in the caller's org by the query above.
  const stage = await db.stage.findFirst({
    where: { id: stageId, pipelineId: deal.pipelineId },
    select: { id: true, name: true, isWon: true, isLost: true },
  });
  if (!stage) return err("That stage does not belong to this deal's pipeline");

  // "Lost" with no reason is a data point nobody can learn from. Every mature
  // CRM makes this mandatory, and it is the only field that explains a loss.
  const reason = lostReason?.trim() || null;
  if (stage.isLost && !reason) {
    return err("Say why this deal was lost — a loss with no reason teaches nothing");
  }

  await db.$transaction(async (tx) => {
    await tx.deal.update({
      where: { id: dealId },
      data: {
        stageId,
        closedAt: stage.isWon || stage.isLost ? new Date() : null,
        // Resets the days-in-stage clock, which is what makes a rotting deal
        // visible at all.
        stageEnteredAt: new Date(),
        // Cleared when a deal comes back out of a lost stage.
        lostReason: stage.isLost ? reason : null,
      },
    });

    await tx.activity.create({
      data: {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        type: "STAGE_CHANGE",
        subject: `${deal.stage.name} → ${stage.name}`,
        body: stage.isLost ? `Lost: ${reason}` : null,
        dealId,
        occurredAt: new Date(),
      },
    });

    await writeAudit(tx, ctx, {
      entity: "Deal",
      entityId: dealId,
      action: "stage_change",
      before: { stageId: deal.stageId, stageName: deal.stage.name },
      after: { stageId, stageName: stage.name, lostReason: stage.isLost ? reason : null },
    });
  });

  return ok({ id: dealId });
}

export async function updateDeal(
  ctx: Ctx,
  id: string,
  raw: unknown,
): Promise<Result<{ id: string }>> {
  requireWrite(ctx);

  const parsed = dealUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return err("Check the highlighted fields", parsed.error.flatten().fieldErrors);
  }

  // Loaded inside the tenant scope first, so a crafted id is "not found"
  // rather than a silent cross-tenant write.
  const before = await db.deal.findFirst({
    where: { id, organizationId: ctx.organizationId, deletedAt: null },
    select: { id: true, title: true, value: true, currency: true, expectedCloseDate: true, ownerId: true },
  });
  if (!before) return err("Deal not found");

  if (parsed.data.ownerId) {
    const owner = await db.user.findFirst({
      where: { id: parsed.data.ownerId, organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!owner) return err("That person is not on this team");
  }

  await db.$transaction(async (tx) => {
    await tx.deal.update({ where: { id }, data: parsed.data });
    await writeAudit(tx, ctx, {
      entity: "Deal",
      entityId: id,
      action: "update",
      // Decimal is not JSON — stringify before it reaches the audit payload.
      before: { ...before, value: before.value.toString() },
      after: { ...parsed.data, value: parsed.data.value?.toString() },
    });
  });

  return ok({ id });
}

export async function getDeal(ctx: Ctx, id: string) {
  const deal = await db.deal.findFirst({
    where: { id, organizationId: ctx.organizationId, deletedAt: null },
    include: {
      stage: true,
      pipeline: { select: { id: true, name: true, stages: { orderBy: { order: "asc" } } } },
      company: { select: { id: true, name: true } },
      contact: { select: { id: true, firstName: true, lastName: true, email: true } },
      owner: { select: { id: true, name: true, email: true } },
    },
  });
  if (!deal) return null;

  // Reading the clock during a Server Component's render is impure, so the
  // aging figure is computed here where it belongs.
  return {
    ...deal,
    daysInStage: Math.floor((Date.now() - deal.stageEnteredAt.getTime()) / 86_400_000),
  };
}
