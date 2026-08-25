import { db } from "@/lib/db";
import {
  companyCreateSchema,
  companyListFilterSchema,
  companyUpdateSchema,
} from "@/lib/validation/crm";
import { type Ctx, requireWrite } from "@/server/authz";
import { type Result, err, ok } from "@/server/result";
import { writeAudit } from "@/server/services/audit";

export async function listCompanies(ctx: Ctx, rawFilter: unknown) {
  const filter = companyListFilterSchema.parse(rawFilter);

  const where = {
    organizationId: ctx.organizationId,
    deletedAt: null,
    ...(filter.q
      ? {
          OR: [
            { name: { contains: filter.q, mode: "insensitive" as const } },
            { domain: { contains: filter.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    db.company.findMany({
      where,
      orderBy: [
        filter.sort === "domain"
          ? { domain: filter.dir }
          : filter.sort === "industry"
            ? { industry: filter.dir }
            : { name: filter.dir },
        { id: "asc" },
      ],
      skip: (filter.page - 1) * filter.perPage,
      take: filter.perPage,
      select: {
        id: true,
        name: true,
        domain: true,
        industry: true,
        owner: { select: { id: true, name: true, email: true } },
        _count: { select: { contacts: true, deals: true } },
      },
    }),
    db.company.count({ where }),
  ]);

  return { rows, total, page: filter.page, perPage: filter.perPage };
}

export async function getCompany(ctx: Ctx, id: string) {
  return db.company.findFirst({
    where: { id, organizationId: ctx.organizationId, deletedAt: null },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      contacts: {
        where: { deletedAt: null },
        orderBy: { lastName: "asc" },
        select: { id: true, firstName: true, lastName: true, email: true, title: true },
      },
      deals: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          value: true,
          currency: true,
          stage: { select: { name: true, isWon: true, isLost: true } },
        },
      },
    },
  });
}

export async function createCompany(ctx: Ctx, raw: unknown): Promise<Result<{ id: string }>> {
  requireWrite(ctx);

  const parsed = companyCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return err("Check the highlighted fields", parsed.error.flatten().fieldErrors);
  }

  const company = await db.$transaction(async (tx) => {
    const created = await tx.company.create({
      data: {
        organizationId: ctx.organizationId,
        ...parsed.data,
        ownerId: parsed.data.ownerId ?? ctx.userId,
      },
      select: { id: true },
    });
    await writeAudit(tx, ctx, {
      entity: "Company",
      entityId: created.id,
      action: "create",
      after: parsed.data,
    });
    return created;
  });

  return ok({ id: company.id });
}

export async function updateCompany(
  ctx: Ctx,
  id: string,
  raw: unknown,
): Promise<Result<{ id: string }>> {
  requireWrite(ctx);

  const parsed = companyUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return err("Check the highlighted fields", parsed.error.flatten().fieldErrors);
  }

  const before = await db.company.findFirst({
    where: { id, organizationId: ctx.organizationId, deletedAt: null },
  });
  if (!before) return err("Company not found");

  await db.$transaction(async (tx) => {
    await tx.company.update({ where: { id }, data: parsed.data });
    await writeAudit(tx, ctx, {
      entity: "Company",
      entityId: id,
      action: "update",
      before,
      after: parsed.data,
    });
  });

  return ok({ id });
}
