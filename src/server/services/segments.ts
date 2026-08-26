import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import {
  type CompanyFilter,
  type ContactFilter,
  type LeadFilter,
  type SegmentEntityName,
  type SegmentFilter,
  companyFilterSchema,
  contactFilterSchema,
  leadFilterSchema,
  segmentCreateSchema,
  segmentUpdateSchemaFor,
} from "@/lib/validation/segments";
import { ForbiddenError, type Ctx, hasRole, requireWrite, visibleTo } from "@/server/authz";
import { type Result, err, ok } from "@/server/result";
import { writeAudit } from "@/server/services/audit";

/**
 * Segments — named, saved filters over leads, contacts and companies.
 *
 * Two invariants carry this module, and both are structural rather than
 * conventional:
 *
 * 1. A stored `filter` is a typed document (see `lib/validation/segments.ts`),
 *    never a Prisma `where`. It is validated on the way in and translated to a
 *    `where` in code on the way out, so a saved row can never name an operator
 *    or a column of its own choosing.
 * 2. A segment NARROWS, it never widens. The document's clauses go inside
 *    `AND`; the tenant filter and `visibleTo(ctx)` sit at the top level, where
 *    nothing the document says can reach them. A rep running a shared segment
 *    an owner wrote still sees only their own records.
 */

export type { SegmentEntityName };

/** What `listSegments` and `getSegment` hand back. */
type SegmentSummary = {
  id: string;
  name: string;
  entity: SegmentEntityName;
  shared: boolean;
  ownerId: string;
};

/**
 * Materializing a segment is capped even when the caller says nothing.
 *
 * `resolveSegment` feeds prospect lists and campaigns, where the tempting call
 * is "give me everyone". A segment over a 200k-row table would turn into a
 * 200k-element array in memory and then into an `IN (...)` clause; the cap is
 * what stops a saved filter from becoming an accidental full-table export.
 */
export const RESOLVE_DEFAULT_LIMIT = 1_000;
export const RESOLVE_MAX_LIMIT = 10_000;

// ─────────────────────────── filter → where ───────────────────────────

type WhereClause = Record<string, unknown>;

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

/**
 * ALL-of, not any-of: one `some` sub-query per tag.
 *
 * `taggings: { some: { tagId: { in: [...] } } }` would mean "carries any of
 * these", which reads the same in English and returns a very different list.
 * Segments are used to pick who gets emailed, so the narrow reading wins.
 */
const tagClauses = (tagIds: string[]): WhereClause[] =>
  tagIds.map((tagId) => ({ taggings: { some: { tagId } } }));

/** Tri-state presence: `undefined` never reaches here, so `false` means "blank". */
const presenceClause = (field: "email" | "phone", present: boolean): WhereClause =>
  present ? { [field]: { not: null } } : { [field]: null };

/**
 * "Not touched in N days" includes records never touched at all.
 *
 * `lastActivityAt: null` is the never-contacted case, and excluding it would
 * hide exactly the records a re-engagement segment is looking for.
 */
const staleClause = (days: number): WhereClause => ({
  OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: daysAgo(days) } }],
});

function leadClauses(filter: LeadFilter): WhereClause[] {
  const clauses: WhereClause[] = [];
  if (filter.status) clauses.push({ status: { in: filter.status } });
  if (filter.source) clauses.push({ source: { in: filter.source } });
  if (filter.ownerId) clauses.push({ ownerId: filter.ownerId });
  if (filter.scoreMin !== undefined) clauses.push({ score: { gte: filter.scoreMin } });
  if (filter.scoreMax !== undefined) clauses.push({ score: { lte: filter.scoreMax } });
  if (filter.tagIds) clauses.push(...tagClauses(filter.tagIds));
  if (filter.createdWithinDays !== undefined) {
    clauses.push({ createdAt: { gte: daysAgo(filter.createdWithinDays) } });
  }
  if (filter.noActivityForDays !== undefined) clauses.push(staleClause(filter.noActivityForDays));
  if (filter.hasEmail !== undefined) clauses.push(presenceClause("email", filter.hasEmail));
  if (filter.hasPhone !== undefined) clauses.push(presenceClause("phone", filter.hasPhone));
  return clauses;
}

