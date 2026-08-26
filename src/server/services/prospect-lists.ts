import { z } from "zod";

import { db } from "@/lib/db";
import { ForbiddenError, type Ctx, hasRole, requireWrite, visibleTo } from "@/server/authz";
import { type Result, err, ok } from "@/server/result";
import { writeAudit } from "@/server/services/audit";
import { resolveSegment } from "@/server/services/segments";

/**
 * Prospect lists — a named working set of contacts and leads for a campaign.
 *
 * A segment is a saved *question* ("leads scoring over 70"); a list is a saved
 * *answer* ("the 240 people I am emailing in Q3"). Materializing it matters:
 * a campaign that re-ran its segment on send day would email a different set
 * of people than the one that was reviewed and approved.
 *
 * Two invariants carry this module:
 *
 * 1. Nothing the caller cannot see may land on a list. Every add loads its
 *    candidates through `organizationId` + `visibleTo(ctx)` first and inserts
 *    only the ids that came back. An id the caller cannot see is SKIPPED, not
 *    an error — a rep pasting 500 ids should not be told "forbidden" because
 *    two of them belong to a colleague — but it never becomes a member.
 * 2. Adding is idempotent. Re-adding someone already on the list is a skip,
 *    never a duplicate and never an error, so a double-clicked button and a
 *    replayed request both leave the same list behind.
 *
 * Schemas live in this file rather than `lib/validation/` — like `tags.ts` and
 * unlike `segments.ts` — because a list has two tiny shapes and no wire format
 * shared with another module.
 */

// ─────────────────────────── validation ───────────────────────────

// Trimmed at the edge so " Q3 push " and "Q3 push" cannot both exist — see the
// case-insensitive uniqueness check below.
export const prospectListNameSchema = z
  .string()
  .trim()
  .min(1, "Give the list a name")
  .max(60, "List names are 60 characters or fewer");

const descriptionSchema = z
  .string()
  .trim()
  .max(500, "Keep the description to 500 characters or fewer");

export const prospectListCreateSchema = z.object({
  name: prospectListNameSchema,
  // An empty string and a missing key both mean "no description".
  description: descriptionSchema.nullish().transform((v) => (v ? v : null)),
});

export const prospectListRenameSchema = z.object({
  name: prospectListNameSchema,
  // Patch semantics: an absent key leaves the stored description alone, since
  // Prisma reads `undefined` as "don't change this column". "" or null clears
  // it. Without the `undefined` branch every rename would wipe the note.
  description: descriptionSchema
    .nullish()
    .transform((v) => (v === undefined ? undefined : v || null)),
});

/** Paging for `listMembers`, `.catch`-ed so a stale bookmark degrades to page 1. */
const memberPageSchema = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  perPage: z.coerce.number().int().min(1).max(100).catch(25),
});

/**
 * How many ids one `addMembers` call accepts.
 *
 * That call is a hand-made selection out of a list view, and the list views in
 * this app page at most 100 rows — 500 is five full pages, comfortably more
 * than anyone ticks by hand, and small enough that the visibility query and
 * the insert behind it stay one round-trip each. The cap counts ids OFFERED,
 * not ids added, so it cannot be dodged by sending 10,000 ids that mostly skip.
 *
 * Anything bigger is a segment's job: `addFromSegment` is the bulk path, and
 * it is bounded separately by `resolveSegment`'s own clamp.
 */
export const MAX_ADD_MEMBERS = 500;

/**
 * Rows per insert statement.
 *
 * Postgres binds one parameter per column per row and refuses a statement with
 * more than 65,535 of them. `addFromSegment` can legitimately arrive with
 * 10,000 ids, which is close enough to that ceiling to be worth chunking
 * rather than discovering in production.
 */
const INSERT_CHUNK = 500;

// ─────────────────────────── internals ───────────────────────────

export type MemberKind = "CONTACT" | "LEAD";

/** Which of the two polymorphic columns a batch is writing. */
type MemberColumn = "contactId" | "leadId";

