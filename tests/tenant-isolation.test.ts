import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import {
  createContact,
  getContact,
  listContacts,
  softDeleteContact,
  updateContact,
} from "@/server/services/contacts";
import { convertLead, ingestLead, listLeads, markLeadTouched } from "@/server/services/leads";
import { dropOrg, makeOrg } from "./factories";

/**
 * The suite that never gets skipped. Org A must not read, list, update, or
 * delete anything belonging to Org B — for every resource we expose.
 */
describe("tenant isolation", () => {
  let a: Awaited<ReturnType<typeof makeOrg>>;
  let b: Awaited<ReturnType<typeof makeOrg>>;
  let bContactId: string;
  let bLeadId: string;

  beforeAll(async () => {
    a = await makeOrg();
    b = await makeOrg();

    const created = await createContact(b.ctx, {
      firstName: "Bee",
      lastName: "Confidential",
      email: "bee@org-b.test",
    });
    if (!created.ok) throw new Error(created.error);
    bContactId = created.data.id;

    const ingested = await ingestLead({
      organizationId: b.org.id,
      provider: "FACEBOOK",
      source: "FACEBOOK_LEAD_ADS",
      externalId: "b-lead-1",
      rawPayload: {},
      normalized: { firstName: "Bee", lastName: "Lead", email: "bee-lead@org-b.test" },
    });
    if (ingested.kind !== "created") throw new Error(`expected created, got ${ingested.kind}`);
    bLeadId = ingested.leadId;
  });

  afterAll(async () => {
    await dropOrg(a.org.id);
    await dropOrg(b.org.id);
    await db.$disconnect();
  });

  describe("contacts", () => {
    it("does not list another org's contacts", async () => {
      const { rows } = await listContacts(a.ctx, {});
      expect(rows.map((r) => r.id)).not.toContain(bContactId);
    });

    it("cannot read another org's contact by id", async () => {
      await expect(getContact(a.ctx, bContactId)).resolves.toBeNull();
    });

    it("cannot update another org's contact", async () => {
      const result = await updateContact(a.ctx, bContactId, { firstName: "Hijacked" });
      expect(result.ok).toBe(false);

      const untouched = await db.contact.findUnique({ where: { id: bContactId } });
      expect(untouched?.firstName).toBe("Bee");
    });

    it("cannot soft-delete another org's contact", async () => {
      const result = await softDeleteContact(a.ctx, bContactId);
      expect(result.ok).toBe(false);

      const untouched = await db.contact.findUnique({ where: { id: bContactId } });
      expect(untouched?.deletedAt).toBeNull();
    });

    it("creates a contact with no email at all", async () => {
      // Real contacts often arrive with a phone and nothing else. Requiring an
      // email here made the New Contact form fail on valid input.
      const nameOnly = await createContact(a.ctx, { firstName: "Phone", lastName: "Only" });
      expect(nameOnly.ok).toBe(true);

      const phoneOnly = await createContact(a.ctx, {
        firstName: "Phone",
        lastName: "Two",
        phone: "+14155550100",
      });
      expect(phoneOnly.ok).toBe(true);

      // But a malformed email is still refused rather than silently dropped.
      const bad = await createContact(a.ctx, { firstName: "Bad", email: "not-an-email" });
      expect(bad.ok).toBe(false);
    });

    it("rejects a companyId belonging to another org", async () => {
      const bCompany = await db.company.create({
        data: { organizationId: b.org.id, name: "Org B Holdings" },
      });

      const result = await createContact(a.ctx, {
        firstName: "Crafted",
        email: "crafted@org-a.test",
        companyId: bCompany.id,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/company does not exist/i);
    });
  });

  describe("leads", () => {
    it("does not list another org's leads", async () => {
      const { rows } = await listLeads(a.ctx, {});
      expect(rows.map((r) => r.id)).not.toContain(bLeadId);
    });

    it("cannot convert another org's lead", async () => {
      const result = await convertLead(a.ctx, bLeadId);
      expect(result.ok).toBe(false);

      const untouched = await db.lead.findUnique({ where: { id: bLeadId } });
      expect(untouched?.status).toBe("NEW");
    });

    it("cannot mark another org's lead as worked", async () => {
      const result = await markLeadTouched(a.ctx, bLeadId);
      expect(result.ok).toBe(false);

      const untouched = await db.lead.findUnique({ where: { id: bLeadId } });
      expect(untouched?.firstTouchedAt).toBeNull();
    });

    it("scopes the dedupe key per org — the same person can be a lead in both", async () => {
      const shared = { firstName: "Shared", lastName: "Person", email: "shared@example.test" };

      const inA = await ingestLead({
        organizationId: a.org.id,
        provider: "FACEBOOK",
        source: "FACEBOOK_LEAD_ADS",
        externalId: "shared-a",
        rawPayload: {},
        normalized: shared,
      });
      const inB = await ingestLead({
        organizationId: b.org.id,
        provider: "FACEBOOK",
        source: "FACEBOOK_LEAD_ADS",
        externalId: "shared-b",
        rawPayload: {},
        normalized: shared,
      });

      expect(inA.kind).toBe("created");
      expect(inB.kind).toBe("created");
      expect(inA.leadId).not.toBe(inB.leadId);
    });
  });
});

describe("permissions", () => {
  let readOnly: Awaited<ReturnType<typeof makeOrg>>;

  beforeAll(async () => {
    readOnly = await makeOrg("READ_ONLY");
  });

  afterAll(async () => {
    await dropOrg(readOnly.org.id);
  });

  it("a READ_ONLY user cannot create a contact", async () => {
    await expect(
      createContact(readOnly.ctx, { firstName: "Nope", email: "nope@test.local" }),
    ).rejects.toThrow(/permission/i);
  });

  it("a READ_ONLY user can still list contacts", async () => {
    await expect(listContacts(readOnly.ctx, {})).resolves.toHaveProperty("rows");
  });
});