function contactClauses(filter: ContactFilter): WhereClause[] {
  const clauses: WhereClause[] = [];
  if (filter.ownerId) clauses.push({ ownerId: filter.ownerId });
  if (filter.companyId) clauses.push({ companyId: filter.companyId });
  if (filter.tagIds) clauses.push(...tagClauses(filter.tagIds));
  if (filter.createdWithinDays !== undefined) {
    clauses.push({ createdAt: { gte: daysAgo(filter.createdWithinDays) } });
  }
  if (filter.noActivityForDays !== undefined) clauses.push(staleClause(filter.noActivityForDays));
  if (filter.hasEmail !== undefined) clauses.push(presenceClause("email", filter.hasEmail));
  if (filter.hasPhone !== undefined) clauses.push(presenceClause("phone", filter.hasPhone));
  return clauses;
}

function companyClauses(filter: CompanyFilter): WhereClause[] {
  const clauses: WhereClause[] = [];
  if (filter.ownerId) clauses.push({ ownerId: filter.ownerId });
  if (filter.tagIds) clauses.push(...tagClauses(filter.tagIds));
  if (filter.createdWithinDays !== undefined) {
    clauses.push({ createdAt: { gte: daysAgo(filter.createdWithinDays) } });
  }
  return clauses;
}

function documentClauses(document: SegmentFilter): WhereClause[] {
  switch (document.entity) {
    case "LEAD":
      return leadClauses(document.filter);
    case "CONTACT":
      return contactClauses(document.filter);
    case "COMPANY":
      return companyClauses(document.filter);
  }
}

/**
 * Validates a stored or inbound document against the schema for its entity.
 *
 * Kept separate from `segmentWhere` so a row whose document no longer parses —
 * a filter saved before a field was retired, say — becomes a `Result` error at
 * the service boundary rather than an exception in a list view.
 */
function parseDocument(
  entity: SegmentEntityName,
  raw: unknown,
): { ok: true; document: SegmentFilter } | { ok: false } {
  // A missing document means "everything visible to me", the same as `{}`.
  const value = raw ?? {};
  switch (entity) {
    case "LEAD": {
      const parsed = leadFilterSchema.safeParse(value);
      return parsed.success ? { ok: true, document: { entity, filter: parsed.data } } : { ok: false };
    }
    case "CONTACT": {
      const parsed = contactFilterSchema.safeParse(value);
      return parsed.success ? { ok: true, document: { entity, filter: parsed.data } } : { ok: false };
    }
    case "COMPANY": {
      const parsed = companyFilterSchema.safeParse(value);
      return parsed.success ? { ok: true, document: { entity, filter: parsed.data } } : { ok: false };
    }
  }
}

/**
 * The one place a document becomes a query.
 *
 * The document's clauses are nested under `AND` rather than spread across the
 * top level. That is not a style choice: sibling keys would let a future
 * clause named `organizationId` or `ownerId` *replace* the scope below it,
 * whereas an `AND` member can only ever intersect with it. Tenant, soft-delete
 * and visibility therefore cannot be reached from inside a saved row at all.
 */
function scopedWhere(ctx: Ctx, document: SegmentFilter): WhereClause {
  return {
    AND: documentClauses(document),
    organizationId: ctx.organizationId, // tenant scope — non-negotiable
    deletedAt: null,
    // Last, and outside the document: a rep running an owner's shared segment
    // still sees only their own records.
    ...visibleTo(ctx),
  };
}

/**
 * Translate a validated filter document to a Prisma `where`, tenant- and
 * visibility-scoped.
 *
 * Throws on a document that fails validation, unlike the service functions
 * around it: this is a pure translator, and handing it a document that never
 * passed the schema is a programming error, not a user outcome. Callers
 * holding a stored row should go through `countSegment`/`resolveSegment`,
 * which turn that case into a `Result`.
 */