/**
 * The two polymorphic columns, with an explicit null on the one not in play.
 *
 * The null is load-bearing in a `where`: `@@unique([listId, contactId])` and
 * `@@unique([listId, leadId])` are separate indexes, so "this contact on this
 * list" is only unambiguous when `leadId` is pinned to NULL as well. The same
 * object is the `create` payload. Exactly the shape `tags.ts` uses, with two
 * columns instead of three.
 */
function memberColumns(column: MemberColumn, id: string) {
  return {
    contactId: column === "contactId" ? id : null,
    leadId: column === "leadId" ? id : null,
  };
}

/** A duplicate name, or a lost race on a member — a user outcome, not a 500. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

/**
 * Who may delete a whole list.
 *
 * Deliberately the rule `segments.ts` chose for `deleteSegment`, not
 * `requireDelete`. `requireDelete` exists because destroying a *record* loses
 * customer data a rep must not be able to lose; a prospect list is a saved
 * working set that costs a rebuild, and a rep who assembled their own list has
 * to be able to throw it away. A list someone else owns is team property and
 * takes a manager.
 */
const canManage = (ctx: Ctx, list: { ownerId: string }) =>
  list.ownerId === ctx.userId || hasRole(ctx, "MANAGER");

const LIST_SELECT = {
  id: true,
  name: true,
  description: true,
  ownerId: true,
  createdAt: true,
} as const;

/**
 * A list in the caller's org, or null.
 *
 * Not owner-scoped: `ProspectList` has no `shared` flag, so unlike a segment
 * every list is team property and visible to the whole org. What is *on* the
 * list is still scoped per caller — see `visibleMembers`.
 */
function findList(ctx: Ctx, id: string) {
  return db.prospectList.findFirst({
    where: { id, organizationId: ctx.organizationId }, // tenant scope — non-negotiable
    select: LIST_SELECT,
  });
}

/**
 * Case-insensitive name lookup within the org.
 *
 * `@@unique([organizationId, name])` is a plain Postgres index, so it happily
 * holds both "Q3 push" and "q3 push" — two rows every user reads as one list.
 * This lookup enforces the rule we actually want; the constraint is only the
 * backstop for an exact-case race.
 *
 * Deliberately NOT scoped any further than the org, exactly as in `tags.ts`:
 * the database constraint is not either, so a narrower check would report
 * "available" and then fail on insert.
 */
function findListByName(ctx: Ctx, name: string, excludeId?: string) {
  return db.prospectList.findFirst({
    where: {
      organizationId: ctx.organizationId,
      name: { equals: name, mode: "insensitive" },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, name: true },
  });
}

/**
 * A member row only exists for a caller who can see the record behind it.
 *
 * This is a deliberate divergence from `listTags`, which reports an org-wide
 * usage count to everyone. A tag count is label-management metadata with no
 * paged listing beside it; a prospect list shows its size *next to* the rows,
 * so a count that disagreed with the page underneath it would read as a bug —
 * and the rows themselves carry names and email addresses, which a rep may
 * not see for a colleague's records. So one rule, applied to counting, listing
 * and removing alike: you see, count and act on the members whose record you
 * could open.
 *
 * `deletedAt: null` in the same fragment means a soft-deleted record drops off
 * every list it was on, rather than lingering as a name nobody can open.
 */
function visibleMembers(ctx: Ctx) {
  const scope = { deletedAt: null, ...visibleTo(ctx) };
  return { OR: [{ contact: { is: scope } }, { lead: { is: scope } }] };
}

/**
 * The subset of `ids` that this caller may actually add.
 *
 * The whole of invariant 1 lives in these five lines: tenant scope, soft
 * delete and `visibleTo(ctx)` decide the candidate set, and only what comes
 * back is ever inserted.
 */
async function visibleRecordIds(
  ctx: Ctx,
  column: MemberColumn,
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) return [];

  // Contact and Lead both carry organizationId, ownerId and deletedAt, so one
  // scope fragment serves both.
  const where = {
    id: { in: ids },
    organizationId: ctx.organizationId,
    deletedAt: null,
    ...visibleTo(ctx),
  };

  const rows =
    column === "contactId"
      ? await db.contact.findMany({ where, select: { id: true } })
      : await db.lead.findMany({ where, select: { id: true } });

  return rows.map((row) => row.id);
}

