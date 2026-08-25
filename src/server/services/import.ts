import { db } from "@/lib/db";
import { normalizePhone } from "@/lib/dedupe";
import {
  IMPORT_FIELDS,
  MAX_IMPORT_ROWS,
  importRequestSchema,
  importRowSchema,
  type ImportField,
} from "@/lib/validation/import";
import { type Ctx, requireWrite } from "@/server/authz";
import { type Result, err, ok } from "@/server/result";
import { writeAudit } from "@/server/services/audit";

export type RowError = { row: number; message: string };

export type ImportSummary = {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  companiesCreated: number;
  errors: RowError[];
};

const FIELD_KEYS = new Set<string>(IMPORT_FIELDS.map((f) => f.key));

/**
 * Imports contacts from mapped CSV rows.
 *
 * Partial failure is the normal case, not the exception: real spreadsheets have
 * blank rows, malformed emails, and duplicates. A bad row must not abort the
 * import, and every rejection is reported with its row number so the person can
 * fix the source file.
 */
export async function importContacts(
  ctx: Ctx,
  raw: unknown,
): Promise<Result<ImportSummary>> {
  requireWrite(ctx);

  const parsed = importRequestSchema.safeParse(raw);
  if (!parsed.success) {
    // The row cap is the likeliest reason a well-formed request fails, and a
    // generic message here would leave the person guessing.
    const tooMany = parsed.error.issues.some((i) => i.path[0] === "rows" && i.code === "too_big");
    return err(
      tooMany
        ? `That file has more than ${MAX_IMPORT_ROWS.toLocaleString()} rows. Split it and import each part.`
        : "That import could not be read. Check the file and try again.",
    );
  }
  const { rows, mapping, onDuplicate } = parsed.data;

  // Only known target fields; a crafted mapping cannot reach other columns.
  const active = Object.entries(mapping).filter(
    ([, field]) => field && FIELD_KEYS.has(field),
  ) as [string, ImportField][];

  if (!active.some(([, field]) => field === "firstName")) {
    return err("Map a column to First name before importing");
  }

  const summary: ImportSummary = {
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    companiesCreated: 0,
    errors: [],
  };

  // Company lookups are cached per import — a 2,000-row file from one customer
  // would otherwise issue thousands of identical queries.
  const companyCache = new Map<string, string>();

  // Emails already seen *within this file*, so a spreadsheet that repeats a
  // person does not create them twice in one run.
  const seenEmails = new Set<string>();

  for (const [index, rawRow] of rows.entries()) {
    // +2: CSV header is line 1, so a user counting lines matches this number.
    const line = index + 2;

    const mapped: Record<string, string | null> = {};
    for (const [header, field] of active) {
      const value = rawRow[header]?.trim();
      mapped[field] = value ? value : null;
    }

    // A row where every mapped cell is blank is padding, not a failure.
    if (Object.values(mapped).every((v) => v === null)) {
      summary.skipped++;
      continue;
    }

    const row = importRowSchema.safeParse(mapped);
    if (!row.success) {
      summary.failed++;
      if (summary.errors.length < 100) {
        // Schema messages are already written for the person holding the
        // spreadsheet, so pass them straight through rather than prefixing a
        // field path they never chose.
        summary.errors.push({ row: line, message: row.error.issues[0].message });
      }
      continue;
    }

    const email = row.data.email ? row.data.email.toLowerCase() : null;
    const phone = normalizePhone(row.data.phone);

    if (email && seenEmails.has(email)) {
      summary.skipped++;
      continue;
    }
    if (email) seenEmails.add(email);

    try {
      // Resolve or create the company, cached.
      let companyId: string | null = null;
      if (row.data.companyName) {
        const key = row.data.companyName.toLowerCase();
        const cached = companyCache.get(key);
        if (cached) {
          companyId = cached;
        } else {
          const existing = await db.company.findFirst({
            where: {
              organizationId: ctx.organizationId,
              name: row.data.companyName,
              deletedAt: null,
            },
            select: { id: true },
          });
          if (existing) {
            companyId = existing.id;
          } else {
            const created = await db.company.create({
              data: {
                organizationId: ctx.organizationId,
                name: row.data.companyName,
                ownerId: ctx.userId,
              },
              select: { id: true },
            });
            companyId = created.id;
            summary.companiesCreated++;
          }
          companyCache.set(key, companyId);
        }
      }

      // Dedupe against contacts we already hold, by email only. Fuzzy name
      // matching would silently merge distinct people — see Q5.
      const duplicate = email
        ? await db.contact.findFirst({
            where: { organizationId: ctx.organizationId, email, deletedAt: null },
            select: { id: true },
          })
        : null;

      if (duplicate) {
        if (onDuplicate === "skip") {
          summary.skipped++;
          continue;
        }
        await db.contact.update({
          where: { id: duplicate.id },
          data: {
            firstName: row.data.firstName,
            lastName: row.data.lastName ?? undefined,
            phone: phone ?? undefined,
            title: row.data.title ?? undefined,
            companyId: companyId ?? undefined,
          },
        });
        summary.updated++;
        continue;
      }

      await db.contact.create({
        data: {
          organizationId: ctx.organizationId,
          firstName: row.data.firstName,
          lastName: row.data.lastName,
          email,
          phone,
          title: row.data.title,
          companyId,
          ownerId: ctx.userId,
        },
      });
      summary.created++;
    } catch (error) {
      summary.failed++;
      if (summary.errors.length < 100) {
        summary.errors.push({
          row: line,
          message: error instanceof Error ? error.message.slice(0, 160) : "Unknown error",
        });
      }
    }
  }

  // One audit row for the run, not one per contact — the point is the batch.
  await db.$transaction(async (tx) => {
    await writeAudit(tx, ctx, {
      entity: "Contact",
      entityId: "bulk-import",
      action: "import",
      after: {
        created: summary.created,
        updated: summary.updated,
        skipped: summary.skipped,
        failed: summary.failed,
        companiesCreated: summary.companiesCreated,
        rows: rows.length,
      },
    });
  });

  return ok(summary);
}
