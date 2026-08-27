import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { ForbiddenError, type Ctx } from "@/server/authz";
import {
  isSuppressed,
  listSuppressions,
  parseEmailBlob,
  suppress,
  suppressMany,
  suppressedAmong,
  unsuppress,
} from "@/server/services/suppression";
import { dropOrg, makeOrg } from "./factories";

/** Addresses are unique per org, so every test mints its own. */
const uniqueEmail = (label: string) => `${label}-${randomUUID().slice(0, 8)}@example.test`;

async function add(ctx: Ctx, email: string, reason = "MANUAL") {
  const result = await suppress(ctx, { email, reason });
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

describe("suppression", () => {
  let org: Awaited<ReturnType<typeof makeOrg>>;
  let other: Awaited<ReturnType<typeof makeOrg>>;
  let repCtx: Ctx;
  let managerCtx: Ctx;
  let readOnlyCtx: Ctx;

  beforeAll(async () => {
    org = await makeOrg();
    other = await makeOrg();
    repCtx = { ...org.ctx, role: "REP" };
    managerCtx = { ...org.ctx, role: "MANAGER" };
    readOnlyCtx = { ...org.ctx, role: "READ_ONLY" };
  });

  afterAll(async () => {
    await dropOrg(org.org.id);
    await dropOrg(other.org.id);
  });

  describe("normalisation", () => {
    it("treats case and surrounding whitespace as the same address", async () => {
      const email = uniqueEmail("Case");
      await add(org.ctx, `  ${email.toUpperCase()}  `);

      // All three spellings have to answer the same way, or the list reports a
      // coverage it does not have.
      expect(await isSuppressed(org.ctx, email)).toBe(true);
      expect(await isSuppressed(org.ctx, email.toUpperCase())).toBe(true);
      expect(await isSuppressed(org.ctx, ` ${email} `)).toBe(true);
    });

    it("stores the normalised form, not what was typed", async () => {
      const email = uniqueEmail("Stored");
      await add(org.ctx, email.toUpperCase());

      const row = await db.suppression.findFirstOrThrow({
        where: { organizationId: org.org.id, email: email.toLowerCase() },
        select: { email: true },
      });
      expect(row.email).toBe(email.toLowerCase());
    });

    it("rejects something that is not an address", async () => {
      const result = await suppress(org.ctx, { email: "not-an-address" });
      expect(result.ok).toBe(false);
    });
  });

  describe("isSuppressed", () => {
    it("is false for an address nobody suppressed", async () => {
      expect(await isSuppressed(org.ctx, uniqueEmail("clean"))).toBe(false);
    });

    it("is false for null, an empty string and junk", async () => {
      // A record with no email cannot be emailed, so there is nothing to
      // suppress — this must not throw and must not report true.
      expect(await isSuppressed(org.ctx, null)).toBe(false);
      expect(await isSuppressed(org.ctx, undefined)).toBe(false);
      expect(await isSuppressed(org.ctx, "")).toBe(false);
      expect(await isSuppressed(org.ctx, "garbage")).toBe(false);
    });

    it("does not leak across tenants", async () => {
      const email = uniqueEmail("tenant");
      await add(org.ctx, email);

      expect(await isSuppressed(org.ctx, email)).toBe(true);
      expect(await isSuppressed(other.ctx, email)).toBe(false);
    });
  });

  describe("suppressedAmong", () => {
    it("returns only the suppressed members of a batch, normalised", async () => {
      const suppressed = uniqueEmail("batch-hit");
      const clean = uniqueEmail("batch-miss");
      await add(org.ctx, suppressed);

      const hits = await suppressedAmong(org.ctx, [
        suppressed.toUpperCase(),
        clean,
        null,
        "",
        "junk",
      ]);
      expect(hits.has(suppressed.toLowerCase())).toBe(true);
      expect(hits.has(clean.toLowerCase())).toBe(false);
      expect(hits.size).toBe(1);
    });

    it("returns an empty set for a batch with nothing checkable in it", async () => {
      const hits = await suppressedAmong(org.ctx, [null, undefined, "", "nope"]);
      expect(hits.size).toBe(0);
    });

    it("agrees with isSuppressed one address at a time", async () => {
      const a = uniqueEmail("agree-a");
      const b = uniqueEmail("agree-b");
      await add(org.ctx, a);

      const hits = await suppressedAmong(org.ctx, [a, b]);
      expect(hits.has(a)).toBe(await isSuppressed(org.ctx, a));
      expect(hits.has(b)).toBe(await isSuppressed(org.ctx, b));
    });
  });

  describe("suppress", () => {
    it("reports added on the first call and not on the second", async () => {
      const email = uniqueEmail("twice");

      const first = await suppress(org.ctx, { email });
      expect(first.ok && first.data.added).toBe(true);

      // A retrying unsubscribe webhook must not look broken. The end state is
      // the same either way.
      const second = await suppress(org.ctx, { email });
      expect(second.ok && second.data.added).toBe(false);

      const count = await db.suppression.count({
        where: { organizationId: org.org.id, email },
      });
      expect(count).toBe(1);
    });

    it("records who added it and why", async () => {
      const email = uniqueEmail("attributed");
      await add(org.ctx, email, "COMPLAINED");

      const row = await db.suppression.findFirstOrThrow({
        where: { organizationId: org.org.id, email },
        select: { reason: true, createdById: true },
      });
      expect(row.reason).toBe("COMPLAINED");
      expect(row.createdById).toBe(org.user.id);
    });

    it("writes an audit row", async () => {
      const email = uniqueEmail("audited");
      await add(org.ctx, email);

      const entries = await db.auditLog.findMany({
        where: { organizationId: org.org.id, entity: "Suppression", action: "suppress" },
        orderBy: { at: "desc" },
        take: 1,
      });
      expect(entries).toHaveLength(1);
    });

    it("lets the same address be suppressed independently in two orgs", async () => {
      const email = uniqueEmail("shared");
      const here = await suppress(org.ctx, { email });
      const there = await suppress(other.ctx, { email });

      expect(here.ok && here.data.added).toBe(true);
      expect(there.ok && there.data.added).toBe(true);
    });
  });

  describe("parseEmailBlob", () => {
    it("splits on newlines, commas and semicolons", () => {
      const { emails } = parseEmailBlob("a@x.test\nb@x.test, c@x.test; d@x.test");
      expect(emails.sort()).toEqual(["a@x.test", "b@x.test", "c@x.test", "d@x.test"]);
    });

    it("normalises and dedupes", () => {
      const { emails } = parseEmailBlob("A@X.test\na@x.test\n  A@X.TEST  ");
      expect(emails).toEqual(["a@x.test"]);
    });

    it("counts what it could not read instead of failing the whole paste", () => {
      // These blobs come out of spreadsheets with headers and stray names in
      // them. Refusing 3 good addresses because one row said "Email" is worse.
      const { emails, rejected } = parseEmailBlob("Email\na@x.test\nJane Doe\nb@x.test\nc@x.test");
      expect(emails.sort()).toEqual(["a@x.test", "b@x.test", "c@x.test"]);
      expect(rejected).toBe(3);
    });
  });

  describe("suppressMany", () => {
    it("adds what is new and reports what was already there", async () => {
      const a = uniqueEmail("bulk-a");
      const b = uniqueEmail("bulk-b");
      await add(org.ctx, a);

      const result = await suppressMany(org.ctx, { emails: `${a}\n${b}`, reason: "UNSUBSCRIBED" });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error);
      expect(result.data.added).toBe(1);
      expect(result.data.alreadyPresent).toBe(1);

      expect(await isSuppressed(org.ctx, b)).toBe(true);
    });

    it("is idempotent — re-pasting the same export changes nothing", async () => {
      const blob = `${uniqueEmail("re-a")}\n${uniqueEmail("re-b")}`;

      const first = await suppressMany(org.ctx, { emails: blob });
      const second = await suppressMany(org.ctx, { emails: blob });
      expect(first.ok && first.data.added).toBe(2);
      expect(second.ok && second.data.added).toBe(0);
    });

    it("refuses a paste with no readable address in it", async () => {
      const result = await suppressMany(org.ctx, { emails: "Email\nJane Doe\n---" });
      expect(result.ok).toBe(false);
    });

    it("writes one audit row for the batch, not one per address", async () => {
      const before = await db.auditLog.count({
        where: { organizationId: org.org.id, entity: "Suppression", action: "suppress_bulk" },
      });

      await suppressMany(org.ctx, {
        emails: [uniqueEmail("aud-a"), uniqueEmail("aud-b"), uniqueEmail("aud-c")].join("\n"),
      });

      const after = await db.auditLog.count({
        where: { organizationId: org.org.id, entity: "Suppression", action: "suppress_bulk" },
      });
      expect(after - before).toBe(1);
    });
  });

  describe("listSuppressions", () => {
    it("is tenant scoped", async () => {
      const email = uniqueEmail("listed");
      await add(org.ctx, email);

      const mine = await listSuppressions(org.ctx, { q: email });
      const theirs = await listSuppressions(other.ctx, { q: email });
      expect(mine.rows).toHaveLength(1);
      expect(theirs.rows).toHaveLength(0);
    });

    it("matches a search case-insensitively", async () => {
      const email = uniqueEmail("Searchable");
      await add(org.ctx, email);

      const found = await listSuppressions(org.ctx, { q: email.toUpperCase() });
      expect(found.rows).toHaveLength(1);
    });

    it("degrades nonsense paging rather than throwing", async () => {
      const result = await listSuppressions(org.ctx, { page: -5, perPage: 10_000 });
      expect(result.page).toBe(1);
      expect(result.perPage).toBe(100);
    });
  });

  describe("permissions", () => {
    it("lets a rep suppress", async () => {
      const result = await suppress(repCtx, { email: uniqueEmail("rep-add") });
      expect(result.ok).toBe(true);
    });

    it("refuses a read-only caller", async () => {
      await expect(suppress(readOnlyCtx, { email: uniqueEmail("ro") })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(
        suppressMany(readOnlyCtx, { emails: uniqueEmail("ro-bulk") }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("does not let a rep unsuppress", async () => {
      const email = uniqueEmail("rep-remove");
      await add(org.ctx, email);
      const row = await db.suppression.findFirstOrThrow({
        where: { organizationId: org.org.id, email },
        select: { id: true },
      });

      // Adding is cautious and anyone can do it. Removing means contacting
      // someone who asked not to be contacted.
      await expect(unsuppress(repCtx, row.id)).rejects.toBeInstanceOf(ForbiddenError);
      expect(await isSuppressed(org.ctx, email)).toBe(true);
    });

    it("lets a manager unsuppress, and audits it", async () => {
      const email = uniqueEmail("mgr-remove");
      await add(org.ctx, email);
      const row = await db.suppression.findFirstOrThrow({
        where: { organizationId: org.org.id, email },
        select: { id: true },
      });

      const result = await unsuppress(managerCtx, row.id);
      expect(result.ok).toBe(true);
      expect(await isSuppressed(org.ctx, email)).toBe(false);

      const entries = await db.auditLog.findMany({
        where: { organizationId: org.org.id, entity: "Suppression", action: "unsuppress" },
        orderBy: { at: "desc" },
        take: 1,
      });
      expect(entries).toHaveLength(1);
    });

    it("cannot unsuppress another org's row", async () => {
      const email = uniqueEmail("cross");
      await add(other.ctx, email);
      const row = await db.suppression.findFirstOrThrow({
        where: { organizationId: other.org.id, email },
        select: { id: true },
      });

      const result = await unsuppress({ ...org.ctx, role: "OWNER" }, row.id);
      expect(result.ok).toBe(false);
      expect(await isSuppressed(other.ctx, email)).toBe(true);
    });
  });
});
