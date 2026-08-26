import { db } from "@/lib/db";
import { activityCreateSchema } from "@/lib/validation/crm";
import { type Ctx, requireWrite, visibleTo } from "@/server/authz";
import { type Result, err, ok } from "@/server/result";

/** The record types an activity can hang off. Exactly one is set. */
const LINKS = ["contactId", "companyId", "dealId", "leadId"] as const;

/**
 * Logs a call, email, meeting, or note against exactly one record.
 *
 * The linked record is re-read inside the caller's tenant scope before the
 * write — otherwise a crafted id would attach a note to another org's contact,
 * which is a write across the tenant boundary even though it creates a row we
 * own.
 */
export async function logActivity(ctx: Ctx, raw: unknown): Promise<Result<{ id: string }>> {
  requireWrite(ctx);

  const parsed = activityCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return err("Check the highlighted fields", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const set = LINKS.filter((k) => input[k]);
  if (set.length !== 1) {
    return err("An activity must be attached to exactly one record");
  }

  // Visibility as well as tenancy: logging a call against a record you cannot
  // see would let a rep write into another rep's timeline.
  const scope = { organizationId: ctx.organizationId, deletedAt: null, ...visibleTo(ctx) };
  const exists =
    (input.contactId && (await db.contact.findFirst({ where: { id: input.contactId, ...scope }, select: { id: true } }))) ||
    (input.companyId && (await db.company.findFirst({ where: { id: input.companyId, ...scope }, select: { id: true } }))) ||
    (input.dealId && (await db.deal.findFirst({ where: { id: input.dealId, ...scope }, select: { id: true } }))) ||
    (input.leadId && (await db.lead.findFirst({ where: { id: input.leadId, ...scope }, select: { id: true } })));

  if (!exists) return err("That record does not exist");

  const occurredAt = input.occurredAt ?? new Date();

  const activity = await db.$transaction(async (tx) => {
    const created = await tx.activity.create({
      data: {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        type: input.type,
        durationMinutes: input.durationMinutes ?? null,
        outcome: input.outcome ?? null,
        subject: input.subject,
        body: input.body,
        occurredAt,
        contactId: input.contactId ?? null,
        companyId: input.companyId ?? null,
        dealId: input.dealId ?? null,
        leadId: input.leadId ?? null,
      },
      select: { id: true },
    });

    // Derived recency, kept current here so "not touched in 30 days" is one
    // indexed scan rather than a join against every activity. Only moves
    // forward — backdating an old call must not make a record look fresher.
    if (input.contactId) {
      await tx.contact.updateMany({
        where: {
          id: input.contactId,
          organizationId: ctx.organizationId,
          OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: occurredAt } }],
        },
        data: { lastActivityAt: occurredAt },
      });
    }
    if (input.companyId) {
      await tx.company.updateMany({
        where: {
          id: input.companyId,
          organizationId: ctx.organizationId,
          OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: occurredAt } }],
        },
        data: { lastActivityAt: occurredAt },
      });
    }
    if (input.leadId) {
      await tx.lead.updateMany({
        where: {
          id: input.leadId,
          organizationId: ctx.organizationId,
          OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: occurredAt } }],
        },
        data: { lastActivityAt: occurredAt },
      });
    }

    return created;
  });

  return ok({ id: activity.id });
}

export async function listActivities(
  ctx: Ctx,
  link: { contactId?: string; companyId?: string; dealId?: string; leadId?: string },
  limit = 50,
) {
  return db.activity.findMany({
    where: { organizationId: ctx.organizationId, ...link },
    orderBy: { occurredAt: "desc" },
    take: limit,
    select: {
      id: true,
      type: true,
      subject: true,
      body: true,
      occurredAt: true,
      user: { select: { name: true, email: true } },
    },
  });
}