export function segmentWhere(
  ctx: Ctx,
  entity: SegmentEntityName,
  filter: unknown,
): Record<string, unknown> {
  const parsed = parseDocument(entity, filter);
  if (!parsed.ok) throw new Error(`Not a valid ${entity} segment filter`);
  return scopedWhere(ctx, parsed.document);
}

// ─────────────────────────── entity dispatch ───────────────────────────

/**
 * The casts are contained to these two functions.
 *
 * `WhereClause` is deliberately opaque — it is assembled from a validated
 * document, never from caller input — and re-deriving three `WhereInput` types
 * through the builders above would spread Prisma's generics through every
 * clause helper for no extra safety.
 */
function countRows(entity: SegmentEntityName, where: WhereClause): Promise<number> {
  switch (entity) {
    case "LEAD":
      return db.lead.count({ where: where as Prisma.LeadWhereInput });
    case "CONTACT":
      return db.contact.count({ where: where as Prisma.ContactWhereInput });
    case "COMPANY":
      return db.company.count({ where: where as Prisma.CompanyWhereInput });
  }
}

async function findRowIds(
  entity: SegmentEntityName,
  where: WhereClause,
  take: number,
): Promise<string[]> {
  // Newest first with a stable tiebreak, so two reads of the same segment
  // under a limit return the same page rather than a reshuffled one.
  const orderBy = [{ createdAt: "desc" as const }, { id: "asc" as const }];
  const select = { id: true } as const;

  switch (entity) {
    case "LEAD": {
      const rows = await db.lead.findMany({ where: where as Prisma.LeadWhereInput, orderBy, take, select });
      return rows.map((row) => row.id);
    }
    case "CONTACT": {
      const rows = await db.contact.findMany({ where: where as Prisma.ContactWhereInput, orderBy, take, select });
      return rows.map((row) => row.id);
    }
    case "COMPANY": {
      const rows = await db.company.findMany({ where: where as Prisma.CompanyWhereInput, orderBy, take, select });
      return rows.map((row) => row.id);
    }
  }
}

// ─────────────────────────── segment row access ───────────────────────────

const SUMMARY_SELECT = {
  id: true,
  name: true,
  entity: true,
  shared: true,
  ownerId: true,
} as const;

/**
 * Which segments the caller may see at all.
 *
 * Shared segments belong to the org — a rep is meant to run the team's saved
 * views, which is safe precisely because `scopedWhere` re-applies visibility
 * to the records. A private segment is visible to its owner alone, whatever
 * the role: a manager can already see every *record*, and a colleague's
 * half-finished draft view is not a record.
 */
function visibleSegments(ctx: Ctx) {
  return {
    organizationId: ctx.organizationId,
    OR: [{ shared: true }, { ownerId: ctx.userId }],
  };
}

function findSegment(ctx: Ctx, id: string) {
  return db.segment.findFirst({
    where: { id, ...visibleSegments(ctx) },
    select: { ...SUMMARY_SELECT, filter: true },
  });
}

/**
 * Case-insensitive name lookup within (org, entity).
 *
 * `@@unique([organizationId, entity, name])` is a plain Postgres index, so it
 * happily holds both "Hot leads" and "hot leads" — two rows a user reads as
 * one segment. This lookup enforces the rule we actually want; the constraint
 * is only the backstop for an exact-case race.
 *
 * Deliberately NOT scoped by `visibleSegments`: the database constraint is not
 * either, so a check that skipped a colleague's private segment would report
 * "available" and then fail on insert.
 */