/** Which of `ids` are already on the list, so re-adding them is a skip. */
async function existingMemberIds(
  ctx: Ctx,
  listId: string,
  column: MemberColumn,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();

  const rows = await db.prospectListMember.findMany({
    where: {
      organizationId: ctx.organizationId,
      listId,
      // The other column pinned to null — see `memberColumns`. Without it this
      // reads as "rows for these contacts, whatever their leadId", which is a
      // different question from the one the unique index answers.
      ...(column === "contactId"
        ? { contactId: { in: ids }, leadId: null }
        : { leadId: { in: ids }, contactId: null }),
    },
    select: { contactId: true, leadId: true },
  });

  const present = rows.map((row) => (column === "contactId" ? row.contactId : row.leadId));
  return new Set(present.filter((id): id is string => id !== null));
}

type MemberInsert = {
  organizationId: string;
  listId: string;
  contactId: string | null;
  leadId: string | null;
  addedAt: Date;
};

/**
 * Inserts one chunk and returns how many rows landed.
 *
 * The pre-check above removes the members that are already there, so the happy
 * path is a single `createMany`. The `P2002` catch is the race backstop: if a
 * colleague added one of these people between our read and our write, Postgres
 * rejects the whole statement, and we retry row by row so the ones that are
 * still new get in and the one that raced counts as a skip. The end state is
 * what the caller asked for either way, which is why it is not an error.
 */
async function insertChunk(rows: MemberInsert[]): Promise<number> {
  try {
    const { count } = await db.prospectListMember.createMany({ data: rows });
    return count;
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;

    let added = 0;
    // Sequential, never `Promise.all`: concurrent statements on this pg
    // adapter produce `08P01: bind message supplies N parameters`.
    for (const row of rows) {
      try {
        await db.prospectListMember.create({ data: row, select: { id: true } });
        added += 1;
      } catch (inner) {
        if (!isUniqueViolation(inner)) throw inner;
      }
    }
    return added;
  }
}

/**
 * The one path by which anything becomes a member. Returns how many were added;
 * everything the caller offered and did not get is a skip.
 *
 * Not audited, and not transactional. Following `tags.ts`: membership is
 * high-frequency, low-consequence and reversible, and logging every tick would
 * bury the ownership and deal-value changes the audit trail exists for. The
 * list itself — created, renamed, deleted — is audited.
 */
async function addRecords(
  ctx: Ctx,
  listId: string,
  column: MemberColumn,
  ids: string[],
  now: Date,
): Promise<number> {
  if (ids.length === 0) return 0;

  const visible = await visibleRecordIds(ctx, column, ids);
  if (visible.length === 0) return 0;

  const already = await existingMemberIds(ctx, listId, column, visible);
  const fresh = visible.filter((id) => !already.has(id));
  if (fresh.length === 0) return 0;

  const rows: MemberInsert[] = fresh.map((id) => ({
    organizationId: ctx.organizationId,
    listId,
    // One timestamp for the whole batch rather than per-row `now()`, so
    // everything added by one action sorts together instead of interleaving
    // with a concurrent add by microseconds.
    addedAt: now,
    ...memberColumns(column, id),
  }));

  let added = 0;
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    added += await insertChunk(rows.slice(i, i + INSERT_CHUNK));
  }
  return added;
}

/** Dedupes and drops blanks — the same id twice is one add, not one add and one skip. */
const cleanIds = (ids: string[] | undefined): string[] => [...new Set((ids ?? []).filter(Boolean))];

// ─────────────────────────── list lifecycle ───────────────────────────

/**
 * Every list in the org, with how many members the caller can see.
 *
 * A read, so it returns rows rather than a `Result`.
 */
export async function listProspectLists(ctx: Ctx): Promise<
  Array<{
    id: string;
    name: string;
    description: string | null;
    ownerId: string;
    memberCount: number;
    createdAt: Date;
  }>
