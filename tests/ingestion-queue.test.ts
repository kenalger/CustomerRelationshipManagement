import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { encryptSecret } from "@/lib/crypto";
import { db } from "@/lib/db";
import { normalizeFacebookLead, parseFieldMapping } from "@/server/integrations/facebook/normalize";
import { processLeadgenEvent } from "@/server/integrations/facebook/process";
import { listConnections, retryConnectionEvents, updateFieldMapping } from "@/server/services/connections";
import { sweepPendingIngestion } from "@/server/services/ingestion-queue";
import { MAX_INGESTION_ATTEMPTS, backoffFor, recordIngestionEvent } from "@/server/services/leads";
import { dropOrg, makeOrg } from "./factories";

describe("retry backoff", () => {
  it("grows with each attempt and stays inside Meta's 90-day window", () => {
    const first = backoffFor(1).getTime() - Date.now();
    const third = backoffFor(3).getTime() - Date.now();
    expect(third).toBeGreaterThan(first);
    expect(backoffFor(100).getTime() - Date.now()).toBeLessThanOrEqual(61 * 60_000);
  });
});

describe("field mapping", () => {
  it("keeps only known target fields", () => {
    const parsed = parseFieldMapping({
      email: ["work_email"],
      firstName: "vorname",
      nonsense: ["ignored"],
      phone: [],
    });
    expect(parsed).toEqual({ email: ["work_email"], firstName: ["vorname"] });
  });

  it("tolerates junk instead of throwing", () => {
    expect(parseFieldMapping(null)).toEqual({});
    expect(parseFieldMapping("nope")).toEqual({});
    expect(parseFieldMapping([1, 2, 3])).toEqual({});
  });

  it("lets a customer override a field name we have never seen", () => {
    const detail = {
      id: "1",
      field_data: [
        { name: "wie_heisst_du", values: ["Lena Fischer"] },
        { name: "geschaeftliche_email", values: ["lena@firma.test"] },
      ],
    };

    // Without a mapping the normalizer cannot know these names.
    const blind = normalizeFacebookLead(detail);
    expect(blind.email).toBeNull();
    expect(blind.firstName).toBeNull();

    const mapped = normalizeFacebookLead(
      detail,
      parseFieldMapping({ firstName: ["wie_heisst_du"], email: ["geschaeftliche_email"] }),
    );
    expect(mapped.firstName).toBe("Lena Fischer");
    expect(mapped.email).toBe("lena@firma.test");
    // Mapped fields must not also be dumped into the message as "extras".
    expect(mapped.message ?? "").not.toContain("geschaeftliche");
  });
});

