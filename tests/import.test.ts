import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { MAX_IMPORT_ROWS } from "@/lib/validation/import";
import { importContacts } from "@/server/services/import";
import { dropOrg, makeOrg } from "./factories";

const MAPPING = {
  "First Name": "firstName",
  "Last Name": "lastName",
  Email: "email",
  Phone: "phone",
  Company: "companyName",
};

function row(first: string, last = "", email = "", company = "", phone = "") {
  return {
    "First Name": first,
    "Last Name": last,
    Email: email,
    Phone: phone,
    Company: company,
  };
}

describe("CSV import", () => {
  let org: Awaited<ReturnType<typeof makeOrg>>;

  beforeAll(async () => {
    org = await makeOrg();
  });
  afterAll(async () => {
    await dropOrg(org.org.id);
    await db.$disconnect();
  });

  it("imports clean rows and creates companies once", async () => {
    const result = await importContacts(org.ctx, {
      rows: [
        row("Ada", "Lovelace", "ada@analytical.test", "Analytical Engines"),
        row("Charles", "Babbage", "charles@analytical.test", "Analytical Engines"),
      ],
      mapping: MAPPING,
      onDuplicate: "skip",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.created).toBe(2);
    expect(result.data.failed).toBe(0);
    // Both rows name the same company — it must be created once, not twice.
    expect(result.data.companiesCreated).toBe(1);

    expect(
      await db.company.count({
        where: { organizationId: org.org.id, name: "Analytical Engines" },
      }),
    ).toBe(1);
  });

  it("reports a bad row by its line number without aborting the import", async () => {
    const result = await importContacts(org.ctx, {
      rows: [
        row("Grace", "Hopper", "grace@navy.test"),
        row("", "NoFirstName", "broken@example.test"),
        row("Alan", "Turing", "not-an-email"),
        row("Katherine", "Johnson", "katherine@nasa.test"),
      ],
      mapping: MAPPING,
      onDuplicate: "skip",
    });
    if (!result.ok) throw new Error(result.error);

    // The two good rows still land.
    expect(result.data.created).toBe(2);
    expect(result.data.failed).toBe(2);

    // Line numbers count the header as line 1, so they match the source file.
    expect(result.data.errors.map((e) => e.row)).toEqual([3, 4]);

    // Messages must be actionable by whoever owns the spreadsheet — no Zod
    // internals, no field paths they never chose.
    expect(result.data.errors[0].message).toBe(
      "First name is empty — every contact needs at least a first name",
    );
    expect(result.data.errors[1].message).toBe("Email is not a valid address");
    for (const error of result.data.errors) {
      expect(error.message).not.toMatch(/expected string|received|invalid input/i);
    }
  });

  it("treats a fully blank row as padding, not a failure", async () => {
    const result = await importContacts(org.ctx, {
      rows: [row("", "", "", ""), row("Margaret", "Hamilton", "margaret@mit.test")],
      mapping: MAPPING,
      onDuplicate: "skip",
    });
    if (!result.ok) throw new Error(result.error);

    expect(result.data.created).toBe(1);
    expect(result.data.skipped).toBe(1);
    expect(result.data.failed).toBe(0);
  });

  it("skips a duplicate email by default", async () => {
    const result = await importContacts(org.ctx, {
      rows: [row("Ada", "Lovelace", "ada@analytical.test")],
      mapping: MAPPING,
      onDuplicate: "skip",
    });
    if (!result.ok) throw new Error(result.error);

    expect(result.data.created).toBe(0);
    expect(result.data.skipped).toBe(1);
  });

  it("updates the existing contact when asked to", async () => {
    const result = await importContacts(org.ctx, {
      rows: [row("Ada", "Byron", "ada@analytical.test", "", "+1 415 555 0100")],
      mapping: MAPPING,
      onDuplicate: "update",
    });
    if (!result.ok) throw new Error(result.error);

    expect(result.data.updated).toBe(1);
    const contact = await db.contact.findFirstOrThrow({
      where: { organizationId: org.org.id, email: "ada@analytical.test" },
    });
    expect(contact.lastName).toBe("Byron");
    expect(contact.phone).toBe("+14155550100");
  });

  it("dedupes repeats within a single file", async () => {
    const result = await importContacts(org.ctx, {
      rows: [
        row("Repeat", "Person", "repeat@example.test"),
        row("Repeat", "Person", "repeat@example.test"),
        row("Repeat", "Person", "REPEAT@example.test"),
      ],
      mapping: MAPPING,
      onDuplicate: "skip",
    });
    if (!result.ok) throw new Error(result.error);

    expect(result.data.created).toBe(1);
    expect(result.data.skipped).toBe(2);
  });

  it("still imports rows that have no email", async () => {
    const result = await importContacts(org.ctx, {
      rows: [row("Anonymous", "Prospect", "", "Walk-in Co")],
      mapping: MAPPING,
      onDuplicate: "skip",
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.data.created).toBe(1);
  });

  it("refuses an import with no First name column mapped", async () => {
    const result = await importContacts(org.ctx, {
      rows: [row("Someone")],
      mapping: { Email: "email" },
      onDuplicate: "skip",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/First name/i);
  });

  it("ignores a mapping that points at a field we do not accept", async () => {
    const result = await importContacts(org.ctx, {
      rows: [{ "First Name": "Crafted", Sneaky: "value" }],
      // A crafted mapping must not be able to write arbitrary columns.
      mapping: { "First Name": "firstName", Sneaky: "organizationId" },
      onDuplicate: "skip",
    });
    if (!result.ok) throw new Error(result.error);

    expect(result.data.created).toBe(1);
    const contact = await db.contact.findFirstOrThrow({
      where: { organizationId: org.org.id, firstName: "Crafted" },
    });
    // Still in the caller's org, not wherever the crafted value pointed.
    expect(contact.organizationId).toBe(org.org.id);
  });

  it("rejects an oversized file outright, and says why", async () => {
    const tooMany = Array.from({ length: MAX_IMPORT_ROWS + 3 }, (_, i) =>
      row(`Bulk${i}`, "Row", `bulk${i}@example.test`),
    );
    const before = await db.contact.count({ where: { organizationId: org.org.id } });

    const result = await importContacts(org.ctx, {
      rows: tooMany,
      mapping: MAPPING,
      onDuplicate: "skip",
    });

    expect(result.ok).toBe(false);
    // A half-import is worse than none: the person cannot tell what landed.
    if (!result.ok) expect(result.error).toMatch(/more than .* rows/i);
    expect(await db.contact.count({ where: { organizationId: org.org.id } })).toBe(before);
  });

  it("writes one audit row for the batch, not one per contact", async () => {
    const audits = await db.auditLog.count({
      where: { organizationId: org.org.id, entity: "Contact", action: "import" },
    });
    expect(audits).toBeGreaterThan(0);

    const perContact = await db.auditLog.count({
      where: { organizationId: org.org.id, entity: "Contact", action: "create" },
    });
    expect(perContact).toBe(0);
  });

  describe("permissions and isolation", () => {
    it("a READ_ONLY user cannot import", async () => {
      const readOnly = { ...org.ctx, role: "READ_ONLY" as const };
      await expect(
        importContacts(readOnly, {
          rows: [row("Nope", "", "nope@example.test")],
          mapping: MAPPING,
          onDuplicate: "skip",
        }),
      ).rejects.toThrow(/permission/i);
    });

    it("imports land only in the caller's organization", async () => {
      const other = await makeOrg();
      try {
        await importContacts(other.ctx, {
          rows: [row("Their", "Person", "theirs@example.test")],
          mapping: MAPPING,
          onDuplicate: "skip",
        });

        expect(
          await db.contact.count({
            where: { organizationId: org.org.id, email: "theirs@example.test" },
          }),
        ).toBe(0);
      } finally {
        await dropOrg(other.org.id);
      }
    });
  });
});