> {
  const lists = await db.prospectList.findMany({
    where: { organizationId: ctx.organizationId }, // tenant scope — non-negotiable
    // Stable tiebreak on id, so two lists differing only by case cannot swap
    // places between reads.
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: LIST_SELECT,
  });
  if (lists.length === 0) return [];

  // One grouped query rather than N counts.
  const counts = await db.prospectListMember.groupBy({
    by: ["listId"],
    where: {
      organizationId: ctx.organizationId,
      listId: { in: lists.map((list) => list.id) },
      ...visibleMembers(ctx),
    },
    _count: { _all: true },
  });
  const byList = new Map(counts.map((row) => [row.listId, row._count._all]));

  return lists.map((list) => ({ ...list, memberCount: byList.get(list.id) ?? 0 }));
}

export async function getProspectList(
  ctx: Ctx,
  id: string,
): Promise<
  Result<{
    id: string;
    name: string;
    description: string | null;
    ownerId: string;
    memberCount: number;
  }>
> {
  const list = await findList(ctx, id);
  // "Not found", not "forbidden": another org's id must be indistinguishable
  // from an id that never existed.
  if (!list) return err("Prospect list not found");

  const memberCount = await db.prospectListMember.count({
    where: { organizationId: ctx.organizationId, listId: id, ...visibleMembers(ctx) },
  });

  return ok({
    id: list.id,
    name: list.name,
    description: list.description,
    ownerId: list.ownerId,
    memberCount,
  });
}

export async function createProspectList(ctx: Ctx, raw: unknown): Promise<Result<{ id: string }>> {
  requireWrite(ctx);

  const parsed = prospectListCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return err("Check the highlighted fields", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const clash = await findListByName(ctx, input.name);
  if (clash) return err(`A list called "${clash.name}" already exists`);

  try {
    const list = await db.$transaction(async (tx) => {
      const created = await tx.prospectList.create({
        data: {
          organizationId: ctx.organizationId,
          // From the session, never the payload — otherwise a crafted body
          // could plant a list on someone else's account and hand them the
          // owner-only delete right that comes with it.
          ownerId: ctx.userId,
          name: input.name,
          description: input.description,
        },
        select: { id: true },
      });
      await writeAudit(tx, ctx, {
        entity: "ProspectList",
        entityId: created.id,
        action: "create",
        after: input,
      });
      return created;
    });

    return ok({ id: list.id });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    return err(`A list called "${input.name}" already exists`);
  }
}

/**
 * Renames a list, and optionally re-writes its description.
 *
 * `requireWrite`, not owner-or-manager: a list has no private flag, so it is
 * shared team property from the moment it exists, and fixing a typo in the
 * team's working set is ordinary collaboration. Deleting one is not — see
 * `deleteProspectList`.
 */
export async function renameProspectList(
  ctx: Ctx,
  id: string,
  raw: unknown,
): Promise<Result<{ id: string }>> {
  requireWrite(ctx);

  const parsed = prospectListRenameSchema.safeParse(raw);
  if (!parsed.success) {
    return err("Check the highlighted fields", parsed.error.flatten().fieldErrors);
  }
  const patch = parsed.data;

  // Load inside the tenant scope first: this is what turns a cross-tenant
  // rename attempt into "not found" instead of a silent write.
  const before = await findList(ctx, id);
  if (!before) return err("Prospect list not found");

  // Excluding the list itself, so re-casing your own name ("q3 push" → "Q3
  // push") is allowed rather than colliding with itself.
  const clash = await findListByName(ctx, patch.name, id);
  if (clash) return err(`A list called "${clash.name}" already exists`);

  try {
    await db.$transaction(async (tx) => {
      await tx.prospectList.update({
        where: { id },
        data: { name: patch.name, description: patch.description },
      });
      await writeAudit(tx, ctx, {
        entity: "ProspectList",
        entityId: id,
        action: "rename",
        before,
        after: patch,
      });
    });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    return err(`A list called "${patch.name}" already exists`);
  }

  return ok({ id });
}

/**
 * Deletes a list and, by cascade, its membership rows. The contacts and leads
 * themselves are untouched — a list holds pointers, not people.
 *
 * A campaign that was built from this list keeps its own enrollments; the
 * schema sets `Campaign.listId` to NULL rather than refusing the delete, so
 * history survives losing the working set it came from.
 */
export async function deleteProspectList(ctx: Ctx, id: string): Promise<Result<{ id: string }>> {
  requireWrite(ctx);

  const existing = await findList(ctx, id);
  if (!existing) return err("Prospect list not found");
  if (!canManage(ctx, existing)) {
    throw new ForbiddenError("Only the list's owner or a manager can delete it");
  }

  await db.$transaction(async (tx) => {
    await tx.prospectList.delete({ where: { id } });
    await writeAudit(tx, ctx, {
      entity: "ProspectList",
      entityId: id,
      action: "delete",
      before: existing,
    });
  });

  return ok({ id });
}

// ─────────────────────────── membership ───────────────────────────

type MemberRow = {
  id: string;
  kind: MemberKind;
  recordId: string;
  name: string;
  email: string | null;
  addedAt: Date;
};

/** First and last name if there are any, else whatever else identifies the row. */
function displayName(parts: Array<string | null>, ...fallbacks: Array<string | null>): string {
  const named = parts.filter(Boolean).join(" ").trim();
  if (named) return named;
  return fallbacks.find((value) => Boolean(value)) ?? "Unnamed";
}

/**
 * Enough of each record to render a row, without a second query per member.
 *
 * A row with neither side loaded cannot come back — `visibleMembers` requires
 * one of them to match — but the mapper stays total rather than asserting.
 */
function toMemberRow(row: {
  id: string;
  addedAt: Date;
  contact: { id: string; firstName: string; lastName: string | null; email: string | null } | null;
  lead: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    companyName: string | null;
  } | null;
}): MemberRow | null {
  if (row.contact) {
    return {
      id: row.id,
      kind: "CONTACT",
      recordId: row.contact.id,
      name: displayName([row.contact.firstName, row.contact.lastName], row.contact.email),
      email: row.contact.email,
      addedAt: row.addedAt,
    };
  }
  if (row.lead) {
    return {
      id: row.id,
      kind: "LEAD",
      recordId: row.lead.id,
      // A lead can legitimately arrive with no name at all — a web form with
      // just an email — so the company and the email are the fallbacks.
      name: displayName(
        [row.lead.firstName, row.lead.lastName],
        row.lead.companyName,
        row.lead.email,
      ),
      email: row.lead.email,
      addedAt: row.addedAt,
    };
  }
  return null;
}

