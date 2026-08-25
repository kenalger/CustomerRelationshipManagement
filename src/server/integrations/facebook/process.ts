import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import {
  failIngestionEvent,
  materializeLead,
  type IngestOutcome,
} from "@/server/services/leads";
import { notifyAdmins } from "@/server/services/notifications";
import { GraphApiError, fetchLeadDetail, type Fetcher } from "./client";
import { normalizeFacebookLead, parseFieldMapping } from "./normalize";

/**
 * Phase 2 for a recorded leadgen event: fetch the field data from Meta,
 * normalize it, and materialize the Lead.
 *
 * Runs off the request path. Every failure marks the event FAILED with the
 * reason so it shows up on the connection health dashboard — a lead that
 * silently fails to import is indistinguishable from a lead that never came,
 * and Meta drops the data after 90 days.
 */
export async function processLeadgenEvent(
  eventId: string,
  fetcher: Fetcher = fetch,
): Promise<IngestOutcome | { kind: "failed"; reason: string }> {
  const event = await db.ingestionEvent.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      externalId: true,
      connection: {
        select: { id: true, encryptedTokens: true, status: true, fieldMapping: true },
      },
    },
  });
  if (!event) return { kind: "failed", reason: "event not found" };

  if (!event.connection?.encryptedTokens) {
    const reason = "connection has no access token — reconnect the Facebook page";
    await failIngestionEvent(eventId, reason);
    await markConnectionUnhealthy(event.connection?.id, reason);
    return { kind: "failed", reason };
  }

  try {
    const token = decryptSecret(event.connection.encryptedTokens);
    const detail = await fetchLeadDetail(event.externalId, token, fetcher);
    const mapping = parseFieldMapping(event.connection.fieldMapping);
    const outcome = await materializeLead(
      eventId,
      normalizeFacebookLead(detail, mapping),
      "FACEBOOK_LEAD_ADS",
    );

    await db.connection.update({
      where: { id: event.connection.id },
      data: { lastSyncAt: new Date(), failureCount: 0, lastError: null, status: "ACTIVE" },
    });

    return outcome;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    // An auth failure is not transient — stop retrying and tell the customer.
    // Meta reports a dead token as HTTP 400 with error.code 190, so this must
    // read the Meta code, not the HTTP status.
    const needsReauth = error instanceof GraphApiError ? error.needsReauth : false;
    // Retrying a dead token just burns the 90-day window; retrying a 500 does not.
    const retryable = error instanceof GraphApiError ? error.retryable : true;
    await failIngestionEvent(eventId, reason, { retryable: retryable && !needsReauth });
    await markConnectionUnhealthy(event.connection.id, reason, needsReauth);

    return { kind: "failed", reason };
  }
}

async function markConnectionUnhealthy(
  connectionId: string | undefined,
  reason: string,
  needsReauth = true,
) {
  if (!connectionId) return;

  const connection = await db.connection.update({
    where: { id: connectionId },
    data: {
      status: needsReauth ? "NEEDS_REAUTH" : "ERROR",
      lastError: reason.slice(0, 2000),
      lastErrorAt: new Date(),
      failureCount: { increment: 1 },
    },
    select: { id: true, organizationId: true, displayName: true, provider: true, failureCount: true },
  });

  // Only on reauth, and only once until acknowledged. A transient 5xx that the
  // sweeper will retry is not worth waking anyone, and alerting on every sweep
  // would train people to ignore the bell.
  if (!needsReauth) return;

  await notifyAdmins({
    organizationId: connection.organizationId,
    type: "CONNECTION_UNHEALTHY",
    title: `${connection.displayName ?? connection.provider} needs reconnecting`,
    body: `Leads are no longer arriving. ${reason.slice(0, 300)}`,
    entity: "Connection",
    entityId: connection.id,
    dedupeKey: `connection-unhealthy:${connection.id}`,
  });
}