describe("queue and connection health", () => {
  let org: Awaited<ReturnType<typeof makeOrg>>;
  let connectionId: string;

  const failing = async () =>
    new Response(JSON.stringify({ error: { message: "temporary", code: 2 } }), { status: 500 });

  beforeAll(async () => {
    org = await makeOrg();
    const connection = await db.connection.create({
      data: {
        organizationId: org.org.id,
        provider: "FACEBOOK",
        externalAccountId: `page-${org.org.id}`,
        encryptedTokens: encryptSecret("token"),
        scopes: ["leads_retrieval"],
      },
    });
    connectionId = connection.id;
  });

  afterAll(async () => {
    await dropOrg(org.org.id);
  });

  it("schedules a retry after a transient failure", async () => {
    const recorded = await recordIngestionEvent({
      organizationId: org.org.id,
      provider: "FACEBOOK",
      externalId: "q-1",
      rawPayload: {},
      connectionId,
    });
    if (recorded.kind !== "recorded") throw new Error("expected a new event");

    await processLeadgenEvent(recorded.eventId, failing);

    const event = await db.ingestionEvent.findUniqueOrThrow({ where: { id: recorded.eventId } });
    expect(event.status).toBe("FAILED");
    expect(event.attempts).toBe(1);
    expect(event.nextAttemptAt).not.toBeNull();
  });

  it("stops scheduling retries for a dead token — retrying cannot help", async () => {
    const recorded = await recordIngestionEvent({
      organizationId: org.org.id,
      provider: "FACEBOOK",
      externalId: "q-2",
      rawPayload: {},
      connectionId,
    });
    if (recorded.kind !== "recorded") throw new Error("expected a new event");

    const deadToken = async () =>
      new Response(JSON.stringify({ error: { message: "bad token", code: 190 } }), { status: 400 });
    await processLeadgenEvent(recorded.eventId, deadToken);

    const event = await db.ingestionEvent.findUniqueOrThrow({ where: { id: recorded.eventId } });
    expect(event.nextAttemptAt).toBeNull();
  });

  it("the sweeper picks up events whose backoff has elapsed", async () => {
    // Pull q-1's backoff into the past to simulate time passing.
    await db.ingestionEvent.updateMany({
      where: { externalId: "q-1", organizationId: org.org.id },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });

    const before = await db.ingestionEvent.findFirstOrThrow({
      where: { externalId: "q-1", organizationId: org.org.id },
    });
    expect(before.status).toBe("FAILED");

    const results = await sweepPendingIngestion({ organizationId: org.org.id });
    expect(results.attempted).toBeGreaterThan(0);
  });

  it("does not sweep events that have given up", async () => {
    const givenUp = await db.ingestionEvent.findFirstOrThrow({
      where: { externalId: "q-2", organizationId: org.org.id },
    });
    const attemptsBefore = givenUp.attempts;

    await sweepPendingIngestion({ organizationId: org.org.id });

    const after = await db.ingestionEvent.findUniqueOrThrow({ where: { id: givenUp.id } });
    expect(after.attempts).toBe(attemptsBefore);
  });

  it("reports per-connection health counts", async () => {
    const [connection] = await listConnections(org.ctx);
    expect(connection.id).toBe(connectionId);
    expect(connection.events.failed).toBeGreaterThan(0);
    expect(connection.status).toBe("NEEDS_REAUTH");
  });

  it("a manual retry re-queues events that had given up", async () => {
    // The operator has fixed the token; now replay everything, including the
    // dead-token event the sweeper had permanently skipped.
    await db.connection.update({
      where: { id: connectionId },
      data: { encryptedTokens: encryptSecret("fixed-token") },
    });

    const failedBefore = await db.ingestionEvent.count({
      where: { connectionId, status: "FAILED" },
    });
    expect(failedBefore).toBeGreaterThan(0);

    const result = await retryConnectionEvents(org.ctx, connectionId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Every failed event was picked up — including the one with nextAttemptAt
    // cleared, which the automatic sweeper deliberately ignores.
    expect(result.data.attempted).toBe(failedBefore);
  });

  it("rejects an invalid field mapping instead of storing garbage", async () => {
    const bad = await updateFieldMapping(org.ctx, connectionId, "{not json");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/valid JSON/i);

    const useless = await updateFieldMapping(org.ctx, connectionId, '{"nope":["x"]}');
    expect(useless.ok).toBe(false);
  });

  it("stores a valid mapping and audits the change", async () => {
    const saved = await updateFieldMapping(org.ctx, connectionId, '{"email":["work_email"]}');
    expect(saved.ok).toBe(true);

    const connection = await db.connection.findUniqueOrThrow({ where: { id: connectionId } });
    expect(connection.fieldMapping).toEqual({ email: ["work_email"] });

    const audit = await db.auditLog.findFirst({
      where: { organizationId: org.org.id, entity: "Connection", action: "update_field_mapping" },
    });
    expect(audit).not.toBeNull();
  });

  describe("tenant isolation", () => {
    it("does not list another org's connections", async () => {
      const other = await makeOrg();
      try {
        expect(await listConnections(other.ctx)).toHaveLength(0);
      } finally {
        await dropOrg(other.org.id);
      }
    });

    it("cannot retry another org's connection", async () => {
      const other = await makeOrg();
      try {
        const result = await retryConnectionEvents(other.ctx, connectionId);
        expect(result.ok).toBe(false);
      } finally {
        await dropOrg(other.org.id);
      }
    });

    it("cannot rewrite another org's field mapping", async () => {
      const other = await makeOrg();
      try {
        const result = await updateFieldMapping(other.ctx, connectionId, '{"email":["hijack"]}');
        expect(result.ok).toBe(false);

        const untouched = await db.connection.findUniqueOrThrow({ where: { id: connectionId } });
        expect(untouched.fieldMapping).toEqual({ email: ["work_email"] });
      } finally {
        await dropOrg(other.org.id);
      }
    });
  });

  describe("permissions", () => {
    it("a REP cannot change a field mapping", async () => {
      const rep = { ...org.ctx, role: "REP" as const };
      await expect(updateFieldMapping(rep, connectionId, "{}")).rejects.toThrow(/permission/i);
    });

    it("a REP cannot trigger a retry", async () => {
      const rep = { ...org.ctx, role: "REP" as const };
      await expect(retryConnectionEvents(rep, connectionId)).rejects.toThrow(/permission/i);
    });
  });

  it("exposes the attempt ceiling used by the sweeper", () => {
    expect(MAX_INGESTION_ATTEMPTS).toBeGreaterThan(1);
  });
});