/**
 * One page of members, newest addition first.
 *
 * `total` counts the same scoped set the rows come from, so the page count a
 * caller computes from it is the page count they can actually reach.
 */
export async function listMembers(
  ctx: Ctx,
  listId: string,
  opts?: { page?: number; perPage?: number },
): Promise<Result<{ rows: MemberRow[]; total: number; page: number; perPage: number }>> {
  const list = await findList(ctx, listId);
  if (!list) return err("Prospect list not found");

  const { page, perPage } = memberPageSchema.parse(opts ?? {});
  const where = { organizationId: ctx.organizationId, listId, ...visibleMembers(ctx) };

  const [rows, total] = await Promise.all([
    db.prospectListMember.findMany({
      where,
      // Stable tiebreak on id: a whole batch shares one `addedAt`, so without
      // it two rows could swap places between pages and a member be skipped.
      orderBy: [{ addedAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * perPage,
      take: perPage,
      select: {
        id: true,
        addedAt: true,
        contact: { select: { id: true, firstName: true, lastName: true, email: true } },
        lead: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            companyName: true,
          },
        },
      },
    }),
    db.prospectListMember.count({ where }),
  ]);

  return ok({
    rows: rows.map(toMemberRow).filter((row): row is MemberRow => row !== null),
    total,
    page,
    perPage,
  });
}

/**
 * Adds contacts and/or leads to a list.
 *
 * `skipped` is everything offered that did not become a new member: ids
 * already on the list, ids belonging to another tenant, ids of soft-deleted
 * records, ids that never existed, and — the case worth stating — ids of
 * records this caller cannot see. All of them read the same from outside,
 * which is the point: the caller learns how many landed, not which of their
 * colleagues owns what.
 *
 * `now` is injectable so a test can pin `addedAt` rather than race the clock.
 */
