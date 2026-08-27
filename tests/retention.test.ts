import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { prunePayloads } from "@/server/services/ingestion-queue";
import { recordIngestionEvent } from "@/server/services/leads";
import { dropOrg, makeOrg } from "./factories";

describe("raw payload retention", () => {
  let org: Awaited<ReturnType<typeof makeOrg>>;
  let oldEvent: string;
  let recentEvent: string;

  beforeAll(async () => {
    org = await makeOrg();
    await db.organization.update({
      where: { id: org.org.id },
      data: { rawPayloadRetentionDays: 30 },
    });

    const older = await recordIngestionEvent({
      organizationId: org.org.id,
      provider: "FACEBOOK",
      externalId: "retention-old",
      rawPayload: { field_data: [{ name: "email", values: ["old@lead.test"] }] },
    });
    if (older.kind !== "recorded") throw new Error("seed");
    oldEvent = older.eventId;
    await db.ingestionEvent.update({
      where: { id: oldEvent },
      data: { receivedAt: new Date(Date.now() - 45 * 86_400_000) },
    });

    const recent = await recordIngestionEvent({
      organizationId: org.org.id,
      provider: "FACEBOOK",
      externalId: "retention-recent",
      rawPayload: { field_data: [{ name: "email", values: ["new@lead.test"] }] },
    });
    if (recent.kind !== "recorded") throw new Error("seed");
    recentEvent = recent.eventId;
  });

  afterAll(async () => {
    await dropOrg(org.org.id);
  });

  it("actually nulls the payload rather than reporting a no-op", async () => {
    const before = await db.ingestionEvent.findUniqueOrThrow({ where: { id: oldEvent } });
    expect(before.payload).not.toBeNull();

    const result = await prunePayloads();
    expect(result.pruned).toBeGreaterThan(0);

    const after = await db.ingestionEvent.findUniqueOrThrow({ where: { id: oldEvent } });
    expect(after.payload).toBeNull();
    expect(after.payloadPrunedAt).not.toBeNull();
  });

  it("keeps the event row, so the audit trail outlives the personal data", async () => {
    const event = await db.ingestionEvent.findUniqueOrThrow({ where: { id: oldEvent } });
    expect(event.externalId).toBe("retention-old");
    expect(event.provider).toBe("FACEBOOK");
    expect(event.receivedAt).toBeInstanceOf(Date);
  });

  it("leaves anything inside the window alone", async () => {
    const event = await db.ingestionEvent.findUniqueOrThrow({ where: { id: recentEvent } });
    expect(event.payload).not.toBeNull();
    expect(event.payloadPrunedAt).toBeNull();
  });

  it("is idempotent — a second pass prunes nothing", async () => {
    const again = await prunePayloads();
    expect(again.pruned).toBe(0);
  });

  it("honours a shorter window per organization", async () => {
    await db.organization.update({
      where: { id: org.org.id },
      data: { rawPayloadRetentionDays: 1 },
    });
    await db.ingestionEvent.update({
      where: { id: recentEvent },
      data: { receivedAt: new Date(Date.now() - 2 * 86_400_000) },
    });

    const result = await prunePayloads();
    expect(result.pruned).toBe(1);

    const event = await db.ingestionEvent.findUniqueOrThrow({ where: { id: recentEvent } });
    expect(event.payload).toBeNull();
  });
});
