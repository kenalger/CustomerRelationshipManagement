import { z } from "zod";

import { SuppressionReason } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { type Ctx, requireDelete, requireWrite } from "@/server/authz";
import { type Result, err, ok } from "@/server/result";
import { writeAudit } from "@/server/services/audit";

/**
 * Suppression — addresses that must never be contacted.
 *
 * Built before sending exists, deliberately. A suppression list added after
 * the first campaign has gone out is not a suppression list, it is an apology.
 *
 * Two rules run through everything here:
 *
 * 1. **Normalise on the way in, always.** The unique index is on the lowercased
 *    trimmed address. A list that treats "Alex@Example.com" and
 *    "alex@example.com" as two people reports a coverage it does not have,
 *    which is worse than having no list at all.
 * 2. **Suppression outlives the record.** It is keyed by address, not by a flag
 *    on Contact or Lead — someone unsubscribes, the contact is deleted, a CSV
 *    re-imports them next quarter, and the address stays suppressed.
 */

// ─────────────────────────── validation ───────────────────────────

/**
 * Lowercased and trimmed by the schema itself, so there is no path into this
 * module that can write an unnormalised address. `z.email()` after the
 * transform, not before: " Alex@Example.com " is a valid address that merely
 * needs cleaning, and rejecting it would be pedantry aimed at the wrong party.
 */
export const suppressedEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("That does not look like an email address"))
  .pipe(z.string().max(320));

export const suppressionAddSchema = z.object({
  email: suppressedEmailSchema,
  reason: z.enum(SuppressionReason).default("MANUAL"),
  note: z.string().trim().max(500).optional(),
});

/** Bulk paste: one address per line, or comma separated. */
export const suppressionBulkSchema = z.object({
  emails: z.string().min(1, "Paste at least one address").max(200_000),
  reason: z.enum(SuppressionReason).default("MANUAL"),
  note: z.string().trim().max(500).optional(),
});

export type SuppressionAddInput = z.infer<typeof suppressionAddSchema>;

/**
 * How many addresses one paste may carry.
 *
 * An unsubscribe export from a mail provider is realistically thousands of
 * rows, so this is generous; the cap exists to stop a paste of a whole
 * database from becoming one transaction.
 */
export const MAX_BULK_SUPPRESS = 10_000;

// ─────────────────────────── internals ───────────────────────────

/** A duplicate address is an outcome, not a 500 with a Prisma stack. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

/**
 * Splits a pasted blob into normalised addresses.
 *
 * Anything that is not an address is dropped rather than failing the whole
 * paste: these blobs come out of spreadsheets and mail clients, and they
 * arrive with headers, blank lines and stray names in them. Returning what
 * could be read plus a count of what could not is more useful than refusing
 * 4,000 good addresses because one row said "Email".
 */
export function parseEmailBlob(blob: string): { emails: string[]; rejected: number } {
  const seen = new Set<string>();
  let rejected = 0;

  for (const raw of blob.split(/[\s,;]+/)) {
    if (raw === "") continue;
    const parsed = suppressedEmailSchema.safeParse(raw);
    if (!parsed.success) {
      rejected += 1;
      continue;
    }
    seen.add(parsed.data);
  }

  return { emails: [...seen], rejected };
}

// ─────────────────────────── the question everything else asks ───────────────────────────

/**
 * Is this address suppressed?
 *
 * Returns false for a null or unparseable address. That is not a loophole:
 * a record with no email cannot be emailed, so there is nothing to suppress,
 * and the enrollment path refuses those separately for its own reasons.
 */
export async function isSuppressed(ctx: Ctx, email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const parsed = suppressedEmailSchema.safeParse(email);
  if (!parsed.success) return false;

  const hit = await db.suppression.findUnique({
    where: { organizationId_email: { organizationId: ctx.organizationId, email: parsed.data } },
    select: { id: true },
  });
  return hit !== null;
}

/**
 * The suppressed subset of a batch of addresses, as a Set of normalised forms.
 *
 * One query for the whole batch rather than one per address — enrolling a
 * 5,000-row prospect list must not become 5,000 round trips, and a check that
 * is expensive is a check someone will eventually be tempted to skip.
 */
export async function suppressedAmong(
  ctx: Ctx,
  emails: Array<string | null | undefined>,
): Promise<Set<string>> {
  const normalised = new Set<string>();
  for (const email of emails) {
    if (!email) continue;
    const parsed = suppressedEmailSchema.safeParse(email);
    if (parsed.success) normalised.add(parsed.data);
  }
  if (normalised.size === 0) return new Set();

  const rows = await db.suppression.findMany({
    where: { organizationId: ctx.organizationId, email: { in: [...normalised] } },
    select: { email: true },
  });
  return new Set(rows.map((row) => row.email));
}

// ─────────────────────────── lifecycle ───────────────────────────

