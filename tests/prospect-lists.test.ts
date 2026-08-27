import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import type { Ctx } from "@/server/authz";
import { createSegment } from "@/server/services/segments";
import {
  MAX_ADD_MEMBERS,
  addFromSegment,
  addMembers,
  createProspectList,
  deleteProspectList,
  getProspectList,
  listMembers,
  listProspectLists,
  removeMembers,
  renameProspectList,
} from "@/server/services/prospect-lists";
import { dropOrg, makeOrg } from "./factories";

/** List names collide per org, so every test gets its own. */
const uniqueName = (label: string) => `${label}-${randomUUID().slice(0, 8)}`;

/** Creates a list and returns its id, failing loudly if the service refused. */
async function makeList(ctx: Ctx, input: Record<string, unknown> = {}) {
  const result = await createProspectList(ctx, { name: uniqueName("List"), ...input });
  if (!result.ok) throw new Error(result.error);
  return result.data.id;
}

async function makeSegment(ctx: Ctx, input: Record<string, unknown>) {
  const result = await createSegment(ctx, { name: uniqueName("Segment"), ...input });
  if (!result.ok) throw new Error(result.error);
  return result.data.id;
}

/** Members, unwrapped — a list that will not read is a test failure, not an empty page. */
async function membersOf(ctx: Ctx, listId: string, opts?: { page?: number; perPage?: number }) {
  const result = await listMembers(ctx, listId, opts);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

async function countOf(ctx: Ctx, listId: string) {
  const result = await getProspectList(ctx, listId);
  if (!result.ok) throw new Error(result.error);
  return result.data.memberCount;
}

describe("prospect lists", () => {
  let org: Awaited<ReturnType<typeof makeOrg>>;
  let other: Awaited<ReturnType<typeof makeOrg>>;

  let repCtx: Ctx;
  let managerCtx: Ctx;
  let readOnlyCtx: Ctx;

  // Contacts and leads split across two owners, so a REP's view is a strict
  // subset of the OWNER's and "only what you can see" is testable.
  let ownerContactA: string;
  let ownerContactB: string;
  let repContact: string;
  let deletedContact: string;

  let ownerLead: string;
  let repLead: string;

  let companyId: string;
  let otherOrgContact: string;

  beforeAll(async () => {
    org = await makeOrg();
    other = await makeOrg();

    const rep = await db.user.create({
      data: {
        organizationId: org.org.id,
        email: `rep-${randomUUID().slice(0, 8)}@test.local`,
        role: "REP",
        passwordHash: "not-used-in-these-tests",
      },
    });
    repCtx = { userId: rep.id, organizationId: org.org.id, role: "REP" };

    const manager = await db.user.create({
      data: {
        organizationId: org.org.id,
        email: `manager-${randomUUID().slice(0, 8)}@test.local`,
        role: "MANAGER",
        passwordHash: "not-used-in-these-tests",
      },
    });
    managerCtx = { userId: manager.id, organizationId: org.org.id, role: "MANAGER" };

    readOnlyCtx = { ...org.ctx, role: "READ_ONLY" };

    const contact = (data: Record<string, unknown>) =>
      db.contact.create({
        data: { organizationId: org.org.id, ...data } as never,
        select: { id: true },
      });

    ownerContactA = (
      await contact({
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.test",
        ownerId: org.user.id,
      })
    ).id;
    ownerContactB = (
      await contact({ firstName: "Grace", lastName: "Hopper", ownerId: org.user.id })
    ).id;
    repContact = (
      await contact({
        firstName: "Rep",
        lastName: "Contact",
        email: "rep-contact@example.test",
        ownerId: rep.id,
      })
    ).id;
    deletedContact = (
      await contact({ firstName: "Gone", ownerId: org.user.id, deletedAt: new Date() })
    ).id;

    const lead = (data: Record<string, unknown>) =>
      db.lead.create({
        data: {
          organizationId: org.org.id,
          source: "WEB_FORM",
          status: "NEW",
          dedupeKey: `lead-${randomUUID()}`,
          ...data,
        } as never,
        select: { id: true },
      });

    ownerLead = (
      await lead({ firstName: "Owner", lastName: "Lead", email: "ol@example.test", ownerId: org.user.id })
    ).id;
    // No name at all — the web-form case the row mapper has to fall back for.
    repLead = (await lead({ email: "rl@example.test", companyName: "Repco", ownerId: rep.id })).id;

    companyId = (
      await db.company.create({
        data: { organizationId: org.org.id, name: "Acme", ownerId: org.user.id },
        select: { id: true },
      })
    ).id;

    otherOrgContact = (
      await db.contact.create({
        data: { organizationId: other.org.id, firstName: "Theirs", ownerId: other.user.id },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    await dropOrg(org.org.id);
    await dropOrg(other.org.id);
  });

  describe("lifecycle", () => {
    it("creates a list owned by the caller and lists it with a member count", async () => {
      const name = uniqueName("Q3 push");
      const created = await createProspectList(org.ctx, { name, description: "Everyone for Q3" });
      if (!created.ok) throw new Error(created.error);

      const listed = (await listProspectLists(org.ctx)).find((l) => l.id === created.data.id);
      expect(listed).toMatchObject({
        name,
        description: "Everyone for Q3",
        ownerId: org.user.id,
        memberCount: 0,
      });
      expect(listed?.createdAt).toBeInstanceOf(Date);
    });

    it("treats a missing and an empty description as no description", async () => {
      const bare = await getProspectList(org.ctx, await makeList(org.ctx));
      if (!bare.ok) throw new Error(bare.error);
      expect(bare.data.description).toBeNull();

      const blank = await getProspectList(org.ctx, await makeList(org.ctx, { description: "  " }));
      if (!blank.ok) throw new Error(blank.error);
      expect(blank.data.description).toBeNull();
    });

    it("trims the name rather than storing the padding", async () => {
      const name = uniqueName("Padded");
      const created = await createProspectList(org.ctx, { name: `   ${name}   ` });
      if (!created.ok) throw new Error(created.error);

      const row = await db.prospectList.findUniqueOrThrow({ where: { id: created.data.id } });
      expect(row.name).toBe(name);
    });

    it("rejects a blank name and one over 60 characters", async () => {
      expect((await createProspectList(org.ctx, { name: "  " })).ok).toBe(false);
      expect((await createProspectList(org.ctx, { name: "x".repeat(61) })).ok).toBe(false);
    });

    it("renames a list and leaves the description alone unless asked", async () => {
      const id = await makeList(org.ctx, { description: "Keep me" });
      const renamed = uniqueName("Renamed");

      expect((await renameProspectList(org.ctx, id, { name: renamed })).ok).toBe(true);

      const row = await db.prospectList.findUniqueOrThrow({ where: { id } });
      expect(row.name).toBe(renamed);
      expect(row.description).toBe("Keep me");
    });

    it("clears the description when the rename says to", async () => {
      const id = await makeList(org.ctx, { description: "Temporary" });

      expect(
        (await renameProspectList(org.ctx, id, { name: uniqueName("Cleared"), description: "" })).ok,
      ).toBe(true);
      expect((await db.prospectList.findUniqueOrThrow({ where: { id } })).description).toBeNull();
    });

    it("deletes a list and its membership rows, leaving the records alone", async () => {
      const id = await makeList(org.ctx);
      await addMembers(org.ctx, id, { contactIds: [ownerContactA] });

      expect((await deleteProspectList(org.ctx, id)).ok).toBe(true);
      expect(await db.prospectList.count({ where: { id } })).toBe(0);
      expect(await db.prospectListMember.count({ where: { listId: id } })).toBe(0);
      expect(await db.contact.count({ where: { id: ownerContactA } })).toBe(1);
    });

    it("audits create, rename and delete", async () => {
      const id = await makeList(org.ctx);
      await renameProspectList(org.ctx, id, { name: uniqueName("Audited") });
      await deleteProspectList(org.ctx, id);

      const entries = await db.auditLog.findMany({
        where: { organizationId: org.org.id, entity: "ProspectList", entityId: id },
        orderBy: { at: "asc" },
        select: { action: true, actorId: true },
      });
      expect(entries.map((e) => e.action)).toEqual(["create", "rename", "delete"]);
      expect(entries.every((e) => e.actorId === org.user.id)).toBe(true);
    });

    it("reports a missing list as not found", async () => {
      const result = await getProspectList(org.ctx, "list-does-not-exist");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/not found/i);
    });
  });

  describe("name uniqueness", () => {
    it("refuses a duplicate name regardless of case", async () => {
      const name = uniqueName("Champions");
      await createProspectList(org.ctx, { name });

      const result = await createProspectList(org.ctx, { name: name.toUpperCase() });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/already exists/i);

      const count = await db.prospectList.count({
        where: { organizationId: org.org.id, name: { equals: name, mode: "insensitive" } },
      });
      expect(count).toBe(1);
    });

    it("lets another org use the same name", async () => {
      const name = uniqueName("Cross org");
      expect((await createProspectList(org.ctx, { name })).ok).toBe(true);
      expect((await createProspectList(other.ctx, { name })).ok).toBe(true);
    });

    it("lets a list re-case its own name", async () => {
      const name = uniqueName("recasing");
      const id = await makeList(org.ctx, { name });

      expect((await renameProspectList(org.ctx, id, { name: name.toUpperCase() })).ok).toBe(true);
      expect((await db.prospectList.findUniqueOrThrow({ where: { id } })).name).toBe(
        name.toUpperCase(),
      );
    });

    it("refuses a rename onto an existing name regardless of case", async () => {
      const taken = uniqueName("Taken");
      await createProspectList(org.ctx, { name: taken });
      const id = await makeList(org.ctx);

      const result = await renameProspectList(org.ctx, id, { name: taken.toLowerCase() });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/already exists/i);
    });
  });

  describe("adding members", () => {
    it("adds contacts and leads in one call", async () => {
      const id = await makeList(org.ctx);

      const result = await addMembers(org.ctx, id, {
        contactIds: [ownerContactA, ownerContactB],
        leadIds: [ownerLead],
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data).toEqual({ added: 3, skipped: 0 });

      expect(await countOf(org.ctx, id)).toBe(3);
    });

    it("is idempotent — re-adding is a skip, not a duplicate and not an error", async () => {
      const id = await makeList(org.ctx);
      await addMembers(org.ctx, id, { contactIds: [ownerContactA], leadIds: [ownerLead] });

      const again = await addMembers(org.ctx, id, {
        contactIds: [ownerContactA, ownerContactB],
        leadIds: [ownerLead],
      });
      expect(again.ok).toBe(true);
      if (again.ok) expect(again.data).toEqual({ added: 1, skipped: 2 });

      expect(await db.prospectListMember.count({ where: { listId: id } })).toBe(3);
    });

    it("counts the same id twice as one add", async () => {
      const id = await makeList(org.ctx);

      const result = await addMembers(org.ctx, id, {
        contactIds: [ownerContactA, ownerContactA],
      });
      if (!result.ok) throw new Error(result.error);
      expect(result.data).toEqual({ added: 1, skipped: 0 });
    });

    it("keeps the same contact on two different lists", async () => {
      const first = await makeList(org.ctx);
      const second = await makeList(org.ctx);

      expect((await addMembers(org.ctx, first, { contactIds: [ownerContactA] })).ok).toBe(true);
      const onSecond = await addMembers(org.ctx, second, { contactIds: [ownerContactA] });
      if (!onSecond.ok) throw new Error(onSecond.error);
      expect(onSecond.data.added).toBe(1);
    });

    it("skips ids that do not exist, are soft-deleted, or belong to another org", async () => {
      const id = await makeList(org.ctx);

      const result = await addMembers(org.ctx, id, {
        contactIds: [ownerContactA, deletedContact, otherOrgContact, "no-such-contact"],
      });
      if (!result.ok) throw new Error(result.error);
      expect(result.data).toEqual({ added: 1, skipped: 3 });

      const rows = await db.prospectListMember.findMany({ where: { listId: id } });
      expect(rows.map((r) => r.contactId)).toEqual([ownerContactA]);
    });

    it("stamps a whole batch with one addedAt, injectable for tests", async () => {
      const id = await makeList(org.ctx);
      const pinned = new Date("2026-03-01T09:00:00.000Z");

      await addMembers(org.ctx, id, { contactIds: [ownerContactA, ownerContactB] }, pinned);

      const rows = await db.prospectListMember.findMany({
        where: { listId: id },
        select: { addedAt: true },
      });
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.addedAt.getTime() === pinned.getTime())).toBe(true);
    });

    it("refuses an empty selection and one over the cap", async () => {
      const id = await makeList(org.ctx);

      const empty = await addMembers(org.ctx, id, {});
      expect(empty.ok).toBe(false);
      if (!empty.ok) expect(empty.error).toMatch(/nothing selected/i);

      const tooMany = await addMembers(org.ctx, id, {
        contactIds: Array.from({ length: MAX_ADD_MEMBERS + 1 }, (_, i) => `id-${i}`),
      });
      expect(tooMany.ok).toBe(false);
      if (!tooMany.ok) expect(tooMany.error).toMatch(new RegExp(String(MAX_ADD_MEMBERS)));

      // The cap counts ids offered, so nothing was written on the way to the refusal.
      expect(await db.prospectListMember.count({ where: { listId: id } })).toBe(0);
    });

    it("counts contacts and leads together against the cap", async () => {
      const id = await makeList(org.ctx);
      // Split so neither half is over the cap on its own but the pair is.
      const half = Math.ceil((MAX_ADD_MEMBERS + 1) / 2);

      const result = await addMembers(org.ctx, id, {
        contactIds: Array.from({ length: half }, (_, i) => `c-${i}`),
        leadIds: Array.from({ length: half }, (_, i) => `l-${i}`),
      });
      expect(result.ok).toBe(false);
    });
  });

  describe("only records the caller can see", () => {
    it("adds a REP's own records and silently skips a colleague's", async () => {
      const id = await makeList(repCtx);

      const result = await addMembers(repCtx, id, {
        contactIds: [repContact, ownerContactA, ownerContactB],
        leadIds: [repLead, ownerLead],
      });
      // Not "forbidden": a rep adding a big selection gets what they can see.
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data).toEqual({ added: 2, skipped: 3 });

      const rows = await db.prospectListMember.findMany({
        where: { listId: id },
        select: { contactId: true, leadId: true },
      });
      expect(rows.map((r) => r.contactId).filter(Boolean)).toEqual([repContact]);
      expect(rows.map((r) => r.leadId).filter(Boolean)).toEqual([repLead]);
      // Nothing the rep cannot see ended up on the list.
      expect(rows.some((r) => r.contactId === ownerContactA)).toBe(false);
    });

    it("hides members a REP cannot see from the page and the count", async () => {
      const id = await makeList(org.ctx);
      await addMembers(org.ctx, id, {
        contactIds: [ownerContactA, repContact],
        leadIds: [ownerLead, repLead],
      });

      expect(await countOf(org.ctx, id)).toBe(4);
      expect(await countOf(repCtx, id)).toBe(2);

      const asRep = await membersOf(repCtx, id);
      expect(asRep.total).toBe(2);
      expect(asRep.rows.map((r) => r.recordId).sort()).toEqual([repContact, repLead].sort());

      // The listing agrees with the count the same caller is shown.
      const listed = (await listProspectLists(repCtx)).find((l) => l.id === id);
      expect(listed?.memberCount).toBe(2);
    });

    it("drops a member whose record is soft-deleted after it was added", async () => {
      const id = await makeList(org.ctx);
      const doomed = await db.contact.create({
        data: { organizationId: org.org.id, firstName: "Doomed", ownerId: org.user.id },
        select: { id: true },
      });
      await addMembers(org.ctx, id, { contactIds: [doomed.id] });
      expect(await countOf(org.ctx, id)).toBe(1);

      await db.contact.update({ where: { id: doomed.id }, data: { deletedAt: new Date() } });

      expect(await countOf(org.ctx, id)).toBe(0);
      expect((await membersOf(org.ctx, id)).rows).toEqual([]);

      await db.contact.delete({ where: { id: doomed.id } });
    });
  });

  describe("reading members", () => {
    it("renders a row per member with a name and an email", async () => {
      const id = await makeList(org.ctx);
      await addMembers(org.ctx, id, { contactIds: [ownerContactA], leadIds: [repLead] });

      const { rows } = await membersOf(org.ctx, id);
      const contactRow = rows.find((r) => r.kind === "CONTACT");
      expect(contactRow).toMatchObject({
        kind: "CONTACT",
        recordId: ownerContactA,
        name: "Ada Lovelace",
        email: "ada@example.test",
      });
      expect(contactRow?.addedAt).toBeInstanceOf(Date);

      // A nameless web-form lead falls back to its company.
      expect(rows.find((r) => r.kind === "LEAD")).toMatchObject({
        recordId: repLead,
        name: "Repco",
        email: "rl@example.test",
      });
    });

    it("pages, newest addition first", async () => {
      const id = await makeList(org.ctx);
      // Distinct timestamps so "newest first" is an assertion, not a coin toss.
      await addMembers(org.ctx, id, { contactIds: [ownerContactA] }, new Date("2026-01-01T00:00:00Z"));
      await addMembers(org.ctx, id, { contactIds: [ownerContactB] }, new Date("2026-02-01T00:00:00Z"));
      await addMembers(org.ctx, id, { leadIds: [ownerLead] }, new Date("2026-03-01T00:00:00Z"));

      const first = await membersOf(org.ctx, id, { page: 1, perPage: 2 });
      expect(first).toMatchObject({ total: 3, page: 1, perPage: 2 });
      expect(first.rows.map((r) => r.recordId)).toEqual([ownerLead, ownerContactB]);

      const second = await membersOf(org.ctx, id, { page: 2, perPage: 2 });
      expect(second.rows.map((r) => r.recordId)).toEqual([ownerContactA]);
    });

    it("degrades a nonsense page rather than throwing", async () => {
      const id = await makeList(org.ctx);
      const page = await membersOf(org.ctx, id, { page: -4, perPage: 10_000 });
      expect(page.page).toBe(1);
      expect(page.perPage).toBe(25);
    });
  });

  describe("removing members", () => {
    it("removes by member id and leaves the record alone", async () => {
      const id = await makeList(org.ctx);
      await addMembers(org.ctx, id, { contactIds: [ownerContactA, ownerContactB] });

      const { rows } = await membersOf(org.ctx, id);
      const target = rows.find((r) => r.recordId === ownerContactA);

      const result = await removeMembers(org.ctx, id, [target!.id]);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.removed).toBe(1);

      expect((await membersOf(org.ctx, id)).rows.map((r) => r.recordId)).toEqual([ownerContactB]);
      expect(await db.contact.count({ where: { id: ownerContactA } })).toBe(1);

      // Re-adding after a removal works — nothing is tombstoned.
      const readd = await addMembers(org.ctx, id, { contactIds: [ownerContactA] });
      if (!readd.ok) throw new Error(readd.error);
      expect(readd.data.added).toBe(1);
    });

    it("removes nothing for an unknown id and refuses an empty selection", async () => {
      const id = await makeList(org.ctx);
      await addMembers(org.ctx, id, { contactIds: [ownerContactA] });

      const unknown = await removeMembers(org.ctx, id, ["member-does-not-exist"]);
      if (!unknown.ok) throw new Error(unknown.error);
      expect(unknown.data.removed).toBe(0);

      expect((await removeMembers(org.ctx, id, [])).ok).toBe(false);
    });

    it("will not let a REP remove a member they cannot see", async () => {
      const id = await makeList(org.ctx);
      await addMembers(org.ctx, id, { contactIds: [ownerContactA, repContact] });

      const asOwner = await membersOf(org.ctx, id);
      const hidden = asOwner.rows.find((r) => r.recordId === ownerContactA)!;

      const result = await removeMembers(repCtx, id, [hidden.id]);
      if (!result.ok) throw new Error(result.error);
      expect(result.data.removed).toBe(0);
      expect(await db.prospectListMember.count({ where: { id: hidden.id } })).toBe(1);
    });

    it("does not remove a member of a different list with a borrowed id", async () => {
      const mine = await makeList(org.ctx);
      const theirs = await makeList(org.ctx);
      await addMembers(org.ctx, theirs, { contactIds: [ownerContactA] });

      const borrowed = (await membersOf(org.ctx, theirs)).rows[0];
      const result = await removeMembers(org.ctx, mine, [borrowed.id]);
      if (!result.ok) throw new Error(result.error);
      expect(result.data.removed).toBe(0);
      expect(await db.prospectListMember.count({ where: { id: borrowed.id } })).toBe(1);
    });
  });

  describe("adding from a segment", () => {
    it("fills a list from a contact segment", async () => {
      const id = await makeList(org.ctx);
      const segment = await makeSegment(org.ctx, { entity: "CONTACT", filter: {} });

      const result = await addFromSegment(org.ctx, id, segment);
      if (!result.ok) throw new Error(result.error);
      expect(result.data.entity).toBe("CONTACT");
      expect(result.data.added).toBe(3); // the soft-deleted one is not a prospect
      expect(result.data.skipped).toBe(0);

      const { rows } = await membersOf(org.ctx, id);
      expect(rows.every((r) => r.kind === "CONTACT")).toBe(true);
      expect(rows.map((r) => r.recordId)).not.toContain(deletedContact);
    });

    it("fills a list from a lead segment", async () => {
      const id = await makeList(org.ctx);
      const segment = await makeSegment(org.ctx, { entity: "LEAD", filter: { status: ["NEW"] } });

      const result = await addFromSegment(org.ctx, id, segment);
      if (!result.ok) throw new Error(result.error);
      expect(result.data).toMatchObject({ entity: "LEAD", added: 2, skipped: 0 });
    });

    it("refuses a COMPANY segment rather than silently adding nothing", async () => {
      const id = await makeList(org.ctx);
      const segment = await makeSegment(org.ctx, { entity: "COMPANY", filter: {} });

      const result = await addFromSegment(org.ctx, id, segment);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/company/i);

      expect(await db.prospectListMember.count({ where: { listId: id } })).toBe(0);
      // The company itself is untouched and was never a candidate.
      expect(await db.company.count({ where: { id: companyId } })).toBe(1);
    });

    it("is idempotent against a second run of the same segment", async () => {
      const id = await makeList(org.ctx);
      const segment = await makeSegment(org.ctx, { entity: "CONTACT", filter: {} });

      const first = await addFromSegment(org.ctx, id, segment);
      if (!first.ok) throw new Error(first.error);
      const second = await addFromSegment(org.ctx, id, segment);
      if (!second.ok) throw new Error(second.error);

      expect(second.data.added).toBe(0);
      expect(second.data.skipped).toBe(first.data.added);
      expect(await db.prospectListMember.count({ where: { listId: id } })).toBe(first.data.added);
    });

    it("passes its limit through to the segment resolver", async () => {
      const id = await makeList(org.ctx);
      const segment = await makeSegment(org.ctx, { entity: "CONTACT", filter: {} });

      const result = await addFromSegment(org.ctx, id, segment, { limit: 1 });
      if (!result.ok) throw new Error(result.error);
      expect(result.data.added).toBe(1);
      expect(await db.prospectListMember.count({ where: { listId: id } })).toBe(1);
    });

    it("gives a REP only their own records out of an OWNER's shared segment", async () => {
      const id = await makeList(repCtx);
      const segment = await makeSegment(org.ctx, { entity: "CONTACT", filter: {} });

      const result = await addFromSegment(repCtx, id, segment);
      if (!result.ok) throw new Error(result.error);
      expect(result.data.added).toBe(1);

      const rows = await db.prospectListMember.findMany({
        where: { listId: id },
        select: { contactId: true },
      });
      expect(rows.map((r) => r.contactId)).toEqual([repContact]);
    });

    it("refuses another org's segment id", async () => {
      const id = await makeList(org.ctx);
      const theirs = await makeSegment(other.ctx, { entity: "CONTACT", filter: {} });

      const result = await addFromSegment(org.ctx, id, theirs);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/not found/i);
      expect(await db.prospectListMember.count({ where: { listId: id } })).toBe(0);
    });

    it("refuses a segment on a list that is not the caller's", async () => {
      const theirList = await makeList(other.ctx);
      const segment = await makeSegment(org.ctx, { entity: "CONTACT", filter: {} });

      const result = await addFromSegment(org.ctx, theirList, segment);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/not found/i);
      expect(await db.prospectListMember.count({ where: { listId: theirList } })).toBe(0);
    });
  });

  describe("permissions", () => {
    it("lets a REP create, rename, add and remove", async () => {
      const id = await makeList(repCtx);

      expect((await renameProspectList(repCtx, id, { name: uniqueName("Mine") })).ok).toBe(true);

      const added = await addMembers(repCtx, id, { contactIds: [repContact] });
      if (!added.ok) throw new Error(added.error);
      expect(added.data.added).toBe(1);

      const member = (await membersOf(repCtx, id)).rows[0];
      const removed = await removeMembers(repCtx, id, [member.id]);
      if (!removed.ok) throw new Error(removed.error);
      expect(removed.data.removed).toBe(1);
    });

    it("lets a REP rename a list someone else owns — a list is team property", async () => {
      const id = await makeList(org.ctx);
      expect((await renameProspectList(repCtx, id, { name: uniqueName("Retitled") })).ok).toBe(true);
    });

    it("lets a REP delete their own list", async () => {
      const id = await makeList(repCtx);

      expect((await deleteProspectList(repCtx, id)).ok).toBe(true);
      expect(await db.prospectList.count({ where: { id } })).toBe(0);
    });

    it("refuses a REP deleting someone else's list", async () => {
      const id = await makeList(org.ctx);

      await expect(deleteProspectList(repCtx, id)).rejects.toThrow(/permission|owner/i);
      expect(await db.prospectList.count({ where: { id } })).toBe(1);
    });

    it("lets a MANAGER delete a list they do not own", async () => {
      const id = await makeList(org.ctx);

      expect((await deleteProspectList(managerCtx, id)).ok).toBe(true);
      expect(await db.prospectList.count({ where: { id } })).toBe(0);
    });

    it("refuses a READ_ONLY user every mutation but allows reads", async () => {
      const id = await makeList(org.ctx);
      const segment = await makeSegment(org.ctx, { entity: "CONTACT", filter: {} });

      await expect(createProspectList(readOnlyCtx, { name: uniqueName("Nope") })).rejects.toThrow(
        /permission/i,
      );
      await expect(renameProspectList(readOnlyCtx, id, { name: uniqueName("Nope") })).rejects.toThrow(
        /permission/i,
      );
      await expect(deleteProspectList(readOnlyCtx, id)).rejects.toThrow(/permission/i);
      await expect(
        addMembers(readOnlyCtx, id, { contactIds: [ownerContactA] }),
      ).rejects.toThrow(/permission/i);
      await expect(removeMembers(readOnlyCtx, id, ["anything"])).rejects.toThrow(/permission/i);
      await expect(addFromSegment(readOnlyCtx, id, segment)).rejects.toThrow(/permission/i);

      // Reading is the whole role.
      expect((await getProspectList(readOnlyCtx, id)).ok).toBe(true);
      expect((await listMembers(readOnlyCtx, id)).ok).toBe(true);
    });
  });

  describe("tenant isolation", () => {
    it("does not list another org's lists", async () => {
      const id = await makeList(org.ctx);
      expect((await listProspectLists(other.ctx)).map((l) => l.id)).not.toContain(id);
    });

    it("cannot read or page another org's list", async () => {
      const id = await makeList(org.ctx);

      expect((await getProspectList(other.ctx, id)).ok).toBe(false);
      expect((await listMembers(other.ctx, id)).ok).toBe(false);
    });

    it("cannot rename or delete another org's list", async () => {
      const name = uniqueName("Theirs");
      const id = await makeList(org.ctx, { name });

      const renamed = await renameProspectList(other.ctx, id, { name: uniqueName("Hijacked") });
      expect(renamed.ok).toBe(false);
      if (!renamed.ok) expect(renamed.error).toMatch(/not found/i);

      const deleted = await deleteProspectList(other.ctx, id);
      expect(deleted.ok).toBe(false);

      const row = await db.prospectList.findUniqueOrThrow({ where: { id } });
      expect(row.name).toBe(name);
    });

    it("cannot add to or remove from another org's list", async () => {
      const id = await makeList(org.ctx);
      await addMembers(org.ctx, id, { contactIds: [ownerContactA] });
      const member = (await membersOf(org.ctx, id)).rows[0];

      const added = await addMembers(other.ctx, id, { contactIds: [otherOrgContact] });
      expect(added.ok).toBe(false);
      if (!added.ok) expect(added.error).toMatch(/not found/i);

      const removed = await removeMembers(other.ctx, id, [member.id]);
      expect(removed.ok).toBe(false);

      expect(await db.prospectListMember.count({ where: { listId: id } })).toBe(1);
    });

    it("never puts another org's record on a list", async () => {
      const id = await makeList(org.ctx);

      const result = await addMembers(org.ctx, id, { contactIds: [otherOrgContact] });
      if (!result.ok) throw new Error(result.error);
      expect(result.data).toEqual({ added: 0, skipped: 1 });
      expect(await db.prospectListMember.count({ where: { listId: id } })).toBe(0);
    });
  });
});
