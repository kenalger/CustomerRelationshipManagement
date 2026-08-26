import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import type { Ctx } from "@/server/authz";
import { createContact, getContact } from "@/server/services/contacts";
import { dropOrg, makeOrg } from "./factories";

/**
 * Inline cell editing goes through the same server action as the record page,
 * so the guarantee that matters is the field allowlist and the ownership rule
 * — a grid cell must not become a wider write path than a form.
 */
describe("inline cell editing", () => {
  let org: Awaited<ReturnType<typeof makeOrg>>;
  let repId: string;
  let ownContact: string;
  let theirContact: string;

  const as = (role: Ctx["role"], userId?: string): Ctx => ({
    ...org.ctx,
    role,
    userId: userId ?? org.ctx.userId,
  });

  beforeAll(async () => {
    org = await makeOrg();
    const user = await db.user.create({
      data: {
        organizationId: org.org.id,
        email: `grid-rep-${org.org.id}@test.local`,
        role: "REP",
        passwordHash: "x",
      },
    });
    repId = user.id;

    const mine = await createContact(as("REP", repId), { firstName: "Grid", lastName: "Own" });
    if (!mine.ok) throw new Error(mine.error);
    ownContact = mine.data.id;

    const theirs = await createContact(org.ctx, { firstName: "Grid", lastName: "Theirs" });
    if (!theirs.ok) throw new Error(theirs.error);
    theirContact = theirs.data.id;
  });

  afterAll(async () => {
    await dropOrg(org.org.id);
    await db.$disconnect();
  });

  it("saves a single field the way a cell edit does", async () => {
    const { updateContact } = await import("@/server/services/contacts");
    const result = await updateContact(as("REP", repId), ownContact, { title: "Head of Ops" });
    expect(result.ok).toBe(true);

    const contact = await getContact(as("REP", repId), ownContact);
    expect(contact?.title).toBe("Head of Ops");
  });

  it("clears a field when the cell is emptied", async () => {
    const { updateContact } = await import("@/server/services/contacts");
    const result = await updateContact(as("REP", repId), ownContact, { title: "" });
    expect(result.ok).toBe(true);

    const contact = await getContact(as("REP", repId), ownContact);
    // Empty means cleared, not the literal empty string.
    expect(contact?.title).toBeNull();
  });

  it("still rejects a malformed value from a cell", async () => {
    const { updateContact } = await import("@/server/services/contacts");
    const result = await updateContact(as("REP", repId), ownContact, { email: "not-an-email" });
    expect(result.ok).toBe(false);
  });

  it("a REP cannot edit a cell on a record they do not own", async () => {
    const { updateContact } = await import("@/server/services/contacts");
    const result = await updateContact(as("REP", repId), theirContact, { title: "Hijacked" });
    expect(result.ok).toBe(false);

    const untouched = await db.contact.findUniqueOrThrow({ where: { id: theirContact } });
    expect(untouched.title).toBeNull();
  });

  it("a READ_ONLY user cannot edit a cell", async () => {
    const { updateContact } = await import("@/server/services/contacts");
    await expect(
      updateContact(as("READ_ONLY"), ownContact, { title: "No" }),
    ).rejects.toThrow(/permission/i);
  });
});
