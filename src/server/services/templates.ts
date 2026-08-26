import { createHash } from "node:crypto";

import { z } from "zod";

import { db } from "@/lib/db";
import { type Ctx, requireDelete, requireWrite } from "@/server/authz";
import { type Result, err, ok } from "@/server/result";
import { writeAudit } from "@/server/services/audit";

/**
 * Email templates and their A/B variants.
 *
 * NOTHING HERE SENDS ANYTHING. No provider has been chosen (see
 * plan/04-features/outreach/plan.md), so a template is copy waiting for a
 * human: when a sequence step comes due the copy is put on a task and a rep
 * sends it by hand. Everything below is therefore about *storing and choosing*
 * copy, never about delivering it.
 *
 * Schemas are colocated here rather than in `lib/validation/` for the same
 * reason as `services/tags.ts` — one consumer, three small shapes.
 */

// ─────────────────────────── validation ───────────────────────────

// Trimmed at the edge so " Intro " and "Intro" cannot both exist.
export const templateNameSchema = z
  .string()
  .trim()
  .min(1, "Give the template a name")
  .max(80, "Template names are 80 characters or fewer");

export const templateSubjectSchema = z
  .string()
  .trim()
  .min(1, "A template needs a subject line")
  .max(200, "Subject lines are 200 characters or fewer");

export const templateBodySchema = z
  .string()
  .trim()
  .min(1, "A template needs a body")
  .max(20_000, "That body is too long to be an email");

/**
 * Variant labels are uppercased, not merely trimmed.
 *
 * `@@unique([templateId, label])` is a plain Postgres index and so is
 * case-sensitive: "a" and "A" would both be allowed and would then report as
 * two different arms of the same experiment. Normalising kills that at the
 * door — the same trap `services/tags.ts` documents for tag names.
 */
export const variantLabelSchema = z
  .string()
  .trim()
  .min(1, "Give the variant a label")
  .max(8, "Variant labels are short — 'A', 'B', 'CTA2'")
  .transform((value) => value.toUpperCase());

export const templateCreateSchema = z.object({
  name: templateNameSchema,
  subject: templateSubjectSchema,
  body: templateBodySchema,
});

export const templateUpdateSchema = templateCreateSchema.partial();

export const variantUpsertSchema = z.object({
  label: variantLabelSchema,
  subject: templateSubjectSchema,
  body: templateBodySchema,
});

export type TemplateCreateInput = z.infer<typeof templateCreateSchema>;
export type VariantUpsertInput = z.infer<typeof variantUpsertSchema>;

/** The copy actually put in front of a person: a subject and a body. */
export type Copy = { subject: string; body: string };

// ─────────────────────────── internals ───────────────────────────

/** A duplicate name is a user-facing outcome, not a 500 with a Prisma stack. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

/** A template this org owns, or null. Not owner-scoped — copy is shared. */
function findTemplate(ctx: Ctx, templateId: string) {
  return db.emailTemplate.findFirst({
    where: { id: templateId, organizationId: ctx.organizationId },
    select: { id: true, name: true, subject: true, body: true },
  });
}

/**
 * Case-insensitive name lookup, for the same reason as tags: the unique index
 * would happily hold both "Intro" and "intro", which is not a difference a
 * person browsing a template list can see.
 */
function findTemplateByName(ctx: Ctx, name: string, excludeId?: string) {
  return db.emailTemplate.findFirst({
    where: {
      organizationId: ctx.organizationId,
      name: { equals: name, mode: "insensitive" },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, name: true },
  });
}

// ─────────────────────────── template lifecycle ───────────────────────────

/** Every template in the org, with its variant labels. */
export async function listTemplates(ctx: Ctx) {
  return db.emailTemplate.findMany({
    where: { organizationId: ctx.organizationId }, // tenant scope — non-negotiable
    // Stable tiebreak on id so two templates differing only by case cannot
    // swap places between reads.
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      subject: true,
      updatedAt: true,
      variants: { select: { label: true }, orderBy: { label: "asc" } },
      _count: { select: { steps: true } },
    },
  });
}

