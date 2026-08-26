import { z } from "zod";

import { TagColour } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { type Ctx, requireDelete, requireWrite, visibleTo } from "@/server/authz";
import { type Result, err, ok } from "@/server/result";
import { writeAudit } from "@/server/services/audit";

/**
 * Tagging — org-scoped labels and the join rows that attach them to records.
 *
 * Schemas live in this file rather than `lib/validation/` because a tag has
 * exactly one consumer and three tiny shapes; splitting them out would add a
 * module without adding a boundary.
 */

// ─────────────────────────── validation ───────────────────────────

// Trimmed at the edge so " Enterprise " and "Enterprise" cannot both exist —
// invisible whitespace is not a meaningful difference between two labels.
export const tagNameSchema = z
  .string()
  .trim()
  .min(1, "Give the tag a name")
  .max(40, "Tag names are 40 characters or fewer");

// The enum, not a hex string: a tag can only ever be one of the nine validated
// pairs in the design system.
export const tagColourSchema = z.enum(TagColour);

export const tagCreateSchema = z.object({
  name: tagNameSchema,
  colour: tagColourSchema.default("GRAY"),
});

export const tagRenameSchema = z.object({ name: tagNameSchema });

/**
 * A tagging points at exactly one record.
 *
 * `.strict()` on each member is what enforces "exactly one" — a payload
 * carrying both `contactId` and `leadId` matches no member and is rejected,
 * rather than quietly taking whichever branch is checked first.
 */
export const tagTargetSchema = z.union([
  z.object({ contactId: z.string().cuid() }).strict(),
  z.object({ companyId: z.string().cuid() }).strict(),
  z.object({ leadId: z.string().cuid() }).strict(),
]);

export type TagTarget = z.infer<typeof tagTargetSchema>;
export type TagCreateInput = z.infer<typeof tagCreateSchema>;

// ─────────────────────────── internals ───────────────────────────

type TargetKey = "contactId" | "companyId" | "leadId";
type ResolvedTarget = { key: TargetKey; id: string };

/**
 * The three polymorphic columns, with explicit nulls on the two that are not
 * in play.
 *
 * The nulls matter in a `where`: `@@unique([tagId, contactId])` and its two
 * siblings are separate indexes, so "this tag on this contact" is only
 * unambiguous when the other two columns are pinned to NULL. The same object
 * is the `create` payload.
 */
function targetColumns(target: ResolvedTarget) {
  return {
    contactId: target.key === "contactId" ? target.id : null,
    companyId: target.key === "companyId" ? target.id : null,
    leadId: target.key === "leadId" ? target.id : null,
  };
}

/**
 * Loads the record a caller wants to tag, inside the tenant scope AND inside
 * their record-level visibility.
 *
 * Both halves are load-bearing. Without the tenant filter a crafted id would
 * hang another org's tag on this org's record; without `visibleTo` a rep could
 * tag — and so learn of the existence of — a colleague's record they cannot
 * open. Companies are read without owner-scoping elsewhere because they are
 * shared context, but *writing* to one is owner-scoped (see
 * `services/companies.ts`), and a tagging is a write.
 */
async function resolveTarget(ctx: Ctx, raw: unknown): Promise<Result<ResolvedTarget>> {
  const parsed = tagTargetSchema.safeParse(raw);
  if (!parsed.success) return err("Tag exactly one contact, company or lead");
  const target = parsed.data;

  // Every one of the three carries organizationId, ownerId and deletedAt, so
  // one scope fragment serves all of them.
  const scope = { organizationId: ctx.organizationId, deletedAt: null, ...visibleTo(ctx) };

  if ("contactId" in target) {
    const row = await db.contact.findFirst({
      where: { id: target.contactId, ...scope },
      select: { id: true },
    });
    return row ? ok({ key: "contactId", id: row.id }) : err("That record does not exist");
  }

  if ("companyId" in target) {
    const row = await db.company.findFirst({
      where: { id: target.companyId, ...scope },
      select: { id: true },
    });
    return row ? ok({ key: "companyId", id: row.id }) : err("That record does not exist");
  }

  const row = await db.lead.findFirst({
    where: { id: target.leadId, ...scope },
    select: { id: true },
  });
  return row ? ok({ key: "leadId", id: row.id }) : err("That record does not exist");
}

