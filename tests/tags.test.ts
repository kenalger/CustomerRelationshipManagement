import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import type { Ctx } from "@/server/authz";
import {
  applyTag,
  createTag,
  deleteTag,
  listTags,
  removeTag,
  renameTag,
  setTagColour,
  tagsFor,
} from "@/server/services/tags";
import { dropOrg, makeOrg } from "./factories";

/** Tag names collide per org, so every test gets its own. */
const uniqueName = (label: string) => `${label}-${randomUUID().slice(0, 8)}`;

/** Creates a tag and returns its id, failing loudly if the service refused. */
async function makeTag(ctx: Ctx, name: string, colour = "BLUE") {
  const result = await createTag(ctx, { name, colour });
  if (!result.ok) throw new Error(result.error);
  return result.data.id;
}

describe("tags", () => {
  let org: Awaited<ReturnType<typeof makeOrg>>;
  let other: Awaited<ReturnType<typeof makeOrg>>;

  // Records in org A, owned by the OWNER — invisible to the rep below.
  let contactId: string;
  let companyId: string;
  let leadId: string;

  // A REP in org A plus one contact they actually own.
  let repCtx: Ctx;
  let repContactId: string;

  // A record belonging to org B, for the cross-tenant cases.
  let theirContactId: string;

  beforeAll(async () => {
    org = await makeOrg();
    other = await makeOrg();

    const contact = await db.contact.create({
      data: { organizationId: org.org.id, firstName: "Tagged", ownerId: org.user.id },
    });
    contactId = contact.id;

    const company = await db.company.create({
      data: { organizationId: org.org.id, name: "Tagged Co", ownerId: org.user.id },
    });
    companyId = company.id;

    const lead = await db.lead.create({
      data: {
        organizationId: org.org.id,
        source: "MANUAL",
        dedupeKey: `lead-${randomUUID()}`,
        firstName: "Tagged Lead",
        ownerId: org.user.id,
      },
    });
    leadId = lead.id;

    const rep = await db.user.create({
      data: {
        organizationId: org.org.id,
        email: `rep-${randomUUID().slice(0, 8)}@test.local`,
        role: "REP",
        passwordHash: "not-used-in-these-tests",
      },
    });
    repCtx = { userId: rep.id, organizationId: org.org.id, role: "REP" };

    const repContact = await db.contact.create({
      data: { organizationId: org.org.id, firstName: "Rep's own", ownerId: rep.id },
    });
    repContactId = repContact.id;

    const theirContact = await db.contact.create({
      data: { organizationId: other.org.id, firstName: "Theirs", ownerId: other.user.id },
    });
    theirContactId = theirContact.id;
  });

  afterAll(async () => {
    await dropOrg(org.org.id);
    await dropOrg(other.org.id);
    await db.$disconnect();
  });

  describe("lifecycle", () => {
    it("creates a tag with a colour and lists it unused", async () => {
      const name = uniqueName("Enterprise");
      const id = await makeTag(org.ctx, name, "PURPLE");

      const listed = (await listTags(org.ctx)).find((t) => t.id === id);
      expect(listed).toMatchObject({ name, colour: "PURPLE", usageCount: 0 });
    });

    it("defaults an unspecified colour to GRAY", async () => {
      const created = await createTag(org.ctx, { name: uniqueName("Plain") });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const tag = await db.tag.findUniqueOrThrow({ where: { id: created.data.id } });
      expect(tag.colour).toBe("GRAY");
    });

    it("trims the name rather than storing the padding", async () => {
      const name = uniqueName("Padded");
      const created = await createTag(org.ctx, { name: `   ${name}   ` });
      if (!created.ok) throw new Error(created.error);

      const tag = await db.tag.findUniqueOrThrow({ where: { id: created.data.id } });
      expect(tag.name).toBe(name);
    });

    it("rejects a blank name and one over 40 characters", async () => {
      expect((await createTag(org.ctx, { name: "   " })).ok).toBe(false);
      expect((await createTag(org.ctx, { name: "x".repeat(41) })).ok).toBe(false);
    });

    it("rejects a colour that is not in the enum", async () => {
      const id = await makeTag(org.ctx, uniqueName("Colourful"));
      const result = await setTagColour(org.ctx, id, "MAUVE");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/colour/i);
    });

    it("renames a tag", async () => {
      const id = await makeTag(org.ctx, uniqueName("Before"));
      const after = uniqueName("After");

      expect((await renameTag(org.ctx, id, { name: after })).ok).toBe(true);
      const tag = await db.tag.findUniqueOrThrow({ where: { id } });
      expect(tag.name).toBe(after);
    });

    it("recolours a tag", async () => {
      const id = await makeTag(org.ctx, uniqueName("Recolour"), "GREEN");

      expect((await setTagColour(org.ctx, id, "RED")).ok).toBe(true);
      const tag = await db.tag.findUniqueOrThrow({ where: { id } });
      expect(tag.colour).toBe("RED");
    });
  });

  describe("name uniqueness", () => {
    it("refuses a duplicate name regardless of case", async () => {
      const name = uniqueName("Champion");
      await makeTag(org.ctx, name);

      const result = await createTag(org.ctx, { name: name.toUpperCase() });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/already exists/i);

      // The error must be ours, not a leaked Prisma constraint crash.
      expect(await db.tag.count({ where: { organizationId: org.org.id, name: { equals: name, mode: "insensitive" } } })).toBe(1);
    });

    it("refuses a rename onto an existing name regardless of case", async () => {
      const taken = uniqueName("Taken");
      await makeTag(org.ctx, taken);
      const id = await makeTag(org.ctx, uniqueName("Mover"));

      const result = await renameTag(org.ctx, id, { name: taken.toLowerCase() });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/already exists/i);
    });

    it("lets a tag re-case its own name", async () => {
      const name = uniqueName("recasing");
      const id = await makeTag(org.ctx, name);

      const result = await renameTag(org.ctx, id, { name: name.toUpperCase() });
      expect(result.ok).toBe(true);
      const tag = await db.tag.findUniqueOrThrow({ where: { id } });
      expect(tag.name).toBe(name.toUpperCase());
    });

    it("lets two different orgs use the same name", async () => {
      const name = uniqueName("Shared");
      await makeTag(org.ctx, name);
      expect((await createTag(other.ctx, { name })).ok).toBe(true);
    });
  });

  describe("applying", () => {
    it("tags a contact, a company and a lead", async () => {
      const id = await makeTag(org.ctx, uniqueName("Everywhere"));

      for (const target of [{ contactId }, { companyId }, { leadId }]) {
        const result = await applyTag(org.ctx, id, target);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.data.applied).toBe(true);

        const tags = await tagsFor(org.ctx, target);
        expect(tags.map((t) => t.id)).toContain(id);
      }

      expect(await db.tagging.count({ where: { tagId: id } })).toBe(3);
    });

    it("treats a repeat application as a silent no-op", async () => {
      const id = await makeTag(org.ctx, uniqueName("Repeat"));

      const first = await applyTag(org.ctx, id, { contactId });
      const second = await applyTag(org.ctx, id, { contactId });

      expect(first.ok && first.data.applied).toBe(true);
      // Not an error — the caller got the state they asked for.
      expect(second.ok).toBe(true);
      if (second.ok) expect(second.data.applied).toBe(false);

      expect(await db.tagging.count({ where: { tagId: id, contactId } })).toBe(1);
    });

    it("removes a tag from a record", async () => {
      const id = await makeTag(org.ctx, uniqueName("Removable"));
      await applyTag(org.ctx, id, { companyId });

      const result = await removeTag(org.ctx, id, { companyId });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.removed).toBe(true);

      expect((await tagsFor(org.ctx, { companyId })).map((t) => t.id)).not.toContain(id);
    });

    it("removing a tag that is not applied is a no-op, not an error", async () => {
      const id = await makeTag(org.ctx, uniqueName("Unapplied"));

      const result = await removeTag(org.ctx, id, { leadId });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.removed).toBe(false);
    });

    it("refuses a target that names more than one record", async () => {
      const id = await makeTag(org.ctx, uniqueName("Ambiguous"));

      const result = await applyTag(org.ctx, id, { contactId, leadId });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/exactly one/i);
    });

    it("counts usage per tag", async () => {
      const id = await makeTag(org.ctx, uniqueName("Counted"));
      await applyTag(org.ctx, id, { contactId });
      await applyTag(org.ctx, id, { leadId });
      // The repeat must not inflate the count.
      await applyTag(org.ctx, id, { leadId });

      const listed = (await listTags(org.ctx)).find((t) => t.id === id);
      expect(listed?.usageCount).toBe(2);

      await removeTag(org.ctx, id, { contactId });
      const after = (await listTags(org.ctx)).find((t) => t.id === id);
      expect(after?.usageCount).toBe(1);
    });

    it("deleting a tag takes its taggings with it", async () => {
      const id = await makeTag(org.ctx, uniqueName("Doomed"));
      await applyTag(org.ctx, id, { contactId });
      await applyTag(org.ctx, id, { companyId });
      expect(await db.tagging.count({ where: { tagId: id } })).toBe(2);

      expect((await deleteTag(org.ctx, id)).ok).toBe(true);

      // Cascade, by design — see the comment on deleteTag.
      expect(await db.tagging.count({ where: { tagId: id } })).toBe(0);
      // The records themselves survive.
      expect(await db.contact.count({ where: { id: contactId } })).toBe(1);
      expect(await db.company.count({ where: { id: companyId } })).toBe(1);
    });
  });

  describe("record-level permissions", () => {
    it("lets a REP tag a record they own", async () => {
      const id = await makeTag(repCtx, uniqueName("Mine"));

      const result = await applyTag(repCtx, id, { contactId: repContactId });
      expect(result.ok).toBe(true);
    });

    it("refuses a REP tagging a record they do not own", async () => {
      const id = await makeTag(repCtx, uniqueName("NotMine"));

      const result = await applyTag(repCtx, id, { contactId });
      expect(result.ok).toBe(false);
      // Phrased as 'does not exist' — confirming it exists is itself a leak.
      if (!result.ok) expect(result.error).toMatch(/does not exist/i);
      expect(await db.tagging.count({ where: { tagId: id, contactId } })).toBe(0);
    });

    it("refuses a REP removing a tag from a record they do not own", async () => {
      const id = await makeTag(org.ctx, uniqueName("Protected"));
      await applyTag(org.ctx, id, { contactId });

      const result = await removeTag(repCtx, id, { contactId });
      expect(result.ok).toBe(false);
      expect(await db.tagging.count({ where: { tagId: id, contactId } })).toBe(1);
    });

    it("shows a REP no tags on a record they cannot see", async () => {
      const id = await makeTag(org.ctx, uniqueName("Hidden"));
      await applyTag(org.ctx, id, { contactId });

      expect(await tagsFor(repCtx, { contactId })).toHaveLength(0);
    });

    it("refuses a REP deleting a tag", async () => {
      const id = await makeTag(org.ctx, uniqueName("RepCannotDelete"));

      await expect(deleteTag(repCtx, id)).rejects.toThrow(/permission/i);
      expect(await db.tag.count({ where: { id } })).toBe(1);
    });

    it("refuses a READ_ONLY user creating or applying a tag", async () => {
      const readOnly: Ctx = { ...org.ctx, role: "READ_ONLY" };
      const id = await makeTag(org.ctx, uniqueName("ReadOnly"));

      await expect(createTag(readOnly, { name: uniqueName("Nope") })).rejects.toThrow(/permission/i);
      await expect(applyTag(readOnly, id, { contactId })).rejects.toThrow(/permission/i);
      await expect(removeTag(readOnly, id, { contactId })).rejects.toThrow(/permission/i);
    });
  });

  describe("tenant isolation", () => {
    it("does not list another org's tags", async () => {
      const name = uniqueName("PrivateToA");
      await makeTag(org.ctx, name);

      expect((await listTags(other.ctx)).map((t) => t.name)).not.toContain(name);
    });

    it("cannot rename another org's tag", async () => {
      const name = uniqueName("NoRename");
      const id = await makeTag(org.ctx, name);

      const result = await renameTag(other.ctx, id, { name: "Hijacked" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/not found/i);
      expect((await db.tag.findUniqueOrThrow({ where: { id } })).name).toBe(name);
    });

    it("cannot recolour another org's tag", async () => {
      const id = await makeTag(org.ctx, uniqueName("NoRecolour"), "GREEN");

      const result = await setTagColour(other.ctx, id, "RED");
      expect(result.ok).toBe(false);
      expect((await db.tag.findUniqueOrThrow({ where: { id } })).colour).toBe("GREEN");
    });

    it("cannot delete another org's tag", async () => {
      const id = await makeTag(org.ctx, uniqueName("NoDelete"));

      const result = await deleteTag(other.ctx, id);
      expect(result.ok).toBe(false);
      expect(await db.tag.count({ where: { id } })).toBe(1);
    });

    it("cannot apply another org's tag to its own record", async () => {
      const id = await makeTag(org.ctx, uniqueName("NoApply"));

      const result = await applyTag(other.ctx, id, { contactId: theirContactId });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/not found/i);
      expect(await db.tagging.count({ where: { tagId: id } })).toBe(0);
    });

    it("cannot apply its own tag to another org's record", async () => {
      const id = await makeTag(org.ctx, uniqueName("NoCrossRecord"));

      const result = await applyTag(org.ctx, id, { contactId: theirContactId });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/does not exist/i);
      expect(await db.tagging.count({ where: { contactId: theirContactId } })).toBe(0);
    });

    it("cannot remove a tagging across the tenant boundary", async () => {
      const id = await makeTag(org.ctx, uniqueName("NoCrossRemove"));
      await applyTag(org.ctx, id, { contactId });

      // Their tag id is unknown to them and the record is not theirs — both
      // halves of the check have to hold.
      const byTag = await removeTag(other.ctx, id, { contactId: theirContactId });
      expect(byTag.ok).toBe(false);

      const theirTag = await createTag(other.ctx, { name: uniqueName("TheirOwn") });
      if (!theirTag.ok) throw new Error(theirTag.error);
      const byRecord = await removeTag(other.ctx, theirTag.data.id, { contactId });
      expect(byRecord.ok).toBe(false);

      expect(await db.tagging.count({ where: { tagId: id, contactId } })).toBe(1);
    });

    it("shows another org no tags on a record they do not own", async () => {
      const id = await makeTag(org.ctx, uniqueName("NoCrossRead"));
      await applyTag(org.ctx, id, { leadId });

      expect(await tagsFor(other.ctx, { leadId })).toHaveLength(0);
    });
  });
});