function findSegmentByName(
  ctx: Ctx,
  entity: SegmentEntityName,
  name: string,
  excludeId?: string,
) {
  return db.segment.findFirst({
    where: {
      organizationId: ctx.organizationId,
      entity,
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

/**
 * Who may edit or delete a segment.
 *
 * Not `requireDelete`: that rule exists because deleting a *record* destroys
 * customer data a rep should not be able to lose. A segment is a saved view —
 * removing one costs a click to rebuild — so a rep tidying up their own is
 * fine, while a shared one is team property and takes a manager.
 */
const canManage = (ctx: Ctx, segment: { ownerId: string }) =>
  segment.ownerId === ctx.userId || hasRole(ctx, "MANAGER");

// ─────────────────────────── segment lifecycle ───────────────────────────

/**
 * The segments the caller can run, optionally for one entity.
 *
 * A read, so it returns rows rather than a `Result` — and it never includes
 * another user's private segment.
 */
export async function listSegments(
  ctx: Ctx,
  entity?: SegmentEntityName,
): Promise<SegmentSummary[]> {
  return db.segment.findMany({
    where: { ...visibleSegments(ctx), ...(entity ? { entity } : {}) },
    // Stable tiebreak on id, so two segments differing only by case cannot
    // swap places between reads.
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: SUMMARY_SELECT,
  });
}

export async function getSegment(
  ctx: Ctx,
  id: string,
): Promise<Result<SegmentSummary & { filter: unknown }>> {
  const segment = await findSegment(ctx, id);
  // "Not found", not "forbidden": another org's id and a colleague's private
  // segment must be indistinguishable from an id that never existed.
  if (!segment) return err("Segment not found");
  return ok(segment);
}

export async function createSegment(ctx: Ctx, raw: unknown): Promise<Result<{ id: string }>> {
  requireWrite(ctx);

  const parsed = segmentCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return err("Check the highlighted fields", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const clash = await findSegmentByName(ctx, input.entity, input.name);
  if (clash) return err(`A segment called "${clash.name}" already exists`);

  try {
    const segment = await db.$transaction(async (tx) => {
      const created = await tx.segment.create({
        data: {
          organizationId: ctx.organizationId,
          // From the session, never the payload — otherwise a crafted body
          // could plant a private segment on someone else's account.
          ownerId: ctx.userId,
          name: input.name,
          entity: input.entity,
          shared: input.shared,
          filter: input.filter as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      await writeAudit(tx, ctx, {
        entity: "Segment",
        entityId: created.id,
        action: "create",
        after: input,
      });
      return created;
    });

    return ok({ id: segment.id });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    return err(`A segment called "${input.name}" already exists`);
  }
}

/**
 * Edits name, sharing and filter. `entity` is fixed at creation — see
 * `segmentUpdateSchemaFor`.
 */
export async function updateSegment(
  ctx: Ctx,
  id: string,
  raw: unknown,
): Promise<Result<{ id: string }>> {
  requireWrite(ctx);

  // Load inside the visibility scope first: this is what turns a cross-tenant
  // edit attempt into 'not found' instead of a silent write.
  const before = await findSegment(ctx, id);
  if (!before) return err("Segment not found");
  if (!canManage(ctx, before)) {
    throw new ForbiddenError("Only the segment's owner or a manager can change it");
  }

  // The stored entity decides which filter schema applies — the payload does
  // not get a say, or it could smuggle a lead filter onto a company segment.
  const parsed = segmentUpdateSchemaFor(before.entity).safeParse(raw);
  if (!parsed.success) {
    return err("Check the highlighted fields", parsed.error.flatten().fieldErrors);
  }
  const patch = parsed.data;

  if (patch.name) {
    // Excluding the segment itself so re-casing your own name is allowed
    // rather than colliding with itself.
    const clash = await findSegmentByName(ctx, before.entity, patch.name, id);
    if (clash) return err(`A segment called "${clash.name}" already exists`);
  }

  try {
    await db.$transaction(async (tx) => {
      await tx.segment.update({
        where: { id },
        data: {
          // Prisma reads `undefined` as "leave this column alone", which is
          // exactly patch semantics. `filter` is a non-nullable Json column,
          // so clearing it means saving `{}`, never `Prisma.DbNull`.
          name: patch.name,
          shared: patch.shared,
          filter: patch.filter as Prisma.InputJsonValue | undefined,
        },
      });
      await writeAudit(tx, ctx, {
        entity: "Segment",
        entityId: id,
        action: "update",
        before,
        after: patch,
      });
    });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    return err(`A segment called "${patch.name}" already exists`);
  }

  return ok({ id });
}

export async function deleteSegment(ctx: Ctx, id: string): Promise<Result<{ id: string }>> {
  requireWrite(ctx);

  const existing = await findSegment(ctx, id);
  if (!existing) return err("Segment not found");
  if (!canManage(ctx, existing)) {
    throw new ForbiddenError("Only the segment's owner or a manager can delete it");
  }

  await db.$transaction(async (tx) => {
    await tx.segment.delete({ where: { id } });
    await writeAudit(tx, ctx, {
      entity: "Segment",
      entityId: id,
      action: "delete",
      before: existing,
    });
  });

  return ok({ id });
}

// ─────────────────────────── running a segment ───────────────────────────

/**
 * Loads a segment and turns it into a query the caller is allowed to run.
 *
 * Both halves matter: the row has to be visible to the caller (tenant +
 * private-segment rule), and the `where` it produces is re-scoped to the
 * caller, not to whoever saved it.
 */
async function loadRunnable(
  ctx: Ctx,
  segmentId: string,
): Promise<Result<{ entity: SegmentEntityName; where: WhereClause }>> {
  const segment = await findSegment(ctx, segmentId);
  if (!segment) return err("Segment not found");

  const parsed = parseDocument(segment.entity, segment.filter);
  // A stored document that no longer parses is not a crash: the schema may
  // have moved on since it was saved, and the fix is to open and re-save it.
  if (!parsed.ok) return err("This segment's filter is no longer valid — edit and save it again");

  return ok({ entity: segment.entity, where: scopedWhere(ctx, parsed.document) });
}

/**
 * A stored segment as a `where`, for a list view that wants to run one.
 *
 * `entity` is checked rather than trusted: a lead list handed a CONTACT
 * segment would otherwise build a query against the wrong table and fail deep
 * inside Prisma with a message nobody can act on.
 *
 * The result is already tenant- and visibility-scoped, so a caller composes it
 * with `AND` and never spreads it — spreading would let its keys overwrite the
 * scope on the clause it is merged into.
 */
export async function segmentWhereById(
  ctx: Ctx,
  segmentId: string,
  expected: SegmentEntityName,
): Promise<Result<WhereClause>> {
  const runnable = await loadRunnable(ctx, segmentId);
  if (!runnable.ok) return runnable;
  if (runnable.data.entity !== expected) return err("That segment is for a different record type");

  return ok(runnable.data.where);
}

/** Count of matching records, for showing "412 leads" beside a segment name. */
export async function countSegment(ctx: Ctx, id: string): Promise<Result<number>> {
  const runnable = await loadRunnable(ctx, id);
  if (!runnable.ok) return runnable;

  return ok(await countRows(runnable.data.entity, runnable.data.where));
}

/**
 * Materialize a segment to record ids — used by prospect lists and campaigns.
 *
 * `limit` is mandatory-with-a-default and capped, so a segment over 200k rows
 * cannot be turned into an unbounded id array. An out-of-range limit is
 * clamped rather than refused: the caller here is our own code, and silently
 * returning the largest safe page beats failing a campaign build.
 */
export async function resolveSegment(
  ctx: Ctx,
  segmentId: string,
  opts?: { limit?: number },
): Promise<Result<{ entity: SegmentEntityName; ids: string[] }>> {
  const runnable = await loadRunnable(ctx, segmentId);
  if (!runnable.ok) return runnable;

  const requested = opts?.limit;
  const limit =
    typeof requested === "number" && Number.isFinite(requested)
      ? Math.min(Math.max(Math.floor(requested), 1), RESOLVE_MAX_LIMIT)
      : RESOLVE_DEFAULT_LIMIT;

  const ids = await findRowIds(runnable.data.entity, runnable.data.where, limit);
  return ok({ entity: runnable.data.entity, ids });
}