/** A tag the caller's org owns, or null. Not owner-scoped — tags are shared. */
function findTag(ctx: Ctx, tagId: string) {
  return db.tag.findFirst({
    where: { id: tagId, organizationId: ctx.organizationId },
    select: { id: true, name: true, colour: true },
  });
}

/**
 * Case-insensitive name lookup.
 *
 * `@@unique([organizationId, name])` is a plain Postgres index, so it treats
 * "Enterprise" and "enterprise" as different values. This lookup is what
 * actually enforces the rule we want; the constraint is only the backstop for
 * an exact-case race.
 */
function findTagByName(ctx: Ctx, name: string, excludeId?: string) {
  return db.tag.findFirst({
    where: {
      organizationId: ctx.organizationId,
      name: { equals: name, mode: "insensitive" },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, name: true },
  });
}

/** A duplicate name is a user-facing outcome, not a 500 with a Prisma stack. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

// ─────────────────────────── tag lifecycle ───────────────────────────

/**
 * Every tag in the org with how many records carry it.
 *
 * The count is org-wide even for a REP: this is the label-management view, and
 * a rep seeing "3" without seeing which three is not a leak, while a count
 * filtered per-viewer would make two people disagree about whether a tag is
 * safe to delete.
 */
export async function listTags(ctx: Ctx) {
  const rows = await db.tag.findMany({
    where: { organizationId: ctx.organizationId }, // tenant scope — non-negotiable
    // Stable tiebreak on id, so two tags differing only by case cannot swap
    // places between reads.
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      colour: true,
      createdAt: true,
      _count: { select: { taggings: true } },
    },
  });

  return rows.map(({ _count, ...tag }) => ({ ...tag, usageCount: _count.taggings }));
}

