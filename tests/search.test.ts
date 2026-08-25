import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { createCompany } from "@/server/services/companies";
import { createContact } from "@/server/services/contacts";
import { createDeal } from "@/server/services/deals";
import { ingestLead } from "@/server/services/leads";
import { searchEverything } from "@/server/services/search";
import { dropOrg, makeOrg } from "./factories";

/**
 * Search touches four tables in one call. It is the single most likely place
 * for a tenant leak, so every entity gets an explicit isolation test.
 */
describe("cross-entity search", () => {
  let a: Awaited<ReturnType<typeof makeOrg>>;
  let b: Awaited<ReturnType<typeof makeOrg>>;

  beforeAll(async () => {
    a = await makeOrg();
    b = await makeOrg();

    // Org A's records — all share the token "zephyr" so one query finds them.
    const company = await createCompany(a.ctx, { name: "Zephyr Logistics", domain: "zephyr.test" });
    if (!company.ok) throw new Error(company.error);

    const contact = await createContact(a.ctx, {
      firstName: "Zephyr",
      lastName: "Contact",
      email: "zephyr.contact@example.test",
    });
    if (!contact.ok) throw new Error(contact.error);

    const deal = await createDeal(a.ctx, { title: "Zephyr renewal", value: 1000, currency: "USD" });
    if (!deal.ok) throw new Error(deal.error);

    await ingestLead({
      organizationId: a.org.id,
      provider: "GOOGLE",
      source: "EMAIL",
      externalId: "search-lead",
      rawPayload: {},
      normalized: { firstName: "Zephyr", lastName: "Lead", email: "zephyr.lead@example.test" },
    });

    // Org B gets a record that matches the same term.
    const otherCompany = await createCompany(b.ctx, { name: "Zephyr Rivals" });
    if (!otherCompany.ok) throw new Error(otherCompany.error);
  });

  afterAll(async () => {
    await dropOrg(a.org.id);
    await dropOrg(b.org.id);
    await db.$disconnect();
  });

  it("finds every entity type in one query", async () => {
    const hits = await searchEverything(a.ctx, "zephyr");
    const kinds = new Set(hits.map((h) => h.kind));

    expect(kinds).toEqual(new Set(["lead", "contact", "company", "deal"]));
  });

  it("returns a usable link for each hit", async () => {
    const hits = await searchEverything(a.ctx, "zephyr");
    for (const hit of hits) {
      expect(hit.href.startsWith("/")).toBe(true);
      expect(hit.title.length).toBeGreaterThan(0);
    }
  });

  it("is case-insensitive", async () => {
    const upper = await searchEverything(a.ctx, "ZEPHYR");
    expect(upper.length).toBeGreaterThan(0);
  });

  it("matches a company by domain, not just name", async () => {
    const hits = await searchEverything(a.ctx, "zephyr.test");
    expect(hits.some((h) => h.kind === "company")).toBe(true);
  });

  it("ignores a term too short to be meaningful", async () => {
    // Guards against a one-character query scanning four tables per keystroke.
    expect(await searchEverything(a.ctx, "z")).toEqual([]);
    expect(await searchEverything(a.ctx, "  ")).toEqual([]);
  });

  it("never returns another org's records", async () => {
    const hits = await searchEverything(a.ctx, "zephyr");
    expect(hits.some((h) => h.title.includes("Rivals"))).toBe(false);

    // And the reverse: org B sees only its own.
    const theirs = await searchEverything(b.ctx, "zephyr");
    expect(theirs).toHaveLength(1);
    expect(theirs[0].title).toBe("Zephyr Rivals");
  });

  it("returns nothing at all for an org with no matching data", async () => {
    const empty = await makeOrg();
    try {
      expect(await searchEverything(empty.ctx, "zephyr")).toEqual([]);
    } finally {
      await dropOrg(empty.org.id);
    }
  });

  it("caps results per entity type", async () => {
    const many = await makeOrg();
    try {
      for (let i = 0; i < 8; i++) {
        const created = await createCompany(many.ctx, { name: `Bulkco ${i}` });
        if (!created.ok) throw new Error(created.error);
      }
      const hits = await searchEverything(many.ctx, "bulkco", 5);
      expect(hits.filter((h) => h.kind === "company")).toHaveLength(5);
    } finally {
      await dropOrg(many.org.id);
    }
  });
});
