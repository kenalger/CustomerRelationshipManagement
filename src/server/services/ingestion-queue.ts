import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { processLeadgenEvent } from "@/server/integrations/facebook/process";
import { MAX_INGESTION_ATTEMPTS } from "@/server/services/leads";

/**
 * Database-backed retry sweeper.
 *
 * `after()` on the webhook handles the happy path, but it dies with the
 * serverless invocation — a crash mid-fetch leaves the event RECEIVED forever.
 * This sweeps every tenant for work that is stuck or due for another attempt.
 *
 * Chosen over a hosted queue deliberately: it needs no third-party account and
 * runs on a free-tier cron, which is the standing constraint (ADR 0003). The
 * trade-off is at-least-once delivery with minute-level latency — acceptable
 * because `materializeLead` is idempotent.
 */
export async function sweepPendingIngestion(
  options: { limit?: number; organizationId?: string } = {},
) {
  const limit = options.limit ?? 25;
  const now = new Date();

  const due = await db.ingestionEvent.findMany({
    where: {
      provider: "FACEBOOK",
      ...(options.organizationId ? { organizationId: options.organizationId } : {}),
      OR: [
        // Recorded but never processed — the `after()` callback died.
        { status: "RECEIVED", receivedAt: { lt: new Date(now.getTime() - 60_000) } },
        // Failed, still has attempts left, and its backoff has elapsed.
        {
          status: "FAILED",
          attempts: { lt: MAX_INGESTION_ATTEMPTS },
          nextAttemptAt: { not: null, lte: now },
        },
      ],
    },
    orderBy: { receivedAt: "asc" },
    take: limit,
    select: { id: true },
  });

  const results = { attempted: 0, created: 0, duplicate: 0, replayed: 0, failed: 0 };

  for (const event of due) {
    results.attempted++;
    try {
      const outcome = await processLeadgenEvent(event.id);
      if (outcome.kind === "created") results.created++;
      else if (outcome.kind === "duplicate") results.duplicate++;
      else if (outcome.kind === "replayed") results.replayed++;
      else results.failed++;
    } catch {
      // processLeadgenEvent records its own failure; this guard only stops one
      // bad event from stalling the rest of the sweep.
      results.failed++;
    }
  }

  return results;
}

/**
 * Prunes raw provider payloads past their retention window.
 *
 * Only the payload body goes. The IngestionEvent row survives with a
 * `payloadPrunedAt` stamp, so the record of what arrived and when — the audit
 * trail — outlives the personal data inside it. The Lead, Contact and Deal
 * produced from it are never touched.
 *
 * ADR 0002 names unbounded payload growth as the main threat to the database
 * tier, and this is also customers' personal data held on their behalf.
 */
export async function prunePayloads(limit = 500) {
  const orgs = await db.organization.findMany({
    select: { id: true, rawPayloadRetentionDays: true },
  });

  let pruned = 0;
  for (const org of orgs) {
    const cutoff = new Date(Date.now() - org.rawPayloadRetentionDays * 86_400_000);

    const result = await db.ingestionEvent.updateMany({
      where: {
        organizationId: org.id,
        receivedAt: { lt: cutoff },
        payloadPrunedAt: null,
      },
      // Prisma.DbNull writes a real SQL NULL. `undefined` would mean "leave
      // this column alone", so the prune would silently do nothing while
      // still reporting a count.
      data: { payload: Prisma.DbNull, payloadPrunedAt: new Date() },
      limit,
    });
    pruned += result.count;
  }

  return { pruned };
}

/** Events that have exhausted their retries — the dead-letter queue. */
export async function countDeadLettered(organizationId: string) {
  return db.ingestionEvent.count({
    where: {
      organizationId,
      status: "FAILED",
      OR: [{ attempts: { gte: MAX_INGESTION_ATTEMPTS } }, { nextAttemptAt: null }],
    },
  });
}
