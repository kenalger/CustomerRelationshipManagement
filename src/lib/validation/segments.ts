import { z } from "zod";

import { LeadSource, LeadStatus, SegmentEntity } from "@/generated/prisma/enums";

/**
 * The filter document a Segment stores.
 *
 * The single rule this module exists to enforce: a saved segment is a *typed
 * document*, never a Prisma `where`. A stored row is attacker-adjacent data —
 * it outlives the session that wrote it and is read back by whoever runs the
 * segment. If the row could name Prisma operators directly, a crafted `filter`
 * would dictate the query and walk straight past `visibleTo(ctx)`. So the
 * vocabulary is closed here, and `segmentWhere` translates it in code.
 *
 * These schemas live in `lib/validation/` rather than beside the service —
 * unlike a tag's three tiny shapes — because the document is the wire format
 * shared by the segment editor, the prospect-list builder and campaigns, so it
 * is a boundary worth naming.
 */

// ─────────────────────────── shared pieces ───────────────────────────

export const segmentEntitySchema = z.enum(SegmentEntity);
export type SegmentEntityName = z.infer<typeof segmentEntitySchema>;

// Trimmed at the edge so " Hot leads " and "Hot leads" cannot both exist —
// see the case-insensitive uniqueness check in the service.
export const segmentNameSchema = z
  .string()
  .trim()
  .min(1, "Give the segment a name")
  .max(60, "Segment names are 60 characters or fewer");

const recordId = z.string().cuid();

/**
 * A relative window in days, never an absolute date.
 *
 * "Created in the last 30 days" stays true as the segment ages; a stored
 * `createdAfter: 2026-01-01` silently rots into "everything" instead.
 */
const windowDays = z.number().int().min(1).max(3650);

// Capped: every id becomes its own `taggings.some` sub-query, and ALL-of
// semantics mean the cost is linear in the list.
const tagIdList = z.array(recordId).min(1).max(20);

const scoreBound = z.number().int().min(0).max(100);

/**
 * `hasEmail`/`hasPhone` are tri-state and that is the whole point: unset means
 * "don't care", which is a different query from `false`. A plain boolean with
 * a default would quietly turn every segment into "records with an email".
 */
const presence = z.boolean();

/** An inverted score range matches nothing, which is never what anyone meant. */
const orderedScoreRange = (filter: { scoreMin?: number; scoreMax?: number }) =>
  filter.scoreMin === undefined || filter.scoreMax === undefined || filter.scoreMin <= filter.scoreMax;

const SCORE_RANGE_MESSAGE = {
  message: "The highest score must be at least the lowest",
  path: ["scoreMax"],
};

// ─────────────────────────── per-entity documents ───────────────────────────

/**
 * Every field is optional, so `{}` is a valid document meaning "everything I
 * can see". `.strict()` is what makes the vocabulary closed: an unknown key is
 * rejected rather than dropped, so a typo'd filter fails loudly at save time
 * instead of silently widening the segment later.
 *
 * `noActivityForDays` counts from `Lead.lastActivityAt`, which `logActivity`
 * maintains — NOT from `firstTouchedAt`, which never moves after the first
 * touch and belongs to the SLA. A lead nobody has ever contacted counts as
 * stale rather than being excluded, which is the whole point of the filter.
 */
export const leadFilterSchema = z
  .object({
    status: z.array(z.enum(LeadStatus)).min(1).max(5).optional(),
    source: z.array(z.enum(LeadSource)).min(1).max(7).optional(),
    ownerId: recordId.optional(),
    scoreMin: scoreBound.optional(),
    scoreMax: scoreBound.optional(),
    tagIds: tagIdList.optional(),
    createdWithinDays: windowDays.optional(),
    noActivityForDays: windowDays.optional(),
    hasEmail: presence.optional(),
    hasPhone: presence.optional(),
  })
  .strict()
  .refine(orderedScoreRange, SCORE_RANGE_MESSAGE);

export const contactFilterSchema = z
  .object({
    ownerId: recordId.optional(),
    companyId: recordId.optional(),
    tagIds: tagIdList.optional(),
    createdWithinDays: windowDays.optional(),
    noActivityForDays: windowDays.optional(),
    hasEmail: presence.optional(),
    hasPhone: presence.optional(),
  })
  .strict();

export const companyFilterSchema = z
  .object({
    ownerId: recordId.optional(),
    tagIds: tagIdList.optional(),
    createdWithinDays: windowDays.optional(),
  })
  .strict();

export type LeadFilter = z.infer<typeof leadFilterSchema>;
export type ContactFilter = z.infer<typeof contactFilterSchema>;
export type CompanyFilter = z.infer<typeof companyFilterSchema>;

/**
 * A filter is only meaningful against one entity — `companyId` is a contact
 * concept, `score` a lead one — so the document is discriminated by entity
 * rather than being one permissive shape with mostly-unused keys.
 */
export type SegmentFilter =
  | { entity: "LEAD"; filter: LeadFilter }
  | { entity: "CONTACT"; filter: ContactFilter }
  | { entity: "COMPANY"; filter: CompanyFilter };

export function segmentFilterSchemaFor(entity: SegmentEntityName) {
  switch (entity) {
    case "LEAD":
      return leadFilterSchema;
    case "CONTACT":
      return contactFilterSchema;
    case "COMPANY":
      return companyFilterSchema;
  }
}

// ─────────────────────────── segment payloads ───────────────────────────

/**
 * Create payload, discriminated so the filter is checked against the entity it
 * was written for — `{ entity: "COMPANY", filter: { scoreMin: 50 } }` is
 * rejected rather than saved as a document nothing will ever read.
 *
 * No `ownerId`: the owner is the caller, taken from the session-derived `Ctx`.
 * Accepting one here would let a payload plant a private segment on someone
 * else's account.
 */
export const segmentCreateSchema = z.discriminatedUnion("entity", [
  z
    .object({
      entity: z.literal("LEAD"),
      name: segmentNameSchema,
      shared: z.boolean().default(true),
      filter: leadFilterSchema.default({}),
    })
    .strict(),
  z
    .object({
      entity: z.literal("CONTACT"),
      name: segmentNameSchema,
      shared: z.boolean().default(true),
      filter: contactFilterSchema.default({}),
    })
    .strict(),
  z
    .object({
      entity: z.literal("COMPANY"),
      name: segmentNameSchema,
      shared: z.boolean().default(true),
      filter: companyFilterSchema.default({}),
    })
    .strict(),
]);

export type SegmentCreateInput = z.infer<typeof segmentCreateSchema>;

/**
 * Update payload — a patch, built per entity.
 *
 * `entity` is deliberately not updatable: changing it would leave the stored
 * document describing columns the new entity does not have, and would move the
 * row under a different uniqueness scope mid-flight. Deleting and recreating is
 * the honest way to do that.
 */
export function segmentUpdateSchemaFor(entity: SegmentEntityName) {
  return z
    .object({
      name: segmentNameSchema.optional(),
      shared: z.boolean().optional(),
      filter: segmentFilterSchemaFor(entity).optional(),
    })
    .strict();
}
