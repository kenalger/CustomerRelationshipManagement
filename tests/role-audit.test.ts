import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import type { Ctx } from "@/server/authz";
import { seesAllRecords, visibleTo } from "@/server/authz";
import { logActivity } from "@/server/services/activities";
import { bulkAssignLeads, bulkDeleteContacts } from "@/server/services/bulk";
import { createCompany, getCompany, listCompanies } from "@/server/services/companies";
import {
  createContact,
  getContact,
  listContacts,
  softDeleteContact,
  updateContact,
} from "@/server/services/contacts";
import {
  createDeal,
  getDeal,
  getPipelineBoard,
  listDeals,
  moveDealToStage,
  updateDeal,
} from "@/server/services/deals";
import { ingestLead, listLeads } from "@/server/services/leads";
import { searchEverything } from "@/server/services/search";
import { getDashboard } from "@/server/services/dashboard";
import { createTask, listTasks } from "@/server/services/tasks";
import { dropOrg, makeOrg } from "./factories";

/**
 * The role model, as decided 2026-08-25:
 *   - a REP sees only records they own
 *   - every other role sees the whole organization
 *   - deleting requires MANAGER or above, for one record or many
 */
describe("role model", () => {
  let org: Awaited<ReturnType<typeof makeOrg>>;
  let repId: string;
  let theirContact: string;
  let theirDeal: string;
  let theirLead: string;
  let ownContact: string;

  const as = (role: Ctx["role"], userId?: string): Ctx => ({
    ...org.ctx,
    role,
    userId: userId ?? org.ctx.userId,
  });
  const rep = () => as("REP", repId);

  beforeAll(async () => {
    org = await makeOrg();
    const user = await db.user.create({
      data: {
        organizationId: org.org.id,
        email: `rep-${org.org.id}@test.local`,
        role: "REP",
        passwordHash: "x",
      },
    });
    repId = user.id;

    // Owned by the org owner, NOT by the rep.
    const contact = await createContact(org.ctx, { firstName: "Someone", lastName: "Elses" });
    if (!contact.ok) throw new Error(contact.error);
    theirContact = contact.data.id;

    const deal = await createDeal(org.ctx, { title: "Their deal", value: 50000, currency: "USD" });
    if (!deal.ok) throw new Error(deal.error);
    theirDeal = deal.data.id;

    const lead = await ingestLead({
      organizationId: org.org.id,
      provider: "GOOGLE",
      source: "EMAIL",
      externalId: "roles-their-lead",
      rawPayload: {},
      normalized: { firstName: "Their", lastName: "Lead", email: "their@lead.test" },
    });
    if (lead.kind !== "created") throw new Error("seed lead");
    theirLead = lead.leadId;
    await db.lead.update({ where: { id: theirLead }, data: { ownerId: org.ctx.userId } });

    // Owned by the rep.
    const own = await createContact(rep(), { firstName: "Reps", lastName: "Own" });
    if (!own.ok) throw new Error(own.error);
    ownContact = own.data.id;
  });

  afterAll(async () => {
    await dropOrg(org.org.id);
  });

  describe("the rule itself", () => {
    it("scopes only REP", () => {
      expect(seesAllRecords(as("REP"))).toBe(false);
      expect(visibleTo(as("REP"))).toEqual({ ownerId: org.ctx.userId });

      for (const role of ["MANAGER", "ADMIN", "OWNER"] as const) {
        expect(seesAllRecords(as(role))).toBe(true);
        expect(visibleTo(as(role))).toEqual({});
      }
    });

    it("leaves READ_ONLY able to see everything", () => {
      // An oversight role that owns nothing would see nothing if scoped, which
      // would make it useless. It is blocked from writing instead.
      expect(seesAllRecords(as("READ_ONLY"))).toBe(true);
    });
  });

  describe("a REP sees only their own records", () => {
    it("lists", async () => {
      const contacts = await listContacts(rep(), {});
      expect(contacts.rows.map((r) => r.id)).toEqual([ownContact]);

      const deals = await listDeals(rep(), { open: "all" });
      expect(deals.rows.map((d) => d.id)).not.toContain(theirDeal);

      const leads = await listLeads(rep(), {});
      expect(leads.rows.map((l) => l.id)).not.toContain(theirLead);
    });

    it("single-record reads return not-found, not a permission error", async () => {
      // Distinguishing "forbidden" from "missing" leaks that the record exists.
      await expect(getContact(rep(), theirContact)).resolves.toBeNull();
      await expect(getDeal(rep(), theirDeal)).resolves.toBeNull();
      await expect(getContact(rep(), ownContact)).resolves.not.toBeNull();
    });

    it("cannot widen the list by passing someone else's ownerId", async () => {
      const deals = await listDeals(rep(), { open: "all", ownerId: org.ctx.userId });
      expect(deals.rows).toHaveLength(0);
    });

    it("search does not leak across owners", async () => {
      const hits = await searchEverything(rep(), "Elses");
      expect(hits).toHaveLength(0);

      const own = await searchEverything(rep(), "Reps");
      expect(own.length).toBeGreaterThan(0);
    });

    it("the pipeline board shows only their deals", async () => {
      const board = await getPipelineBoard(rep());
      const ids = board?.stages.flatMap((s) => s.deals.map((d) => d.id)) ?? [];
      expect(ids).not.toContain(theirDeal);
      // Stages still render, so the board is not empty chrome.
      expect(board?.stages.length).toBeGreaterThan(0);
    });

    it("the dashboard counts only what they can see", async () => {
      const mine = await getDashboard(rep());
      const all = await getDashboard(org.ctx);
      expect(mine.contacts).toBeLessThan(all.contacts);
      expect(mine.needsAttention.every((l) => l.id !== theirLead)).toBe(true);
    });

    it("tasks cannot be widened to everyone", async () => {
      await createTask(org.ctx, { title: "Owner's task" });
      const all = await listTasks(rep(), { scope: "all", state: "open" });
      expect(all.every((t) => t.assignee?.id === repId)).toBe(true);
    });
  });

  describe("a REP cannot act on records they do not own", () => {
    it("update falls through to not-found", async () => {
      const result = await updateContact(rep(), theirContact, { firstName: "Hijacked" });
      expect(result.ok).toBe(false);

      const untouched = await db.contact.findUniqueOrThrow({ where: { id: theirContact } });
      expect(untouched.firstName).toBe("Someone");
    });

    it("cannot edit or move someone else's deal", async () => {
      const edit = await updateDeal(rep(), theirDeal, { value: 1 });
      expect(edit.ok).toBe(false);

      const stage = await db.stage.findFirstOrThrow({
        where: { pipelineId: org.pipeline.id, isWon: true },
      });
      const move = await moveDealToStage(rep(), theirDeal, stage.id);
      expect(move.ok).toBe(false);

      const deal = await db.deal.findUniqueOrThrow({ where: { id: theirDeal } });
      expect(Number(deal.value)).toBe(50000);
    });

    it("cannot log activity onto their timeline", async () => {
      const result = await logActivity(rep(), {
        type: "NOTE",
        body: "Snooping",
        contactId: theirContact,
      });
      expect(result.ok).toBe(false);
    });

    it("cannot bulk-reassign leads they do not own", async () => {
      const result = await bulkAssignLeads(rep(), [theirLead], repId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.succeeded).toBe(0);

      const lead = await db.lead.findUniqueOrThrow({ where: { id: theirLead } });
      expect(lead.ownerId).toBe(org.ctx.userId);
    });

    it("can still attach a contact to a company somebody else owns", async () => {
      // Otherwise a rep cannot file a new contact under an existing account.
      const company = await createCompany(org.ctx, { name: "Shared Account" });
      if (!company.ok) throw new Error(company.error);

      const made = await createContact(rep(), {
        firstName: "Filed",
        lastName: "Under",
        companyId: company.data.id,
      });
      expect(made.ok).toBe(true);
    });
  });

  describe("deleting requires MANAGER, for one record or many", () => {
    it("a REP is refused both paths", async () => {
      await expect(softDeleteContact(rep(), ownContact)).rejects.toThrow(/permission/i);
      await expect(bulkDeleteContacts(rep(), [ownContact])).rejects.toThrow(/permission/i);

      const alive = await db.contact.findUniqueOrThrow({ where: { id: ownContact } });
      expect(alive.deletedAt).toBeNull();
    });

    it("a MANAGER may delete", async () => {
      const made = await createContact(org.ctx, { firstName: "Removable" });
      if (!made.ok) throw new Error(made.error);

      const result = await softDeleteContact(as("MANAGER"), made.data.id);
      expect(result.ok).toBe(true);
    });

    it("a READ_ONLY user is still refused", async () => {
      await expect(softDeleteContact(as("READ_ONLY"), theirContact)).rejects.toThrow(/permission/i);
    });
  });

  describe("unchanged and still correct", () => {
    it("READ_ONLY cannot write but can read the whole org", async () => {
      const ro = as("READ_ONLY");
      await expect(createContact(ro, { firstName: "No" })).rejects.toThrow(/permission/i);
      const { rows } = await listContacts(ro, {});
      expect(rows.length).toBeGreaterThan(1);
    });

    it("admin surfaces stay ADMIN-only", async () => {
      const { updateOrganization } = await import("@/server/services/settings");
      const { inviteMember } = await import("@/server/services/team");

      for (const role of ["REP", "MANAGER", "READ_ONLY"] as const) {
        await expect(
          updateOrganization(as(role), {
            name: "X",
            slaFirstTouchMinutes: 5,
            slaEscalateMinutes: 10,
          }),
        ).rejects.toThrow(/permission/i);
        await expect(inviteMember(as(role), { email: "x@y.test", role: "REP" })).rejects.toThrow(
          /permission/i,
        );
      }
    });

    it("companies remain visible to a rep who owns none", async () => {
      // Accounts are shared context; scoping them would stop a rep filing a
      // contact under an existing company.
      const { rows } = await listCompanies(rep(), {});
      expect(rows.length).toBeGreaterThan(0);
      await expect(getCompany(rep(), rows[0].id)).resolves.not.toBeNull();
    });
  });
});