export async function listSuppressions(
  ctx: Ctx,
  opts?: { q?: string; page?: number; perPage?: number },
) {
  const page = Math.max(1, Math.floor(opts?.page ?? 1));
  const perPage = Math.min(100, Math.max(1, Math.floor(opts?.perPage ?? 50)));
  const q = opts?.q?.trim().toLowerCase();

  const where = {
    organizationId: ctx.organizationId,
    ...(q ? { email: { contains: q } } : {}),
  };

  const [rows, total] = await Promise.all([
    db.suppression.findMany({
      where,
      // Stable tiebreak on id, so two rows added in the same millisecond
      // cannot swap places between pages.
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * perPage,
      take: perPage,
      select: {
        id: true,
        email: true,
        reason: true,
        note: true,
        createdAt: true,
        createdBy: { select: { name: true, email: true } },
      },
    }),
    db.suppression.count({ where }),
  ]);

  return { rows, total, page, perPage };
}

/**
 * Suppresses one address.
 *
 * Adding an address that is already suppressed is a no-op reporting
 * `added: false`, not an error. Suppression is a desired end state, and the
 * end state is the same either way — failing here would make an unsubscribe
 * webhook that retries look broken.
 */
export async function suppress(ctx: Ctx, raw: unknown): Promise<Result<{ added: boolean }>> {
  requireWrite(ctx);

  const parsed = suppressionAddSchema.safeParse(raw);
  if (!parsed.success) {
    return err("Check the highlighted fields", parsed.error.flatten().fieldErrors);
  }
  const { email, reason, note } = parsed.data;

  const existing = await db.suppression.findUnique({
    where: { organizationId_email: { organizationId: ctx.organizationId, email } },
    select: { id: true },
  });
  if (existing) return ok({ added: false });

  try {
    await db.$transaction(async (tx) => {
      const created = await tx.suppression.create({
        data: {
          organizationId: ctx.organizationId,
          email,
          reason,
          note: note ?? null,
          createdById: ctx.userId,
        },
        select: { id: true },
      });
      await writeAudit(tx, ctx, {
        entity: "Suppression",
        entityId: created.id,
        action: "suppress",
        after: { email, reason },
      });
    });
  } catch (e) {
    // Lost a race with a concurrent add. The end state is what was asked for.
    if (!isUniqueViolation(e)) throw e;
    return ok({ added: false });
  }

  return ok({ added: true });
}

/**
 * Suppresses a pasted list of addresses.
 *
 * `createMany` with `skipDuplicates`, so re-pasting last month's export costs
 * one statement and changes nothing. Audited as a single row naming the count
 * rather than one row per address — 4,000 audit entries for one paste buries
 * everything else in the log.
 */
export async function suppressMany(
  ctx: Ctx,
  raw: unknown,
): Promise<Result<{ added: number; alreadyPresent: number; rejected: number }>> {
  requireWrite(ctx);

  const parsed = suppressionBulkSchema.safeParse(raw);
  if (!parsed.success) {
    return err("Check the highlighted fields", parsed.error.flatten().fieldErrors);
  }

  const { emails, rejected } = parseEmailBlob(parsed.data.emails);
  if (emails.length === 0) {
    return err(
      rejected > 0
        ? "None of those lines looked like an email address"
        : "Paste at least one address",
    );
  }
  if (emails.length > MAX_BULK_SUPPRESS) {
    return err(`That is more than ${MAX_BULK_SUPPRESS.toLocaleString()} addresses at once`);
  }

  const added = await db.$transaction(async (tx) => {
    const { count } = await tx.suppression.createMany({
      data: emails.map((email) => ({
        organizationId: ctx.organizationId,
        email,
        reason: parsed.data.reason,
        note: parsed.data.note ?? null,
        createdById: ctx.userId,
      })),
      skipDuplicates: true,
    });

    await writeAudit(tx, ctx, {
      entity: "Suppression",
      entityId: ctx.organizationId,
      action: "suppress_bulk",
      after: { offered: emails.length, added: count, reason: parsed.data.reason },
    });

    return count;
  });

  return ok({ added, alreadyPresent: emails.length - added, rejected });
}

/**
 * Removes a suppression.
 *
 * MANAGER+, unlike the rest of this module. Adding an address to the list is
 * cautious and anyone can do it; taking one off means contacting someone who
 * asked not to be contacted, which is the one action here with a legal edge to
 * it. It is audited with the address, so the decision has a name attached.
 */
export async function unsuppress(ctx: Ctx, id: string): Promise<Result<{ id: string }>> {
  requireDelete(ctx);

  const existing = await db.suppression.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true, email: true, reason: true },
  });
  if (!existing) return err("Not found");

  await db.$transaction(async (tx) => {
    await tx.suppression.delete({ where: { id } });
    await writeAudit(tx, ctx, {
      entity: "Suppression",
      entityId: id,
      action: "unsuppress",
      before: existing,
    });
  });

  return ok({ id });
}
