import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import type { Ctx } from "@/server/authz";
import {
  RESOLVE_DEFAULT_LIMIT,
  countSegment,
  createSegment,
  deleteSegment,
  getSegment,
  listSegments,
  resolveSegment,
  segmentWhere,
  updateSegment,
} from "@/server/services/segments";
import { dropOrg, makeOrg } from "./factories";

/** Segment names collide per (org, entity), so every test gets its own. */
const uniqueName = (label: string) => `${label}-${randomUUID().slice(0, 8)}`;

/** Creates a segment and returns its id, failing loudly if the service refused. */
async function makeSegment(ctx: Ctx, input: Record<string, unknown>) {
  const result = await createSegment(ctx, { name: uniqueName("Segment"), ...input });
  if (!result.ok) throw new Error(result.error);
  return result.data.id;
}

/** Count, unwrapped — a segment that will not run is a test failure, not a 0. */
async function countOf(ctx: Ctx, id: string) {
  const result = await countSegment(ctx, id);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

async function idsOf(ctx: Ctx, id: string, opts?: { limit?: number }) {
  const result = await resolveSegment(ctx, id, opts);
  if (!result.ok) throw new Error(result.error);
  return result.data.ids;
}

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

describe("segments", () => {
  let org: Awaited<ReturnType<typeof makeOrg>>;
  let other: Awaited<ReturnType<typeof makeOrg>>;

  let repCtx: Ctx;
  let managerCtx: Ctx;
  let readOnlyCtx: Ctx;

  // Leads: two owned by the OWNER, two by the REP, spread across status,
  // source, score, contactability and age.
  let leadOwnerHot: string;
  let leadOwnerOld: string;
  let leadRepNew: string;
  let leadRepJunk: string;

  let contactOwnerActive: string;
  let contactOwnerStale: string;
  let contactRepNever: string;

  let companyOwned: string;
  let companyRepOwned: string;

  let tagA: string;
  let tagB: string;

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

    const lead = (data: Record<string, unknown>) =>
      db.lead.create({
        data: {
          organizationId: org.org.id,
          dedupeKey: `lead-${randomUUID()}`,
          ...data,
        } as never,
        select: { id: true },
      });

    leadOwnerHot = (
      await lead({
        source: "WEB_FORM",
        status: "NEW",
        score: 90,
        email: "hot@example.test",
        phone: "+15550001",
        ownerId: org.user.id,
      })
    ).id;

    leadOwnerOld = (
      await lead({
        source: "EMAIL",
        status: "WORKING",
        score: 40,
        email: null,
        phone: "+15550002",
        ownerId: org.user.id,
        createdAt: daysAgo(60),
      })
    ).id;

    leadRepNew = (
      await lead({
        source: "WEB_FORM",
        status: "NEW",
        score: 70,
        email: "rep@example.test",
        phone: null,
        ownerId: rep.id,
      })
    ).id;

    leadRepJunk = (
      await lead({
        source: "MANUAL",
        status: "JUNK",
        score: 10,
        email: null,
        phone: null,
        ownerId: rep.id,
        createdAt: daysAgo(100),
      })
    ).id;

    companyOwned = (
      await db.company.create({
        data: { organizationId: org.org.id, name: "Owned Co", ownerId: org.user.id },
        select: { id: true },
      })
    ).id;

    companyRepOwned = (
      await db.company.create({
        data: {
          organizationId: org.org.id,
          name: "Rep Co",
          ownerId: rep.id,
          createdAt: daysAgo(400),
        },
        select: { id: true },
      })
    ).id;

    contactOwnerActive = (
      await db.contact.create({
        data: {
          organizationId: org.org.id,
          firstName: "Active",
          email: "active@example.test",
          phone: "+15550003",
          companyId: companyOwned,
          ownerId: org.user.id,
          lastActivityAt: new Date(),
        },
        select: { id: true },
      })
    ).id;

    contactOwnerStale = (
      await db.contact.create({
        data: {
          organizationId: org.org.id,
          firstName: "Stale",
          email: null,
          phone: "+15550004",
          ownerId: org.user.id,
          lastActivityAt: daysAgo(90),
        },
        select: { id: true },
      })
    ).id;

    contactRepNever = (
      await db.contact.create({
        data: {
          organizationId: org.org.id,
          firstName: "Never",
          email: "never@example.test",
          phone: null,
          companyId: companyOwned,
          ownerId: rep.id,
          lastActivityAt: null,
        },
        select: { id: true },
      })
    ).id;

    tagA = (
      await db.tag.create({
        data: { organizationId: org.org.id, name: uniqueName("A") },
        select: { id: true },
      })
    ).id;
    tagB = (
      await db.tag.create({
        data: { organizationId: org.org.id, name: uniqueName("B") },
        select: { id: true },
      })
    ).id;

    // Both tags on the owner's hot lead, one on the rep's — enough to tell
    // ALL-of from any-of.
    await db.tagging.createMany({
      data: [
        { organizationId: org.org.id, tagId: tagA, leadId: leadOwnerHot },
        { organizationId: org.org.id, tagId: tagB, leadId: leadOwnerHot },
        { organizationId: org.org.id, tagId: tagA, leadId: leadRepNew },
      ],
    });
  });

  afterAll(async () => {
    await dropOrg(org.org.id);
    await dropOrg(other.org.id);
    await db.$disconnect();
  });

  describe("the filter document", () => {
    it("accepts an empty document, meaning everything visible to me", async () => {
      const id = await makeSegment(org.ctx, { entity: "LEAD" });

      const fetched = await getSegment(org.ctx, id);
      expect(fetched.ok).toBe(true);
      if (fetched.ok) expect(fetched.data.filter).toEqual({});

      expect(await countOf(org.ctx, id)).toBe(4);
    });

    it("rejects an unknown key rather than dropping it", async () => {
      const result = await createSegment(org.ctx, {
        name: uniqueName("Typo"),
        entity: "LEAD",
        filter: { statuses: ["NEW"] },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.fieldErrors).toBeDefined();
    });

    it("rejects a filter key belonging to a different entity", async () => {
      const onCompany = await createSegment(org.ctx, {
        name: uniqueName("Wrong"),
        entity: "COMPANY",
        filter: { scoreMin: 50 },
      });
      expect(onCompany.ok).toBe(false);

      // `companyId` is a contact concept — a lead carries a company *name*,
      // not a link to a Company row, so it is not part of the lead vocabulary.
      const onLead = await createSegment(org.ctx, {
        name: uniqueName("Wrong"),
        entity: "LEAD",
        filter: { companyId: "clzzzzzzzzzzzzzzzzzzzzzzz" },
      });
      expect(onLead.ok).toBe(false);
    });

    it("rejects Prisma operators smuggled into the document", async () => {
      const result = await createSegment(org.ctx, {
        name: uniqueName("Crafted"),
        entity: "LEAD",
        filter: { OR: [{ organizationId: other.org.id }] },
      });
      expect(result.ok).toBe(false);

      expect(() => segmentWhere(org.ctx, "LEAD", { OR: [{ id: leadOwnerHot }] })).toThrow(
        /not a valid/i,
      );
    });

    it("rejects an inverted score range and an unknown enum value", async () => {
      const inverted = await createSegment(org.ctx, {
        name: uniqueName("Inverted"),
        entity: "LEAD",
        filter: { scoreMin: 80, scoreMax: 20 },
      });
      expect(inverted.ok).toBe(false);

      const badStatus = await createSegment(org.ctx, {
        name: uniqueName("BadStatus"),
        entity: "LEAD",
        filter: { status: ["SORT_OF_INTERESTED"] },
      });
      expect(badStatus.ok).toBe(false);
    });

    it("rejects an entity that is not one of the three", async () => {
      const result = await createSegment(org.ctx, { name: uniqueName("Alien"), entity: "DEAL" });
      expect(result.ok).toBe(false);
    });
  });

  describe("lifecycle", () => {
    it("creates a shared segment owned by the caller and lists it", async () => {
      const name = uniqueName("Hot leads");
      const created = await createSegment(org.ctx, {
        name,
        entity: "LEAD",
        filter: { status: ["NEW"] },
      });
      if (!created.ok) throw new Error(created.error);

      const listed = (await listSegments(org.ctx)).find((s) => s.id === created.data.id);
      expect(listed).toMatchObject({ name, entity: "LEAD", shared: true, ownerId: org.user.id });
    });

    it("filters the list by entity", async () => {
      const leadSegment = await makeSegment(org.ctx, { entity: "LEAD" });
      const companySegment = await makeSegment(org.ctx, { entity: "COMPANY" });

      const companies = await listSegments(org.ctx, "COMPANY");
      expect(companies.map((s) => s.id)).toContain(companySegment);
      expect(companies.map((s) => s.id)).not.toContain(leadSegment);
    });

    it("trims the name rather than storing the padding", async () => {
      const name = uniqueName("Padded");
      const created = await createSegment(org.ctx, { name: `   ${name}   `, entity: "CONTACT" });
      if (!created.ok) throw new Error(created.error);

      const row = await db.segment.findUniqueOrThrow({ where: { id: created.data.id } });
      expect(row.name).toBe(name);
    });

    it("rejects a blank name and one over 60 characters", async () => {
      expect((await createSegment(org.ctx, { name: "  ", entity: "LEAD" })).ok).toBe(false);
      expect((await createSegment(org.ctx, { name: "x".repeat(61), entity: "LEAD" })).ok).toBe(false);
    });

    it("updates name, sharing and filter", async () => {
      const id = await makeSegment(org.ctx, { entity: "LEAD", filter: { status: ["NEW"] } });
      const renamed = uniqueName("Renamed");

      const result = await updateSegment(org.ctx, id, {
        name: renamed,
        shared: false,
        filter: { status: ["JUNK"] },
      });
      expect(result.ok).toBe(true);

      const row = await db.segment.findUniqueOrThrow({ where: { id } });
      expect(row.name).toBe(renamed);
      expect(row.shared).toBe(false);
      expect(row.filter).toEqual({ status: ["JUNK"] });
    });

    it("refuses to change a segment's entity", async () => {
      const id = await makeSegment(org.ctx, { entity: "LEAD" });

      const result = await updateSegment(org.ctx, id, { entity: "CONTACT" });
      expect(result.ok).toBe(false);
      expect((await db.segment.findUniqueOrThrow({ where: { id } })).entity).toBe("LEAD");
    });

    it("deletes a segment", async () => {
      const id = await makeSegment(org.ctx, { entity: "COMPANY" });

      expect((await deleteSegment(org.ctx, id)).ok).toBe(true);
      expect(await db.segment.count({ where: { id } })).toBe(0);
    });

    it("audits create, update and delete", async () => {
      const id = await makeSegment(org.ctx, { entity: "LEAD" });
      await updateSegment(org.ctx, id, { shared: false });
      await deleteSegment(org.ctx, id);

      const actions = await db.auditLog.findMany({
        where: { organizationId: org.org.id, entity: "Segment", entityId: id },
        orderBy: { at: "asc" },
        select: { action: true, actorId: true },
      });
      expect(actions.map((a) => a.action)).toEqual(["create", "update", "delete"]);
      expect(actions.every((a) => a.actorId === org.user.id)).toBe(true);
    });

    it("reports a missing segment as not found", async () => {
      const result = await getSegment(org.ctx, "seg-does-not-exist");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/not found/i);
    });
  });

  describe("name uniqueness", () => {
    it("refuses a duplicate name regardless of case", async () => {
      const name = uniqueName("Champions");
      await createSegment(org.ctx, { name, entity: "LEAD" });

      const result = await createSegment(org.ctx, { name: name.toUpperCase(), entity: "LEAD" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/already exists/i);

      const count = await db.segment.count({
        where: {
          organizationId: org.org.id,
          entity: "LEAD",
          name: { equals: name, mode: "insensitive" },
        },
      });
      expect(count).toBe(1);
    });

    it("scopes uniqueness to the entity", async () => {
      const name = uniqueName("Shared name");
      expect((await createSegment(org.ctx, { name, entity: "LEAD" })).ok).toBe(true);
      expect((await createSegment(org.ctx, { name, entity: "CONTACT" })).ok).toBe(true);
    });

    it("lets another org use the same name", async () => {
      const name = uniqueName("Cross org");
      expect((await createSegment(org.ctx, { name, entity: "LEAD" })).ok).toBe(true);
      expect((await createSegment(other.ctx, { name, entity: "LEAD" })).ok).toBe(true);
    });

    it("lets a segment re-case its own name", async () => {
      const name = uniqueName("recasing");
      const id = await makeSegment(org.ctx, { name, entity: "LEAD" });

      expect((await updateSegment(org.ctx, id, { name: name.toUpperCase() })).ok).toBe(true);
      expect((await db.segment.findUniqueOrThrow({ where: { id } })).name).toBe(name.toUpperCase());
    });

    it("refuses a rename onto an existing name regardless of case", async () => {
      const taken = uniqueName("Taken");
      await createSegment(org.ctx, { name: taken, entity: "LEAD" });
      const id = await makeSegment(org.ctx, { entity: "LEAD" });

      const result = await updateSegment(org.ctx, id, { name: taken.toLowerCase() });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/already exists/i);
    });
  });

  describe("translating a document to a query", () => {
    it("matches leads on a multi-value status and source", async () => {
      const byStatus = await makeSegment(org.ctx, {
        entity: "LEAD",
        filter: { status: ["NEW", "WORKING"] },
      });
      expect((await idsOf(org.ctx, byStatus)).sort()).toEqual(
        [leadOwnerHot, leadOwnerOld, leadRepNew].sort(),
      );

      const bySource = await makeSegment(org.ctx, {
        entity: "LEAD",
        filter: { source: ["WEB_FORM"] },
      });
      expect((await idsOf(org.ctx, bySource)).sort()).toEqual([leadOwnerHot, leadRepNew].sort());
    });

    it("matches a score range inclusively", async () => {
      const above = await makeSegment(org.ctx, { entity: "LEAD", filter: { scoreMin: 70 } });
      expect((await idsOf(org.ctx, above)).sort()).toEqual([leadOwnerHot, leadRepNew].sort());

      const band = await makeSegment(org.ctx, {
        entity: "LEAD",
        filter: { scoreMin: 50, scoreMax: 80 },
      });
      expect(await idsOf(org.ctx, band)).toEqual([leadRepNew]);
    });

    it("treats tagIds as ALL-of, not any-of", async () => {
      const both = await makeSegment(org.ctx, { entity: "LEAD", filter: { tagIds: [tagA, tagB] } });
      expect(await idsOf(org.ctx, both)).toEqual([leadOwnerHot]);

      const one = await makeSegment(org.ctx, { entity: "LEAD", filter: { tagIds: [tagA] } });
      expect((await idsOf(org.ctx, one)).sort()).toEqual([leadOwnerHot, leadRepNew].sort());
    });

    it("matches a relative created-within window", async () => {
      const recent = await makeSegment(org.ctx, {
        entity: "LEAD",
        filter: { createdWithinDays: 30 },
      });
      expect((await idsOf(org.ctx, recent)).sort()).toEqual([leadOwnerHot, leadRepNew].sort());

      const wide = await makeSegment(org.ctx, {
        entity: "LEAD",
        filter: { createdWithinDays: 365 },
      });
      expect(await countOf(org.ctx, wide)).toBe(4);
    });

    it("treats hasEmail and hasPhone as tri-state", async () => {
      const withEmail = await makeSegment(org.ctx, { entity: "LEAD", filter: { hasEmail: true } });
      expect((await idsOf(org.ctx, withEmail)).sort()).toEqual([leadOwnerHot, leadRepNew].sort());

      const withoutEmail = await makeSegment(org.ctx, {
        entity: "LEAD",
        filter: { hasEmail: false },
      });
      expect((await idsOf(org.ctx, withoutEmail)).sort()).toEqual(
        [leadOwnerOld, leadRepJunk].sort(),
      );

      const withoutPhone = await makeSegment(org.ctx, {
        entity: "LEAD",
        filter: { hasPhone: false },
      });
      expect((await idsOf(org.ctx, withoutPhone)).sort()).toEqual([leadRepNew, leadRepJunk].sort());

      // Unset is a third state, not a synonym for false.
      const unset = await makeSegment(org.ctx, { entity: "LEAD", filter: {} });
      expect(await countOf(org.ctx, unset)).toBe(4);
    });

    it("matches contacts by company", async () => {
      const id = await makeSegment(org.ctx, {
        entity: "CONTACT",
        filter: { companyId: companyOwned },
      });
      expect((await idsOf(org.ctx, id)).sort()).toEqual(
        [contactOwnerActive, contactRepNever].sort(),
      );
    });

    it("finds leads nobody has worked in the window, including never-worked ones", async () => {
      // Only leadOwnerHot has been touched, and touched today. The other three
      // have a null lastActivityAt, which is the never-worked case — excluding
      // it would leave out exactly the leads this filter exists to surface.
      await db.lead.update({
        where: { id: leadOwnerHot },
        data: { lastActivityAt: new Date() },
      });

      const id = await makeSegment(org.ctx, {
        entity: "LEAD",
        filter: { noActivityForDays: 30 },
      });
      expect((await idsOf(org.ctx, id)).sort()).toEqual(
        [leadOwnerOld, leadRepNew, leadRepJunk].sort(),
      );
    });

    it("counts never-contacted records as having no recent activity", async () => {
      const id = await makeSegment(org.ctx, {
        entity: "CONTACT",
        filter: { noActivityForDays: 30 },
      });
      expect((await idsOf(org.ctx, id)).sort()).toEqual([contactOwnerStale, contactRepNever].sort());
    });

    it("matches companies by owner", async () => {
      const id = await makeSegment(org.ctx, {
        entity: "COMPANY",
        filter: { ownerId: repCtx.userId },
      });
      expect(await idsOf(org.ctx, id)).toEqual([companyRepOwned]);
    });

    it("agrees between countSegment and resolveSegment", async () => {
      const id = await makeSegment(org.ctx, { entity: "CONTACT" });

      const count = await countOf(org.ctx, id);
      const resolved = await resolveSegment(org.ctx, id);
      expect(resolved.ok).toBe(true);
      if (resolved.ok) {
        expect(resolved.data.entity).toBe("CONTACT");
        expect(resolved.data.ids).toHaveLength(count);
      }
    });

    it("skips soft-deleted records", async () => {
      const doomed = await db.lead.create({
        data: {
          organizationId: org.org.id,
          source: "MANUAL",
          status: "NEW",
          dedupeKey: `lead-${randomUUID()}`,
          ownerId: org.user.id,
          deletedAt: new Date(),
        },
        select: { id: true },
      });

      const id = await makeSegment(org.ctx, { entity: "LEAD" });
      expect(await idsOf(org.ctx, id)).not.toContain(doomed.id);

      await db.lead.delete({ where: { id: doomed.id } });
    });

    it("caps and defaults the resolve limit", async () => {
      const id = await makeSegment(org.ctx, { entity: "LEAD" });

      expect(await idsOf(org.ctx, id, { limit: 2 })).toHaveLength(2);
      // Over the cap and under the floor both clamp rather than throwing.
      expect((await idsOf(org.ctx, id, { limit: 10_000_000 })).length).toBeLessThanOrEqual(
        RESOLVE_DEFAULT_LIMIT,
      );
      expect(await idsOf(org.ctx, id, { limit: 0 })).toHaveLength(1);
    });
  });

  describe("a segment narrows, it never widens", () => {
    it("keeps the tenant and visibility scope out of the document's reach", () => {
      const asOwner = segmentWhere(org.ctx, "LEAD", { status: ["NEW"] });
      expect(asOwner).toMatchObject({ organizationId: org.org.id, deletedAt: null });
      expect(asOwner.AND).toEqual([{ status: { in: ["NEW"] } }]);
      // An owner sees everything, so no ownerId pin.
      expect(asOwner.ownerId).toBeUndefined();

      // The rep's pin sits at the top level, where the document cannot reach
      // it; the document's own ownerId only ever intersects with it.
      const asRep = segmentWhere(repCtx, "LEAD", { ownerId: org.user.id });
      expect(asRep.ownerId).toBe(repCtx.userId);
      expect(asRep.AND).toEqual([{ ownerId: org.user.id }]);
    });

    it("gives a REP only their own records from an OWNER's shared segment", async () => {
      const id = await makeSegment(org.ctx, { entity: "LEAD", filter: { status: ["NEW"] } });

      // The same saved segment, two callers, two answers.
      expect((await idsOf(org.ctx, id)).sort()).toEqual([leadOwnerHot, leadRepNew].sort());
      expect(await idsOf(repCtx, id)).toEqual([leadRepNew]);
      expect(await countOf(repCtx, id)).toBe(1);
    });

    it("returns nothing to a REP when the segment pins someone else's records", async () => {
      const id = await makeSegment(org.ctx, {
        entity: "LEAD",
        filter: { ownerId: org.user.id },
      });

      expect(await countOf(org.ctx, id)).toBe(2);
      // Intersection, not replacement — the rep does not inherit the owner's view.
      expect(await idsOf(repCtx, id)).toEqual([]);
    });

    it("narrows contacts and companies the same way", async () => {
      const contacts = await makeSegment(org.ctx, { entity: "CONTACT" });
      expect(await idsOf(repCtx, contacts)).toEqual([contactRepNever]);

      const companies = await makeSegment(org.ctx, { entity: "COMPANY" });
      expect(await idsOf(repCtx, companies)).toEqual([companyRepOwned]);
    });
  });

  describe("private and shared", () => {
    it("hides a private segment from everyone but its owner", async () => {
      const id = await makeSegment(org.ctx, { entity: "LEAD", shared: false });

      expect((await listSegments(repCtx)).map((s) => s.id)).not.toContain(id);
      // Indistinguishable from an id that never existed.
      expect((await getSegment(repCtx, id)).ok).toBe(false);
      expect((await countSegment(repCtx, id)).ok).toBe(false);
      expect((await resolveSegment(repCtx, id)).ok).toBe(false);
      expect((await updateSegment(repCtx, id, { shared: true })).ok).toBe(false);
      expect((await deleteSegment(repCtx, id)).ok).toBe(false);
    });

    it("hides a private segment even from a MANAGER", async () => {
      const id = await makeSegment(org.ctx, { entity: "LEAD", shared: false });

      expect((await listSegments(managerCtx)).map((s) => s.id)).not.toContain(id);
      expect((await getSegment(managerCtx, id)).ok).toBe(false);
    });

    it("lets the owner run their own private segment", async () => {
      const id = await makeSegment(org.ctx, {
        entity: "LEAD",
        shared: false,
        filter: { status: ["JUNK"] },
      });

      expect(await idsOf(org.ctx, id)).toEqual([leadRepJunk]);
    });

    it("shows a REP a shared segment written by someone else", async () => {
      const id = await makeSegment(org.ctx, { entity: "LEAD" });

      expect((await listSegments(repCtx)).map((s) => s.id)).toContain(id);
      expect((await getSegment(repCtx, id)).ok).toBe(true);
    });

    it("refuses a REP editing someone else's shared segment", async () => {
      const id = await makeSegment(org.ctx, { entity: "LEAD" });

      await expect(updateSegment(repCtx, id, { name: uniqueName("Hijack") })).rejects.toThrow(
        /permission|owner/i,
      );
    });

    it("lets a REP edit their own", async () => {
      const id = await makeSegment(repCtx, { entity: "LEAD" });

      expect((await updateSegment(repCtx, id, { name: uniqueName("Mine") })).ok).toBe(true);
    });
  });

  describe("delete permissions", () => {
    it("lets a REP delete their own segment", async () => {
      const id = await makeSegment(repCtx, { entity: "LEAD" });

      expect((await deleteSegment(repCtx, id)).ok).toBe(true);
      expect(await db.segment.count({ where: { id } })).toBe(0);
    });

    it("refuses a REP deleting someone else's segment", async () => {
      const id = await makeSegment(org.ctx, { entity: "LEAD" });

      await expect(deleteSegment(repCtx, id)).rejects.toThrow(/permission|owner/i);
      expect(await db.segment.count({ where: { id } })).toBe(1);
    });

    it("lets a MANAGER delete a shared segment they do not own", async () => {
      const id = await makeSegment(org.ctx, { entity: "LEAD" });

      expect((await deleteSegment(managerCtx, id)).ok).toBe(true);
      expect(await db.segment.count({ where: { id } })).toBe(0);
    });

    it("refuses a READ_ONLY user creating, editing or deleting", async () => {
      const id = await makeSegment(org.ctx, { entity: "LEAD" });

      await expect(
        createSegment(readOnlyCtx, { name: uniqueName("Nope"), entity: "LEAD" }),
      ).rejects.toThrow(/permission/i);
      await expect(updateSegment(readOnlyCtx, id, { shared: false })).rejects.toThrow(/permission/i);
      await expect(deleteSegment(readOnlyCtx, id)).rejects.toThrow(/permission/i);

      // Reading and running are still allowed — that is the whole role.
      expect((await getSegment(readOnlyCtx, id)).ok).toBe(true);
      expect(await countOf(readOnlyCtx, id)).toBe(4);
    });
  });

  describe("tenant isolation", () => {
    it("does not list another org's segments", async () => {
      const id = await makeSegment(org.ctx, { entity: "LEAD" });

      expect((await listSegments(other.ctx)).map((s) => s.id)).not.toContain(id);
    });

    it("cannot read, count or run another org's segment", async () => {
      const id = await makeSegment(org.ctx, { entity: "LEAD" });

      expect((await getSegment(other.ctx, id)).ok).toBe(false);
      expect((await countSegment(other.ctx, id)).ok).toBe(false);
      expect((await resolveSegment(other.ctx, id)).ok).toBe(false);
    });

    it("cannot edit or delete another org's segment", async () => {
      const name = uniqueName("Theirs");
      const id = await makeSegment(org.ctx, { name, entity: "LEAD" });

      const updated = await updateSegment(other.ctx, id, { name: uniqueName("Hijacked") });
      expect(updated.ok).toBe(false);
      if (!updated.ok) expect(updated.error).toMatch(/not found/i);

      const deleted = await deleteSegment(other.ctx, id);
      expect(deleted.ok).toBe(false);

      const row = await db.segment.findUniqueOrThrow({ where: { id } });
      expect(row.name).toBe(name);
    });

    it("never returns another org's records from a segment", async () => {
      await db.lead.create({
        data: {
          organizationId: other.org.id,
          source: "MANUAL",
          status: "NEW",
          dedupeKey: `lead-${randomUUID()}`,
          ownerId: other.user.id,
        },
      });

      const mine = await makeSegment(org.ctx, { entity: "LEAD" });
      const theirs = await makeSegment(other.ctx, { entity: "LEAD" });

      const myIds = await idsOf(org.ctx, mine);
      expect(myIds).toHaveLength(4);
      expect(await countOf(other.ctx, theirs)).toBe(1);
    });
  });
});
