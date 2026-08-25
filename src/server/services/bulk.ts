import { db } from "@/lib/db";
import { type Ctx, requireWrite } from "@/server/authz";
import { type Result, err, ok } from "@/server/result";
import { writeAudit } from "@/server/services/audit";
import { convertLead } from "@/server/services/leads";

/** Hard cap per action. A runaway selection should fail loudly, not hang. */
export const MAX_BULK = 200;

export type BulkOutcome = { succeeded: number; failed: number; errors: string[] };

/**
 * Bulk actions on a selection.
 *
 * Every one of these re-scopes by organizationId in the write itself rather
 * than trusting the id list — the ids arrive from the client, and a crafted
 * array is the obvious attack on a bulk endpoint. `updateMany` with a tenant
 * predicate means a foreign id simply matches nothing.
 */
function guard(ids: string[]): Result<string[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return err("Nothing selected");
  if (unique.length > MAX_BULK) {
    return err(`Select at most ${MAX_BULK} at a time — you picked ${unique.length}`);
  }
  return ok(unique);
}

export async function bulkAssignLeads(
  ctx: Ctx,
  leadIds: string[],
  ownerId: string,
): Promise<Result<BulkOutcome>> {
  requireWrite(ctx);

  const ids = guard(leadIds);
  if (!ids.ok) return ids;

  const owner = await db.user.findFirst({
    where: { id: ownerId, organizationId: ctx.organizationId, deletedAt: null },
    select: { id: true },
  });
  if (!owner) return err("That person is not on this team");

  const updated = await db.$transaction(async (tx) => {
    const result = await tx.lead.updateMany({
      where: { id: { in: ids.data }, organizationId: ctx.organizationId, deletedAt: null },
      data: { ownerId },
    });
    await writeAudit(tx, ctx, {
      entity: "Lead",
      entityId: "bulk",
      action: "bulk_assign",
      after: { count: result.count, ownerId },
    });
    return result.count;
  });

  return ok({
    succeeded: updated,
    // Ids that matched nothing were another tenant's, or already deleted.
    failed: ids.data.length - updated,
    errors: [],
  });
}

export async function bulkConvertLeads(
  ctx: Ctx,
  leadIds: string[],
): Promise<Result<BulkOutcome>> {
  requireWrite(ctx);

  const ids = guard(leadIds);
  if (!ids.ok) return ids;

  const outcome: BulkOutcome = { succeeded: 0, failed: 0, errors: [] };

  // Sequential on purpose: convertLead is a multi-table transaction that
  // creates a company, a contact and a deal. Running 200 of those in parallel
  // would exhaust the connection pool and deadlock on the company upsert.
  for (const id of ids.data) {
    const result = await convertLead(ctx, id);
    if (result.ok) {
      outcome.succeeded++;
    } else {
      outcome.failed++;
      if (outcome.errors.length < 10) outcome.errors.push(result.error);
    }
  }

  return ok(outcome);
}

export async function bulkSetLeadStatus(
  ctx: Ctx,
  leadIds: string[],
  status: "WORKING" | "JUNK",
): Promise<Result<BulkOutcome>> {
  requireWrite(ctx);

  const ids = guard(leadIds);
  if (!ids.ok) return ids;

  const updated = await db.$transaction(async (tx) => {
    const result = await tx.lead.updateMany({
      where: { id: { in: ids.data }, organizationId: ctx.organizationId, deletedAt: null },
      data: {
        status,
        // Marking a lead junk or working IS the first touch — it stops the SLA
        // clock, which is the whole point of doing it in bulk.
        firstTouchedAt: new Date(),
      },
    });
    await writeAudit(tx, ctx, {
      entity: "Lead",
      entityId: "bulk",
      action: "bulk_status",
      after: { count: result.count, status },
    });
    return result.count;
  });

  return ok({ succeeded: updated, failed: ids.data.length - updated, errors: [] });
}

export async function bulkAssignContacts(
  ctx: Ctx,
  contactIds: string[],
  ownerId: string,
): Promise<Result<BulkOutcome>> {
  requireWrite(ctx);

  const ids = guard(contactIds);
  if (!ids.ok) return ids;

  const owner = await db.user.findFirst({
    where: { id: ownerId, organizationId: ctx.organizationId, deletedAt: null },
    select: { id: true },
  });
  if (!owner) return err("That person is not on this team");

  const updated = await db.$transaction(async (tx) => {
    const result = await tx.contact.updateMany({
      where: { id: { in: ids.data }, organizationId: ctx.organizationId, deletedAt: null },
      data: { ownerId },
    });
    await writeAudit(tx, ctx, {
      entity: "Contact",
      entityId: "bulk",
      action: "bulk_assign",
      after: { count: result.count, ownerId },
    });
    return result.count;
  });

  return ok({ succeeded: updated, failed: ids.data.length - updated, errors: [] });
}

export async function bulkDeleteContacts(
  ctx: Ctx,
  contactIds: string[],
): Promise<Result<BulkOutcome>> {
  // Deleting many records at once is an admin-level action, not a rep one.
  requireWrite(ctx);
  if (ctx.role === "REP") return err("Ask an admin to delete records in bulk");

  const ids = guard(contactIds);
  if (!ids.ok) return ids;

  const updated = await db.$transaction(async (tx) => {
    // Soft delete: the person's name still resolves on the deals they touched.
    const result = await tx.contact.updateMany({
      where: { id: { in: ids.data }, organizationId: ctx.organizationId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    await writeAudit(tx, ctx, {
      entity: "Contact",
      entityId: "bulk",
      action: "bulk_delete",
      after: { count: result.count },
    });
    return result.count;
  });

  return ok({ succeeded: updated, failed: ids.data.length - updated, errors: [] });
}