/**
 * One template with its full variant copy.
 *
 * Returns null rather than a `Result` for a template in another tenant — a
 * read that cannot see a row and a read of a row that does not exist are the
 * same answer, and distinguishing them leaks existence.
 */
export async function getTemplate(ctx: Ctx, templateId: string) {
  return db.emailTemplate.findFirst({
    where: { id: templateId, organizationId: ctx.organizationId },
    select: {
      id: true,
      name: true,
      subject: true,
      body: true,
      createdAt: true,
      updatedAt: true,
      variants: {
        select: { id: true, label: true, subject: true, body: true },
        orderBy: { label: "asc" },
      },
    },
  });
}

export async function createTemplate(ctx: Ctx, raw: unknown): Promise<Result<{ id: string }>> {
  requireWrite(ctx);

  const parsed = templateCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return err("Check the highlighted fields", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const clash = await findTemplateByName(ctx, input.name);
  if (clash) return err(`A template called "${clash.name}" already exists`);

  try {
    const created = await db.$transaction(async (tx) => {
      const row = await tx.emailTemplate.create({
        data: { organizationId: ctx.organizationId, ...input },
        select: { id: true },
      });
      await writeAudit(tx, ctx, {
        entity: "EmailTemplate",
        entityId: row.id,
        action: "create",
        after: input,
      });
      return row;
    });

    return ok({ id: created.id });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    return err(`A template called "${input.name}" already exists`);
  }
}

export async function updateTemplate(
  ctx: Ctx,
  templateId: string,
  raw: unknown,
): Promise<Result<{ id: string }>> {
  requireWrite(ctx);

  const parsed = templateUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return err("Check the highlighted fields", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  // Load inside the tenant scope first: this is what turns a cross-tenant
  // edit attempt into a 'not found' instead of a silent write.
  const before = await findTemplate(ctx, templateId);
  if (!before) return err("Template not found");

  if (input.name) {
    // Excluding itself, so re-casing your own template is allowed.
    const clash = await findTemplateByName(ctx, input.name, templateId);
    if (clash) return err(`A template called "${clash.name}" already exists`);
  }

  try {
    await db.$transaction(async (tx) => {
      await tx.emailTemplate.update({ where: { id: templateId }, data: input });
      await writeAudit(tx, ctx, {
        entity: "EmailTemplate",
        entityId: templateId,
        action: "update",
        before,
        after: input,
      });
    });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    return err(`A template called "${input.name}" already exists`);
  }

  return ok({ id: templateId });
}

/**
 * Deletes a template outright. MANAGER+, like every other delete.
 *
 * `SequenceStep.template` is `onDelete: SetNull`, so a live campaign does not
 * lose its steps when copy is deleted — the step survives with its
 * `instruction` and no template, which is a step a rep can still work. That is
 * the deliberate trade: losing the copy is recoverable, losing the cadence
 * mid-flight is not. Steps still pointing at it are reported so a caller can
 * warn before doing it.
 */
export async function deleteTemplate(
  ctx: Ctx,
  templateId: string,
): Promise<Result<{ id: string; stepsAffected: number }>> {
  requireDelete(ctx);

  const existing = await findTemplate(ctx, templateId);
  if (!existing) return err("Template not found");

  const stepsAffected = await db.sequenceStep.count({
    where: { organizationId: ctx.organizationId, templateId },
  });

  await db.$transaction(async (tx) => {
    await tx.emailTemplate.delete({ where: { id: templateId } });
    await writeAudit(tx, ctx, {
      entity: "EmailTemplate",
      entityId: templateId,
      action: "delete",
      before: { ...existing, stepsAffected },
    });
  });

  return ok({ id: templateId, stepsAffected });
}

// ─────────────────────────── variants ───────────────────────────

/**
 * Creates or replaces one variant of a template.
 *
 * Upsert rather than create-or-error: a variant is identified by its label,
 * and editing arm "B" is the same intent as writing it the first time.
 */
export async function upsertVariant(
  ctx: Ctx,
  templateId: string,
  raw: unknown,
): Promise<Result<{ id: string; label: string }>> {
  requireWrite(ctx);

  const parsed = variantUpsertSchema.safeParse(raw);
  if (!parsed.success) {
    return err("Check the highlighted fields", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const template = await findTemplate(ctx, templateId);
  if (!template) return err("Template not found");

  const variant = await db.templateVariant.upsert({
    where: { templateId_label: { templateId, label: input.label } },
    create: {
      organizationId: ctx.organizationId,
      templateId,
      label: input.label,
      subject: input.subject,
      body: input.body,
    },
    update: { subject: input.subject, body: input.body },
    select: { id: true, label: true },
  });

  return ok(variant);
}

/**
 * Removes one arm of an experiment. MANAGER+.
 *
 * Enrollments already assigned to that label are NOT rewritten: they keep the
 * label they were bucketed into so reporting stays honest about what was sent,
 * and `copyFor` falls back to the template's own copy for a label that no
 * longer exists.
 */
export async function deleteVariant(
  ctx: Ctx,
  templateId: string,
  rawLabel: unknown,
): Promise<Result<{ removed: boolean }>> {
  requireDelete(ctx);

  const parsed = variantLabelSchema.safeParse(rawLabel);
  if (!parsed.success) return err("That is not a variant label");

  const template = await findTemplate(ctx, templateId);
  if (!template) return err("Template not found");

  const { count } = await db.templateVariant.deleteMany({
    where: { organizationId: ctx.organizationId, templateId, label: parsed.data },
  });

  return ok({ removed: count > 0 });
}

// ─────────────────────────── choosing copy ───────────────────────────

/**
 * Deterministic bucketing of a seed into one of the labels.
 *
 * NOT `Math.random()`. A/B assignment is decided once per enrollment and
 * stored, but the function that decides it still has to be reproducible: a
 * retried enrollment, a re-run of the sweep, or a support engineer asking
 * "which arm is this prospect in" must all give one answer. A hash of a stable
 * seed — `(recordId, campaignId)` — gives that for free, with no state.
 *
 * SHA-256 rather than a hand-rolled hash so the distribution is even and the
 * result is identical across processes and Node versions.
 */
export function pickVariantLabel(labels: readonly string[], seed: string): string | null {
  if (labels.length === 0) return null;

  // Sorted so the mapping does not depend on the order rows came back in.
  const ordered = [...labels].sort();
  const digest = createHash("sha256").update(seed).digest();
  // 32 bits is far more entropy than the handful of arms anyone runs, and
  // readUInt32BE avoids the sign trap of parseInt on a 32-bit hex slice.
  const bucket = digest.readUInt32BE(0) % ordered.length;

  return ordered[bucket];
}

/**
 * The copy for one enrollment: the variant it was bucketed into, or the
 * template's own copy.
 *
 * Falls back deliberately rather than erroring. An enrollment carries a single
 * `variantLabel` for the whole sequence, but a five-step campaign may only
 * A/B-test step one — every other step has no variant with that label and must
 * still produce copy. Same path covers a variant deleted mid-flight.
 */
export function copyFor(
  template: { subject: string; body: string; variants?: { label: string; subject: string; body: string }[] },
  variantLabel: string | null | undefined,
): Copy {
  if (!variantLabel) return { subject: template.subject, body: template.body };

  const variant = template.variants?.find((v) => v.label === variantLabel);
  return variant
    ? { subject: variant.subject, body: variant.body }
    : { subject: template.subject, body: template.body };
}

/**
 * Substitutes `{{first_name}}`-style merge fields.
 *
 * An unknown or empty field collapses to the empty string rather than being
 * left as `{{first_name}}` — a literal placeholder reaching a prospect is the
 * classic embarrassment, and this copy is going to a rep to paste and send.
 * Pure and synchronous so it is testable without a database.
 */
export function renderCopy(copy: Copy, values: Record<string, string | null | undefined>): Copy {
  const substitute = (text: string) =>
    text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => values[key]?.trim() ?? "");

  return { subject: substitute(copy.subject), body: substitute(copy.body) };
}
