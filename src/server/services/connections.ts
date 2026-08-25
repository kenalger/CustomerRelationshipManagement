import { db } from "@/lib/db";
import { parseFieldMapping } from "@/server/integrations/facebook/normalize";
import { processLeadgenEvent } from "@/server/integrations/facebook/process";
import { type Ctx, requireRole } from "@/server/authz";
import { type Result, err, ok } from "@/server/result";
import { MAX_INGESTION_ATTEMPTS } from "@/server/services/leads";
import { writeAudit } from "@/server/services/audit";

export async function listConnections(ctx: Ctx) {
  const connections = await db.connection.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      provider: true,
      status: true,
      externalAccountId: true,
      displayName: true,
      scopes: true,
      fieldMapping: true,
      lastSyncAt: true,
      lastError: true,
      lastErrorAt: true,
      failureCount: true,
    },
  });

  // Per-connection event health, in one grouped query rather than N.
  const counts = await db.ingestionEvent.groupBy({
    by: ["connectionId", "status"],
    where: { organizationId: ctx.organizationId, connectionId: { not: null } },
    _count: { _all: true },
  });

  const stuck = await db.ingestionEvent.groupBy({
    by: ["connectionId"],
    where: {
      organizationId: ctx.organizationId,
      status: "FAILED",
      OR: [{ attempts: { gte: MAX_INGESTION_ATTEMPTS } }, { nextAttemptAt: null }],
    },
    _count: { _all: true },
  });

  return connections.map((connection) => {
    const mine = counts.filter((c) => c.connectionId === connection.id);
    const by = (status: string) =>
      mine.find((c) => c.status === status)?._count._all ?? 0;

    return {
      ...connection,
      events: {
        processed: by("PROCESSED"),
        duplicate: by("DUPLICATE"),
        pending: by("RECEIVED") + by("PROCESSING"),
        failed: by("FAILED"),
        deadLettered: stuck.find((s) => s.connectionId === connection.id)?._count._all ?? 0,
      },
    };
  });
}

/**
 * Replays every failed event on a connection, including ones that exhausted
 * their automatic retries. This is the manual escape hatch a support person
 * uses after fixing the underlying cause (reconnected token, corrected mapping).
 */
export async function retryConnectionEvents(
  ctx: Ctx,
  connectionId: string,
): Promise<Result<{ attempted: number; recovered: number }>> {
  requireRole(ctx, "ADMIN");

  const connection = await db.connection.findFirst({
    where: { id: connectionId, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!connection) return err("Connection not found");

  const failed = await db.ingestionEvent.findMany({
    where: { organizationId: ctx.organizationId, connectionId, status: "FAILED" },
    orderBy: { receivedAt: "asc" },
    take: 50,
    select: { id: true },
  });

  let recovered = 0;
  for (const event of failed) {
    // Clear the give-up marker so the sweeper would pick it up again too.
    await db.ingestionEvent.update({
      where: { id: event.id },
      data: { nextAttemptAt: new Date(), attempts: 0 },
    });
    const outcome = await processLeadgenEvent(event.id);
    if (outcome.kind === "created" || outcome.kind === "duplicate") recovered++;
  }

  return ok({ attempted: failed.length, recovered });
}

/**
 * Saves a per-connection field mapping. This is what makes the integration
 * survive a customer whose form uses field names we have never seen — without
 * it, the built-in aliases are a guess.
 */
export async function updateFieldMapping(
  ctx: Ctx,
  connectionId: string,
  raw: string,
): Promise<Result<{ id: string }>> {
  requireRole(ctx, "ADMIN");

  const connection = await db.connection.findFirst({
    where: { id: connectionId, organizationId: ctx.organizationId },
    select: { id: true, fieldMapping: true },
  });
  if (!connection) return err("Connection not found");

  const trimmed = raw.trim();
  let mapping: unknown = {};

  if (trimmed !== "") {
    try {
      mapping = JSON.parse(trimmed);
    } catch {
      return err("That is not valid JSON");
    }
  }

  const cleaned = parseFieldMapping(mapping);
  if (trimmed !== "" && Object.keys(cleaned).length === 0) {
    return err(
      "No usable mappings found. Expected keys: firstName, lastName, email, phone, companyName, message",
    );
  }

  await db.$transaction(async (tx) => {
    await tx.connection.update({
      where: { id: connectionId },
      data: { fieldMapping: cleaned as never },
    });
    await writeAudit(tx, ctx, {
      entity: "Connection",
      entityId: connectionId,
      action: "update_field_mapping",
      before: connection.fieldMapping,
      after: cleaned,
    });
  });

  return ok({ id: connectionId });
}