export async function createTag(ctx: Ctx, raw: unknown): Promise<Result<{ id: string }>> {
  requireWrite(ctx);

  const parsed = tagCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return err("Check the highlighted fields", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const clash = await findTagByName(ctx, input.name);
  if (clash) return err(`A tag called "${clash.name}" already exists`);

  try {
    const tag = await db.$transaction(async (tx) => {
      const created = await tx.tag.create({
        data: {
          organizationId: ctx.organizationId,
          name: input.name,
          colour: input.colour,
        },
        select: { id: true },
      });
      await writeAudit(tx, ctx, {
        entity: "Tag",
        entityId: created.id,
        action: "create",
        after: input,
      });
      return created;
    });

    return ok({ id: tag.id });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    return err(`A tag called "${input.name}" already exists`);
  }
}

export async function renameTag(
  ctx: Ctx,
  tagId: string,
  raw: unknown,
): Promise<Result<{ id: string }>> {
  requireWrite(ctx);

  const parsed = tagRenameSchema.safeParse(raw);
  if (!parsed.success) {
    return err("Check the highlighted fields", parsed.error.flatten().fieldErrors);
  }
  const { name } = parsed.data;

  // Load inside the tenant scope first: this is what turns a cross-tenant
  // rename attempt into a 'not found' instead of a silent write.
  const before = await findTag(ctx, tagId);
  if (!before) return err("Tag not found");

  // Excluding the tag itself so re-casing your own tag ("enterprise" →
  // "Enterprise") is allowed rather than colliding with itself.
  const clash = await findTagByName(ctx, name, tagId);
  if (clash) return err(`A tag called "${clash.name}" already exists`);

  try {
    await db.$transaction(async (tx) => {
      await tx.tag.update({ where: { id: tagId }, data: { name } });
      await writeAudit(tx, ctx, {
        entity: "Tag",
        entityId: tagId,
        action: "rename",
        before,
        after: { name },
      });
    });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    return err(`A tag called "${name}" already exists`);
  }

  return ok({ id: tagId });
}

export async function setTagColour(
  ctx: Ctx,
  tagId: string,
  colour: unknown,
): Promise<Result<{ id: string }>> {
  requireWrite(ctx);

  const parsed = tagColourSchema.safeParse(colour);
  if (!parsed.success) return err("That is not a colour a tag can be");

  const before = await findTag(ctx, tagId);
  if (!before) return err("Tag not found");

  await db.$transaction(async (tx) => {
    await tx.tag.update({ where: { id: tagId }, data: { colour: parsed.data } });
    await writeAudit(tx, ctx, {
      entity: "Tag",
      entityId: tagId,
      action: "recolour",
      before,
      after: { colour: parsed.data },
    });
  });

  return ok({ id: tagId });
}

/**
 * Deletes a tag outright.
 *
 * MANAGER-and-above, like every other delete: a tag is shared vocabulary, and
 * a rep removing one takes it off every colleague's records at once.
 *
 * This is a hard delete, and `Tagging.tag` cascades — so removing the tag
 * removes every tagging that used it. That IS the intent: a tag with no name
 * left is not a label anyone can act on, and leaving orphaned join rows behind
 * would show as blank chips on records forever. The records themselves are
 * untouched.
 */
export async function deleteTag(ctx: Ctx, tagId: string): Promise<Result<{ id: string }>> {
  requireDelete(ctx);

  const existing = await findTag(ctx, tagId);
  if (!existing) return err("Tag not found");

  await db.$transaction(async (tx) => {
    await tx.tag.delete({ where: { id: tagId } });
    await writeAudit(tx, ctx, {
      entity: "Tag",
      entityId: tagId,
      action: "delete",
      before: existing,
    });
  });

  return ok({ id: tagId });
}

// ─────────────────────────── applying tags ───────────────────────────

/**
 * Attaches a tag to one record.
 *
 * Two independent checks, both required: the tag must belong to the caller's
 * org, and the target must be visible to the caller. Checking only the tag
 * would let a rep hang a legitimate tag on a record they cannot see; checking
 * only the record would let a crafted tag id pull in another tenant's label.
 *
 * Applying a tag that is already there is a silent no-op — a user clicking the
 * same chip twice has got what they asked for, and an error would be noise.
 * `applied` reports which happened for callers that care.
 *
 * Deliberately not audited: taggings are high-frequency, low-consequence and
 * reversible, and logging every chip click would bury the ownership and
 * deal-value changes the audit trail exists for.
 */
export async function applyTag(
  ctx: Ctx,
  tagId: string,
  target: unknown,
): Promise<Result<{ applied: boolean }>> {
  requireWrite(ctx);

  const tag = await findTag(ctx, tagId);
  if (!tag) return err("Tag not found");

  const resolved = await resolveTarget(ctx, target);
  if (!resolved.ok) return resolved;

  const columns = targetColumns(resolved.data);
  const where = { organizationId: ctx.organizationId, tagId, ...columns };

  const existing = await db.tagging.findFirst({ where, select: { id: true } });
  if (existing) return ok({ applied: false });

  try {
    await db.tagging.create({
      data: { organizationId: ctx.organizationId, tagId, ...columns },
      select: { id: true },
    });
  } catch (e) {
    // Lost a race with a concurrent apply. The end state is what was asked
    // for, so this is still a no-op rather than an error.
    if (!isUniqueViolation(e)) throw e;
    return ok({ applied: false });
  }

  return ok({ applied: true });
}

/**
 * Takes a tag off one record.
 *
 * `requireWrite`, not `requireDelete`: removing a label is part of working a
 * record, and nothing is destroyed but the join row. Same two checks as
 * `applyTag`, for the same reasons.
 */
export async function removeTag(
  ctx: Ctx,
  tagId: string,
  target: unknown,
): Promise<Result<{ removed: boolean }>> {
  requireWrite(ctx);

  const tag = await findTag(ctx, tagId);
  if (!tag) return err("Tag not found");

  const resolved = await resolveTarget(ctx, target);
  if (!resolved.ok) return resolved;

  // deleteMany rather than delete: the tenant filter stays in the `where`,
  // and removing a tag that was never there is a no-op, not a crash.
  const { count } = await db.tagging.deleteMany({
    where: { organizationId: ctx.organizationId, tagId, ...targetColumns(resolved.data) },
  });

  return ok({ removed: count > 0 });
}

/**
 * The tags on one record.
 *
 * A read, so it returns rows rather than a `Result` — and a record the caller
 * may not see reads as 'no tags' rather than forbidden, the same way
 * `getContact` returns null: confirming the record exists is itself a leak.
 */
export async function tagsFor(ctx: Ctx, target: unknown) {
  const resolved = await resolveTarget(ctx, target);
  if (!resolved.ok) return [];

  const rows = await db.tagging.findMany({
    where: { organizationId: ctx.organizationId, ...targetColumns(resolved.data) },
    orderBy: [{ tag: { name: "asc" } }, { tagId: "asc" }],
    select: { tag: { select: { id: true, name: true, colour: true } } },
  });

  return rows.map((row) => row.tag);
}
