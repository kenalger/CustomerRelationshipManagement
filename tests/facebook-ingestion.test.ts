import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { encryptSecret } from "@/lib/crypto";
import { db } from "@/lib/db";
import { GraphApiError } from "@/server/integrations/facebook/client";
import { normalizeFacebookLead } from "@/server/integrations/facebook/normalize";
import { processLeadgenEvent } from "@/server/integrations/facebook/process";
import { leadgenChangeSchema, metaWebhookSchema } from "@/server/integrations/facebook/schema";
import { verifyMetaSignature } from "@/server/integrations/facebook/signature";
import { recordIngestionEvent } from "@/server/services/leads";
import { dropOrg, makeOrg } from "./factories";

const APP_SECRET = "test-app-secret";
const sign = (body: string) =>
  `sha256=${createHmac("sha256", APP_SECRET).update(body, "utf8").digest("hex")}`;

describe("Meta signature verification", () => {
  const body = JSON.stringify({ object: "page", entry: [] });

  it("accepts a correctly signed body", () => {
    expect(verifyMetaSignature(body, sign(body), APP_SECRET)).toBe(true);
  });

  it("rejects a body that was altered after signing", () => {
    const signature = sign(body);
    expect(verifyMetaSignature(`${body} `, signature, APP_SECRET)).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    const forged = `sha256=${createHmac("sha256", "wrong").update(body).digest("hex")}`;
    expect(verifyMetaSignature(body, forged, APP_SECRET)).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(verifyMetaSignature(body, null, APP_SECRET)).toBe(false);
  });

  it("rejects a non-sha256 algorithm", () => {
    const sha1 = `sha1=${createHmac("sha1", APP_SECRET).update(body).digest("hex")}`;
    expect(verifyMetaSignature(body, sha1, APP_SECRET)).toBe(false);
  });

  it("rejects a truncated signature without throwing", () => {
    expect(verifyMetaSignature(body, "sha256=abc", APP_SECRET)).toBe(false);
  });

  it("rejects everything when no app secret is configured", () => {
    expect(verifyMetaSignature(body, sign(body), "")).toBe(false);
  });
});

describe("webhook payload parsing", () => {
  // Verbatim from Meta's docs — see plan/07-research/meta-lead-ads-api.md.
  const official = {
    object: "page",
    entry: [
      {
        id: 153125381133,
        time: 1438292065,
        changes: [
          {
            field: "leadgen",
            value: {
              leadgen_id: 123123123123,
              page_id: 123123123,
              form_id: 12312312312,
              adgroup_id: 12312312312,
              ad_id: 12312312312,
              created_time: 1440120384,
            },
          },
        ],
      },
    ],
  };

  it("parses Meta's documented payload", () => {
    const parsed = metaWebhookSchema.parse(official);
    expect(parsed.entry[0].id).toBe("153125381133");
  });

  it("keeps large ids as strings so precision is not lost", () => {
    const change = leadgenChangeSchema.parse(official.entry[0].changes[0]);
    expect(change.value.leadgen_id).toBe("123123123123");
    expect(typeof change.value.leadgen_id).toBe("string");
  });

  it("ignores non-leadgen changes rather than failing the whole delivery", () => {
    const other = { field: "feed", value: { item: "status" } };
    expect(leadgenChangeSchema.safeParse(other).success).toBe(false);
    expect(metaWebhookSchema.parse({ object: "page", entry: [{ id: 1, changes: [other] }] })
      .entry[0].changes).toHaveLength(1);
  });
});

describe("Facebook lead normalizer", () => {
  it("maps the conventional field names", () => {
    const result = normalizeFacebookLead({
      id: "1",
      field_data: [
        { name: "first_name", values: ["Dana"] },
        { name: "last_name", values: ["Reyes"] },
        { name: "email", values: ["dana@northwind.test"] },
        { name: "phone_number", values: ["+14155550142"] },
        { name: "company_name", values: ["Northwind"] },
      ],
    });

    expect(result).toMatchObject({
      firstName: "Dana",
      lastName: "Reyes",
      email: "dana@northwind.test",
      phone: "+14155550142",
      companyName: "Northwind",
    });
  });

  it("splits a single full_name field", () => {
    const result = normalizeFacebookLead({
      id: "1",
      field_data: [{ name: "full_name", values: ["Joe Example"] }],
    });
    expect(result.firstName).toBe("Joe");
    expect(result.lastName).toBe("Example");
  });

  it("handles a mononym without inventing a surname", () => {
    const result = normalizeFacebookLead({
      id: "1",
      field_data: [{ name: "full_name", values: ["Prince"] }],
    });
    expect(result.firstName).toBe("Prince");
    expect(result.lastName).toBeNull();
  });

  it("preserves custom qualifying questions instead of dropping them", () => {
    const result = normalizeFacebookLead({
      id: "1",
      field_data: [
        { name: "email", values: ["a@b.test"] },
        { name: "fleet_size", values: ["30-50 vehicles"] },
        { name: "budget_range", values: ["$50k+"] },
      ],
    });
    expect(result.message).toContain("fleet size: 30-50 vehicles");
    expect(result.message).toContain("budget range: $50k+");
  });

  it("ignores empty values rather than storing blanks", () => {
    const result = normalizeFacebookLead({
      id: "1",
      field_data: [
        { name: "email", values: ["  "] },
        { name: "first_name", values: ["Dana"] },
      ],
    });
    expect(result.email).toBeNull();
    expect(result.firstName).toBe("Dana");
  });
});

