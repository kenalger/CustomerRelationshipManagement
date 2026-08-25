import { db } from "@/lib/db";
import {
  contactCreateSchema,
  contactListFilterSchema,
  contactUpdateSchema,
} from "@/lib/validation/crm";
import { type Ctx, requireDelete, requireWrite, seesAllRecords, visibleTo } from "@/server/authz";
import { type Result, err, ok } from "@/server/result";
import { writeAudit } from "@/server/services/audit";

/**
 * A REP may only create records owned by themselves.
 *
 * Both create paths accepted a client-supplied `ownerId`. Combined with
 * record-level visibility that is worse than it looks: a rep could create a
 * record owned by a colleague and then immediately lose the ability to see it.
 */
function resolveOwner(ctx: Ctx, requested: string | null | undefined): string {
  if (!requested || !seesAllRecords(ctx)) return ctx.userId;
  return requested;
}

export async function listContacts(ctx: Ctx, rawFilter: unknown) {
  const filter = contactListFilterSchema.parse(rawFilter);

  const where = {
    organizationId: ctx.organizationId, // tenant scope — non-negotiable
    deletedAt: null,
    ...(filter.ownerId ? { ownerId: filter.ownerId } : {}),
    ...(filter.q
      ? {
          OR: [
            { firstName: { contains: filter.q, mode: "insensitive" as const } },
            { lastName: { contains: filter.q, mode: "insensitive" as const } },
            { email: { contains: filter.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
    // Visibility last: a rep passing someone else's ownerId in the filter
    // cannot widen what they see past their own records.
    ...visibleTo(ctx),
  };

  const [rows, total] = await Promise.all([
    db.contact.findMany({
      where,
      // A stable tiebreak on id: without one, two rows with the same sort key
      // can swap places between pages and a record is silently skipped.
      orderBy: [
        filter.sort === "lastName"
          ? { lastName: filter.dir }
          : filter.sort === "email"
            ? { email: filter.dir }
            : { createdAt: filter.dir },
        { id: "asc" },
      ],
      skip: (filter.page - 1) * filter.perPage,
      take: filter.perPage,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        title: true,
        createdAt: true,
        company: { select: { id: true, name: true } },
        owner: { select: { id: true, name: true, email: true } },
      },
    }),
    db.contact.count({ where }),
  ]);

  return { rows, total, page: filter.page, perPage: filter.perPage };
}

export async function getContact(ctx: Ctx, id: string) {
  // A record the caller may not see reads as 'not found' rather than
  // forbidden — telling them it exists is itself a leak.
  return db.contact.findFirst({
    where: { id, organizationId: ctx.organizationId, deletedAt: null, ...visibleTo(ctx) },
    include: {
      company: { select: { id: true, name: true } },
      owner: { select: { id: true, name: true, email: true } },
      deals: {
        where: { deletedAt: null },
        select: {
          id: true,
          title: true,
          value: true,
          currency: true,
          stage: { select: { name: true, isWon: true, isLost: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
}

export async function createContact(ctx: Ctx, raw: unknown): Promise<Result<{ id: string }>> {
  requireWrite(ctx);

  const parsed = contactCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return err("Check the highlighted fields", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  // A supplied companyId must belong to the caller's org — otherwise a crafted
  // id would link this contact to another tenant's company.
  if (input.companyId) {
    const company = await db.company.findFirst({
      where: { id: input.companyId, organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!company) return err("That company does not exist");
  }

  const contact = await db.$transaction(async (tx) => {
    const created = await tx.contact.create({
      data: {
        organizationId: ctx.organizationId,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        title: input.title,
        companyId: input.companyId ?? null,
        ownerId: resolveOwner(ctx, input.ownerId),
      },
      select: { id: true },
    });
    await writeAudit(tx, ctx, {
      entity: "Contact",
      entityId: created.id,
      action: "create",
      after: input,
    });
    return created;
  });

  return ok({ id: contact.id });
}

export async function updateContact(
  ctx: Ctx,
  id: string,
  raw: unknown,
): Promise<Result<{ id: string }>> {
  requireWrite(ctx);

  const parsed = contactUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return err("Check the highlighted fields", parsed.error.flatten().fieldErrors);
  }

  // Load inside the tenant scope first: this is what turns a cross-tenant
  // update attempt into a 'not found' instead of a silent write.
  const before = await db.contact.findFirst({
    where: { id, organizationId: ctx.organizationId, deletedAt: null, ...visibleTo(ctx) },
  });
  if (!before) return err("Contact not found");

  await db.$transaction(async (tx) => {
    await tx.contact.update({ where: { id }, data: parsed.data });
    await writeAudit(tx, ctx, {
      entity: "Contact",
      entityId: id,
      action: "update",
      before,
      after: parsed.data,
    });
  });

  return ok({ id });
}

export async function softDeleteContact(ctx: Ctx, id: string): Promise<Result<{ id: string }>> {
  // Deleting is MANAGER-and-above, not a rep action.
  requireDelete(ctx);

  const existing = await db.contact.findFirst({
    where: { id, organizationId: ctx.organizationId, deletedAt: null, ...visibleTo(ctx) },
    select: { id: true },
  });
  if (!existing) return err("Contact not found");

  await db.$transaction(async (tx) => {
    await tx.contact.update({ where: { id }, data: { deletedAt: new Date() } });
    await writeAudit(tx, ctx, { entity: "Contact", entityId: id, action: "delete" });
  });

  return ok({ id });
}
