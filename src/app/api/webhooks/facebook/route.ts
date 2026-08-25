import { after } from "next/server";

import { db } from "@/lib/db";
import { leadgenChangeSchema, metaWebhookSchema } from "@/server/integrations/facebook/schema";
import { verifyMetaSignature } from "@/server/integrations/facebook/signature";
import { processLeadgenEvent } from "@/server/integrations/facebook/process";
import { recordIngestionEvent } from "@/server/services/leads";

// Unauthenticated by design — Meta has no session. Authenticity comes from the
// HMAC signature; the tenant comes from the page id, matched against a stored
// Connection. Nothing here ever trusts a field in the body to say who we are.
export const dynamic = "force-dynamic";

/**
 * Subscription handshake. Meta GETs with hub.mode / hub.verify_token /
 * hub.challenge and expects the challenge echoed verbatim with a 200.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  const expected = process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN;
  if (!expected) return new Response("Not configured", { status: 500 });

  if (mode === "subscribe" && token === expected && challenge) {
    return new Response(challenge, {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }

  return new Response("Forbidden", { status: 403 });
}

/**
 * Lead notification receiver.
 *
 * Does three things and nothing else: verify the signature, durably record
 * each payload, return 200 fast. Fetching field data happens after the
 * response — Meta retries non-200s and throttles slow endpoints, and a retry
 * storm on a slow endpoint is how you lose leads.
 */
export async function POST(request: Request) {
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  if (!appSecret) return new Response("Not configured", { status: 500 });

  // The RAW body — re-serializing JSON changes bytes and breaks the HMAC.
  const rawBody = await request.text();

  if (!verifyMetaSignature(rawBody, request.headers.get("x-hub-signature-256"), appSecret)) {
    return new Response("Invalid signature", { status: 401 });
  }

  let parsed;
  try {
    parsed = metaWebhookSchema.parse(JSON.parse(rawBody));
  } catch {
    // Malformed, but signed by Meta. 200 so it is not redelivered forever;
    // we cannot fix it by receiving it again.
    console.error("facebook webhook: unparseable payload");
    return new Response("OK", { status: 200 });
  }

  if (parsed.object !== "page") return new Response("OK", { status: 200 });

  const eventIds: string[] = [];

  for (const entry of parsed.entry) {
    // entry.id is the page id. Exact match against a stored Connection is the
    // ONLY thing that establishes which tenant this belongs to.
    const connection = await db.connection.findFirst({
      where: { provider: "FACEBOOK", externalAccountId: entry.id },
      select: { id: true, organizationId: true },
    });

    if (!connection) {
      // Unknown page: nothing to attach it to, and no tenant to blame. Log and
      // move on — 200 prevents Meta retrying a payload we can never place.
      console.warn(`facebook webhook: no connection for page ${entry.id}`);
      continue;
    }

    for (const change of entry.changes) {
      const leadgen = leadgenChangeSchema.safeParse(change);
      if (!leadgen.success) continue; // other subscribed fields, not our concern

      const recorded = await recordIngestionEvent({
        organizationId: connection.organizationId,
        provider: "FACEBOOK",
        externalId: leadgen.data.value.leadgen_id,
        rawPayload: change,
        connectionId: connection.id,
      });

      if (recorded.kind === "recorded") eventIds.push(recorded.eventId);
    }
  }

  // Fetch field data after responding. This is a stopgap: `after` dies with
  // the serverless invocation, so a crash here loses the fetch (the event row
  // survives and can be replayed). A real queue with retries and a DLQ is the
  // M3a deliverable — see plan/04-features/lead-ingestion/plan.md.
  if (eventIds.length > 0) {
    after(async () => {
      for (const id of eventIds) {
        try {
          await processLeadgenEvent(id);
        } catch (error) {
          console.error(`facebook webhook: processing ${id} failed`, error);
        }
      }
    });
  }

  return new Response("OK", { status: 200 });
}