export async function addMembers(
  ctx: Ctx,
  listId: string,
  target: { contactIds?: string[]; leadIds?: string[] },
  now: Date = new Date(),
): Promise<Result<{ added: number; skipped: number }>> {
  requireWrite(ctx);

  const list = await findList(ctx, listId);
  if (!list) return err("Prospect list not found");

  const contactIds = cleanIds(target.contactIds);
  const leadIds = cleanIds(target.leadIds);
  const requested = contactIds.length + leadIds.length;

  if (requested === 0) return err("Nothing selected");
  if (requested > MAX_ADD_MEMBERS) {
    return err(
      `Add at most ${MAX_ADD_MEMBERS} at a time — you offered ${requested}. ` +
        "Save the selection as a segment and add from that instead.",
    );
  }

  // Sequential: two writes in flight on this pg adapter is the `08P01` bug.
  const addedContacts = await addRecords(ctx, listId, "contactId", contactIds, now);
  const addedLeads = await addRecords(ctx, listId, "leadId", leadIds, now);
  const added = addedContacts + addedLeads;

  return ok({ added, skipped: requested - added });
}

/**
 * Takes members off a list, by member-row id.
 *
 * `requireWrite`, not `requireDelete`: nothing is destroyed but a pointer, and
 * pruning the working set is the ordinary way to work one. Scoped by
 * `visibleMembers` for the same reason `listMembers` is — a caller can remove
 * exactly the rows the list showed them.
 */
export async function removeMembers(
  ctx: Ctx,
  listId: string,
  memberIds: string[],
): Promise<Result<{ removed: number }>> {
  requireWrite(ctx);

  const list = await findList(ctx, listId);
  if (!list) return err("Prospect list not found");

  const ids = cleanIds(memberIds);
  if (ids.length === 0) return err("Nothing selected");
  if (ids.length > MAX_ADD_MEMBERS) {
    return err(`Remove at most ${MAX_ADD_MEMBERS} at a time — you offered ${ids.length}`);
  }

  // Resolve first, then delete by primary key: the visibility rule is a
  // relation filter, and keeping it in a `findMany` leaves the delete itself a
  // plain, obviously-scoped statement.
  const removable = await db.prospectListMember.findMany({
    where: {
      id: { in: ids },
      organizationId: ctx.organizationId,
      listId,
      ...visibleMembers(ctx),
    },
    select: { id: true },
  });
  if (removable.length === 0) return ok({ removed: 0 });

  const { count } = await db.prospectListMember.deleteMany({
    where: {
      id: { in: removable.map((row) => row.id) },
      organizationId: ctx.organizationId,
      listId,
    },
  });

  return ok({ removed: count });
}

/**
 * Populates a list from a saved segment — the bulk path.
 *
 * `resolveSegment` does the security work: it refuses another org's segment id
 * and a colleague's private one as "not found", and re-scopes the query to
 * THIS caller, so a rep filling a list from an owner's shared segment gets
 * only their own records out of it. `addRecords` then re-checks visibility per
 * id anyway — it is the single chokepoint for invariant 1, and one indexed
 * query is a cheap price for that being true by construction rather than by
 * the caller having remembered.
 *
 * No `MAX_ADD_MEMBERS` cap here: the bound is `resolveSegment`'s own clamp,
 * which is what "bulk" means on this path.
 */
export async function addFromSegment(
  ctx: Ctx,
  listId: string,
  segmentId: string,
  opts?: { limit?: number },
  now: Date = new Date(),
): Promise<Result<{ added: number; skipped: number; entity: MemberKind }>> {
  requireWrite(ctx);

  const list = await findList(ctx, listId);
  if (!list) return err("Prospect list not found");

  const resolved = await resolveSegment(ctx, segmentId, opts);
  if (!resolved.ok) return resolved;

  const { entity, ids } = resolved.data;
  if (entity === "COMPANY") {
    // Refused outright rather than adding nothing: a list holds people to
    // contact, and silently returning `added: 0` would look like an empty
    // segment instead of a segment of the wrong kind.
    return err(
      "A company segment cannot fill a prospect list — a company is not someone you can email. " +
        "Use a contact or lead segment.",
    );
  }

  const added = await addRecords(
    ctx,
    listId,
    entity === "CONTACT" ? "contactId" : "leadId",
    ids,
    now,
  );

  return ok({ added, skipped: ids.length - added, entity });
}
