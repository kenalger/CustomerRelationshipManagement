import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import {
  MAX_BULK,
  bulkAssignContacts,
  bulkAssignLeads,
  bulkConvertLeads,
  bulkDeleteContacts,
  bulkSetLeadStatus,
} from "@/server/services/bulk";
import { createContact } from "@/server/services/contacts";
import { ingestLead } from "@/server/services/leads";
import { dropOrg, makeOrg } from "./factories";

/**
 * Sequential by design. `ingestLead` opens an interactive transaction, and
 * running two of those concurrently over the pg driver adapter corrupts the
 * protocol (`08P01: bind message supplies N parameters, but prepared
 * statement requires 0`). The product never does this — the webhook receiver
 * and both sweepers are loops — so the fix belongs in the test.
 */
async function seedLeads(orgId: string, keys: string[]) {
  const ids: string[] = [];
  for (const key of keys) ids.push(await seedLead(orgId, key));
  return ids;
}

async function seedLead(orgId: string, key: string) {
  const outcome = await ingestLead({
    organizationId: orgId,
    provider: "GOOGLE",
    source: "EMAIL",
    externalId: `bulk-${key}`,
    rawPayload: {},
    normalized: { firstName: "Bulk", lastName: key, email: `bulk-${key}@example.test` },
  });
  if (outcome.kind !== "created") throw new Error(`expected created, got ${outcome.kind}`);
  return outcome.leadId;
}

describe("bulk actions", () => {
  let org: Awaited<ReturnType<typeof makeOrg>>;
  let other: Awaited<ReturnType<typeof makeOrg>>;
  let colleagueId: string;

  beforeAll(async () => {
    org = await makeOrg();
    other = await makeOrg();
    const colleague = await db.user.create({
      data: {
        organizationId: org.org.id,
        email: `bulk-colleague-${org.org.id}@test.local`,
        role: "REP",
        passwordHash: "x",
      },
    });
    colleagueId = colleague.id;
  });

  afterAll(async () => {
    await dropOrg(org.org.id);
    await dropOrg(other.org.id);
    await db.$disconnect();
  });

  it("refuses an empty selection", async () => {
    const result = await bulkAssignLeads(org.ctx, [], colleagueId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/nothing selected/i);
  });

  it("refuses a selection over the cap rather than hanging", async () => {
    // Zero-padded on the LEFT: `"c1".padEnd(25,"0")` and `"c10".padEnd(25,"0")`
    // are the same string, which silently collapsed the set below the cap.
    const tooMany = Array.from(
      { length: MAX_BULK + 1 },
      (_, i) => `c${String(i).padStart(24, "0")}`,
    );
    expect(new Set(tooMany).size).toBe(MAX_BULK + 1);
    const result = await bulkAssignLeads(org.ctx, tooMany, colleagueId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(new RegExp(`at most ${MAX_BULK}`));
  });

  it("deduplicates the id list", async () => {
    const id = await seedLead(org.org.id, "dupe");
    const result = await bulkAssignLeads(org.ctx, [id, id, id], colleagueId);
    expect(result.ok).toBe(true);
    // Three copies of one id is one record, not three successes.
    if (result.ok) expect(result.data.succeeded).toBe(1);
  });

  it("assigns many leads at once", async () => {
    const ids = await seedLeads(org.org.id, ["a", "b"]);
    const result = await bulkAssignLeads(org.ctx, ids, colleagueId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.succeeded).toBe(2);
    const leads = await db.lead.findMany({ where: { id: { in: ids } } });
    expect(leads.every((l) => l.ownerId === colleagueId)).toBe(true);
  });

  it("rejects an assignee outside the organization", async () => {
    const id = await seedLead(org.org.id, "foreign-owner");
    const result = await bulkAssignLeads(org.ctx, [id], other.user.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not on this team/i);
  });

  it("silently matches nothing for another org's ids", async () => {
    const theirs = await seedLead(other.org.id, "theirs");
    const result = await bulkAssignLeads(org.ctx, [theirs], colleagueId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The crafted id is reported as failed, and the record is untouched.
    expect(result.data.succeeded).toBe(0);
    expect(result.data.failed).toBe(1);

    const lead = await db.lead.findUniqueOrThrow({ where: { id: theirs } });
    expect(lead.ownerId).not.toBe(colleagueId);
  });

  it("marking leads junk stops their SLA clock", async () => {
    const ids = await seedLeads(org.org.id, ["junk1", "junk2"]);
    const result = await bulkSetLeadStatus(org.ctx, ids, "JUNK");
    expect(result.ok).toBe(true);

    const leads = await db.lead.findMany({ where: { id: { in: ids } } });
    expect(leads.every((l) => l.status === "JUNK")).toBe(true);
    // Otherwise the SLA sweeper keeps nagging about leads already triaged.
    expect(leads.every((l) => l.firstTouchedAt !== null)).toBe(true);
  });

  it("converts many leads and reports partial failure", async () => {
    const good = await seedLead(org.org.id, "convert-ok");
    const already = await seedLead(org.org.id, "convert-twice");

    const first = await bulkConvertLeads(org.ctx, [already]);
    expect(first.ok).toBe(true);

    // Second pass includes one already converted — it must not abort the batch.
    const second = await bulkConvertLeads(org.ctx, [good, already]);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.data.succeeded).toBe(1);
    expect(second.data.failed).toBe(1);
    expect(second.data.errors[0]).toMatch(/already been converted/i);
  });

  it("soft-deletes contacts so history still resolves them", async () => {
    const made = [];
    for (const lastName of ["One", "Two"]) {
      made.push(await createContact(org.ctx, { firstName: "Del", lastName }));
    }
    const ids = made.map((m) => (m.ok ? m.data.id : ""));

    const result = await bulkDeleteContacts(org.ctx, ids);
    expect(result.ok).toBe(true);

    const rows = await db.contact.findMany({ where: { id: { in: ids } } });
    expect(rows).toHaveLength(2);
    expect(rows.every((c) => c.deletedAt !== null)).toBe(true);
  });

  it("a REP cannot bulk-delete", async () => {
    // Deleting is MANAGER and above, for one record or many. This now throws
    // from the role guard rather than returning a Result, which is the same
    // contract as every other role failure.
    const rep = { ...org.ctx, role: "REP" as const };
    const created = await createContact(org.ctx, { firstName: "Safe", lastName: "Contact" });
    if (!created.ok) throw new Error(created.error);

    await expect(bulkDeleteContacts(rep, [created.data.id])).rejects.toThrow(/permission/i);

    const contact = await db.contact.findUniqueOrThrow({ where: { id: created.data.id } });
    expect(contact.deletedAt).toBeNull();
  });

  it("a READ_ONLY user cannot bulk-assign", async () => {
    const readOnly = { ...org.ctx, role: "READ_ONLY" as const };
    await expect(bulkAssignContacts(readOnly, ["x"], colleagueId)).rejects.toThrow(/permission/i);
  });

  it("writes one audit row per batch, not per record", async () => {
    const audits = await db.auditLog.count({
      where: { organizationId: org.org.id, action: { startsWith: "bulk_" } },
    });
    expect(audits).toBeGreaterThan(0);

    const perRecord = await db.auditLog.count({
      where: { organizationId: org.org.id, entity: "Lead", action: "update" },
    });
    expect(perRecord).toBe(0);
  });
});
