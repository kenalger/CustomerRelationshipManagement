import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { buildDedupeKey, normalizePhone } from "@/lib/dedupe";
import { convertLead, ingestLead } from "@/server/services/leads";
import { dropOrg, makeOrg } from "./factories";

describe("dedupe key", () => {
  it("prefers email, lowercased and trimmed", () => {
    expect(buildDedupeKey({ email: "  Dana@Example.TEST ", phone: "+1 415 555 0142" }))
      .toBe("email:dana@example.test");
  });

  it("falls back to phone when there is no email", () => {
    expect(buildDedupeKey({ phone: "+1 (415) 555-0142" })).toBe("phone:+14155550142");
  });

  it("falls back to name and company as a last resort", () => {
    expect(buildDedupeKey({ firstName: "Dana", lastName: "Reyes", companyName: "Northwind" }))
      .toBe("name:dana reyes|northwind");
  });

  it("throws rather than inventing a key with nothing to go on", () => {
    expect(() => buildDedupeKey({})).toThrow(/no email, phone, or name/i);
  });

  it("rejects phone fragments too short to identify anyone", () => {
    expect(normalizePhone("12345")).toBeNull();
  });
});

describe("ingestion", () => {
  let org: Awaited<ReturnType<typeof makeOrg>>;

  beforeAll(async () => {
    org = await makeOrg();
  });

  afterAll(async () => {
    await dropOrg(org.org.id);
  });

  it("creates a lead and assigns an owner so nothing lands unowned", async () => {
    const result = await ingestLead({
      organizationId: org.org.id,
      provider: "FACEBOOK",
      source: "FACEBOOK_LEAD_ADS",
      externalId: "evt-1",
      rawPayload: { field_data: [] },
      normalized: { firstName: "Ada", email: "ada@example.test" },
    });

    expect(result.kind).toBe("created");
    const lead = await db.lead.findUnique({ where: { id: result.leadId! } });
    expect(lead?.ownerId).toBe(org.user.id);
    expect(lead?.status).toBe("NEW");
  });

  it("is idempotent on the provider's externalId — a redelivered webhook is a no-op", async () => {
    const replay = await ingestLead({
      organizationId: org.org.id,
      provider: "FACEBOOK",
      source: "FACEBOOK_LEAD_ADS",
      externalId: "evt-1",
      rawPayload: { field_data: [] },
      normalized: { firstName: "Ada", email: "ada@example.test" },
    });

    expect(replay.kind).toBe("replayed");
    const count = await db.lead.count({
      where: { organizationId: org.org.id, dedupeKey: "email:ada@example.test" },
    });
    expect(count).toBe(1);
  });

  it("dedupes a genuinely new submission from the same person", async () => {
    const again = await ingestLead({
      organizationId: org.org.id,
      provider: "FACEBOOK",
      source: "FACEBOOK_LEAD_ADS",
      externalId: "evt-2", // different event, same person
      rawPayload: {},
      normalized: { firstName: "Ada", email: "ada@example.test", message: "Still interested" },
    });

    expect(again.kind).toBe("duplicate");

    // The second submission is logged, not discarded.
    const activities = await db.activity.count({
      where: { organizationId: org.org.id, leadId: again.leadId! },
    });
    expect(activities).toBe(1);
  });

  it("records every raw payload, including the ones it deduped", async () => {
    const events = await db.ingestionEvent.findMany({
      where: { organizationId: org.org.id },
      select: { externalId: true, status: true },
      orderBy: { externalId: "asc" },
    });
    expect(events).toEqual([
      { externalId: "evt-1", status: "PROCESSED" },
      { externalId: "evt-2", status: "DUPLICATE" },
    ]);
  });

  it("converts a lead into a contact, company, and open deal in one transaction", async () => {
    const ingested = await ingestLead({
      organizationId: org.org.id,
      provider: "GOOGLE",
      source: "EMAIL",
      externalId: "evt-3",
      rawPayload: {},
      normalized: {
        firstName: "Grace",
        lastName: "Hopper",
        email: "grace@navy.test",
        companyName: "Navy Systems",
      },
    });
    expect(ingested.kind).toBe("created");

    const result = await convertLead(org.ctx, ingested.leadId!);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [contact, deal, lead] = await Promise.all([
      db.contact.findUnique({ where: { id: result.data.contactId }, include: { company: true } }),
      db.deal.findUnique({ where: { id: result.data.dealId }, include: { stage: true } }),
      db.lead.findUnique({ where: { id: ingested.leadId! } }),
    ]);

    expect(contact?.email).toBe("grace@navy.test");
    expect(contact?.company?.name).toBe("Navy Systems");
    expect(deal?.stage.order).toBe(1);
    expect(deal?.stage.isWon).toBe(false);
    expect(lead?.status).toBe("CONVERTED");
    expect(lead?.convertedContactId).toBe(contact?.id);
  });

  it("refuses to convert the same lead twice", async () => {
    const lead = await db.lead.findFirst({
      where: { organizationId: org.org.id, status: "CONVERTED" },
    });
    const result = await convertLead(org.ctx, lead!.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/already been converted/i);
  });

  it("writes an audit row for the conversion", async () => {
    const audit = await db.auditLog.findFirst({
      where: { organizationId: org.org.id, entity: "Lead", action: "convert" },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe(org.user.id);
  });
});