describe("two-phase leadgen processing", () => {
  let org: Awaited<ReturnType<typeof makeOrg>>;
  let connectionId: string;

  const detail = {
    id: "lead-1",
    created_time: "2026-08-23T10:00:00+0000",
    field_data: [
      { name: "full_name", values: ["Dana Reyes"] },
      { name: "email", values: ["dana@northwind.test"] },
      { name: "company_name", values: ["Northwind Logistics"] },
    ],
  };

  const okFetcher = async () =>
    new Response(JSON.stringify(detail), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  beforeAll(async () => {
    org = await makeOrg();
    const connection = await db.connection.create({
      data: {
        organizationId: org.org.id,
        provider: "FACEBOOK",
        externalAccountId: "page-123",
        encryptedTokens: encryptSecret("page-access-token"),
        scopes: ["leads_retrieval"],
      },
    });
    connectionId = connection.id;
  });

  afterAll(async () => {
    await dropOrg(org.org.id);
  });

  it("records the raw payload before any network call", async () => {
    const recorded = await recordIngestionEvent({
      organizationId: org.org.id,
      provider: "FACEBOOK",
      externalId: "lead-1",
      rawPayload: { field: "leadgen" },
      connectionId,
    });

    expect(recorded.kind).toBe("recorded");
    const event = await db.ingestionEvent.findFirst({ where: { externalId: "lead-1" } });
    expect(event?.status).toBe("RECEIVED");
  });

  it("is idempotent on leadgen_id — a redelivered webhook records nothing new", async () => {
    const again = await recordIngestionEvent({
      organizationId: org.org.id,
      provider: "FACEBOOK",
      externalId: "lead-1",
      rawPayload: { field: "leadgen" },
      connectionId,
    });

    expect(again.kind).toBe("replayed");
    expect(await db.ingestionEvent.count({ where: { externalId: "lead-1" } })).toBe(1);
  });

  it("fetches, normalizes, and materializes the lead", async () => {
    const event = await db.ingestionEvent.findFirstOrThrow({ where: { externalId: "lead-1" } });
    const outcome = await processLeadgenEvent(event.id, okFetcher);

    expect(outcome.kind).toBe("created");

    const lead = await db.lead.findFirst({ where: { organizationId: org.org.id } });
    expect(lead?.firstName).toBe("Dana");
    expect(lead?.lastName).toBe("Reyes");
    expect(lead?.email).toBe("dana@northwind.test");
    expect(lead?.companyName).toBe("Northwind Logistics");
    expect(lead?.source).toBe("FACEBOOK_LEAD_ADS");
    expect(lead?.ownerId).toBe(org.user.id);
  });

  it("marks the connection healthy after a successful sync", async () => {
    const connection = await db.connection.findUniqueOrThrow({ where: { id: connectionId } });
    expect(connection.status).toBe("ACTIVE");
    expect(connection.failureCount).toBe(0);
    expect(connection.lastSyncAt).not.toBeNull();
  });

  it("does not double-create when the processor is retried", async () => {
    const event = await db.ingestionEvent.findFirstOrThrow({ where: { externalId: "lead-1" } });
    const retry = await processLeadgenEvent(event.id, okFetcher);

    expect(retry.kind).toBe("replayed");
    expect(await db.lead.count({ where: { organizationId: org.org.id } })).toBe(1);
  });

  it("treats Meta's HTTP 400 + code 190 as a dead token, not a transient error", () => {
    // Confirmed against live Meta: an invalid token is 400, never 401.
    const real = new GraphApiError("Graph API 400 (code 190)", 400, false, 190);
    expect(real.needsReauth).toBe(true);
    expect(real.retryable).toBe(false);
  });

  it("treats a rate limit as retryable even though it arrives as a 400", () => {
    const throttled = new GraphApiError("Graph API 400 (code 4)", 400, true, 4);
    expect(throttled.retryable).toBe(true);
    expect(throttled.needsReauth).toBe(false);
  });

  it("falls back to HTTP status when Meta sends no error code", () => {
    expect(new GraphApiError("no body", 403, false, null).needsReauth).toBe(true);
    expect(new GraphApiError("no body", 500, true, null).needsReauth).toBe(false);
  });

  it("flags the connection for reauth when Meta rejects the token", async () => {
    const recorded = await recordIngestionEvent({
      organizationId: org.org.id,
      provider: "FACEBOOK",
      externalId: "lead-2",
      rawPayload: {},
      connectionId,
    });
    if (recorded.kind !== "recorded") throw new Error("expected a new event");

    // The shape Meta actually returns — verified live on 2026-08-23.
    const unauthorized = async () =>
      new Response(
        JSON.stringify({
          error: {
            message: "Invalid OAuth access token - Cannot parse access token",
            type: "OAuthException",
            code: 190,
          },
        }),
        { status: 400 },
      );

    const outcome = await processLeadgenEvent(recorded.eventId, unauthorized);
    expect(outcome.kind).toBe("failed");

    const event = await db.ingestionEvent.findUniqueOrThrow({ where: { id: recorded.eventId } });
    expect(event.status).toBe("FAILED");
    expect(event.error).toContain("code 190");

    const connection = await db.connection.findUniqueOrThrow({ where: { id: connectionId } });
    expect(connection.status).toBe("NEEDS_REAUTH");
    expect(connection.failureCount).toBeGreaterThan(0);
  });

  it("keeps the raw payload for replay after a failure", async () => {
    const event = await db.ingestionEvent.findFirstOrThrow({ where: { externalId: "lead-2" } });
    expect(event.payload).not.toBeNull();
    expect(event.status).toBe("FAILED");
  });

  it("classifies a 500 as retryable and a 400 as not", () => {
    expect(new GraphApiError("boom", 500, true).retryable).toBe(true);
    expect(new GraphApiError("bad", 400, false).retryable).toBe(false);
  });
});
