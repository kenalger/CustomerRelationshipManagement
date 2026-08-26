import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { ForbiddenError, type Ctx } from "@/server/authz";
import {
  copyFor,
  createTemplate,
  deleteTemplate,
  deleteVariant,
  getTemplate,
  listTemplates,
  pickVariantLabel,
  renderCopy,
  updateTemplate,
  upsertVariant,
} from "@/server/services/templates";
import { dropOrg, makeOrg } from "./factories";

/** Template names collide per org, so every test gets its own. */
const uniqueName = (label: string) => `${label}-${randomUUID().slice(0, 8)}`;

async function makeTemplate(ctx: Ctx, name: string, subject = "Hello", body = "Body") {
  const result = await createTemplate(ctx, { name, subject, body });
  if (!result.ok) throw new Error(result.error);
  return result.data.id;
}

describe("templates", () => {
  let org: Awaited<ReturnType<typeof makeOrg>>;
  let other: Awaited<ReturnType<typeof makeOrg>>;
  let repCtx: Ctx;
  let readOnlyCtx: Ctx;

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

    const viewer = await db.user.create({
      data: {
        organizationId: org.org.id,
        email: `viewer-${randomUUID().slice(0, 8)}@test.local`,
        role: "READ_ONLY",
        passwordHash: "not-used-in-these-tests",
      },
    });
    readOnlyCtx = { userId: viewer.id, organizationId: org.org.id, role: "READ_ONLY" };
  });

  afterAll(async () => {
    await dropOrg(org.org.id);
    await dropOrg(other.org.id);
  });

  // ─────────────── lifecycle ───────────────

  it("creates a template and reads it back", async () => {
    const name = uniqueName("Intro");
    const id = await makeTemplate(org.ctx, name, "Quick question", "Hi {{first_name}}");

    const loaded = await getTemplate(org.ctx, id);
    expect(loaded?.name).toBe(name);
    expect(loaded?.subject).toBe("Quick question");
    expect(loaded?.variants).toEqual([]);
  });

  it("rejects a duplicate name regardless of case", async () => {
    const name = uniqueName("Follow up");
    await makeTemplate(org.ctx, name);

    const clash = await createTemplate(org.ctx, {
      name: name.toUpperCase(),
      subject: "s",
      body: "b",
    });
    expect(clash.ok).toBe(false);
    if (!clash.ok) expect(clash.error).toMatch(/already exists/);
  });

  it("validates the shape rather than throwing", async () => {
    const bad = await createTemplate(org.ctx, { name: "  ", subject: "", body: "" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.fieldErrors ?? {})).toContain("name");
  });

  it("lets a REP write but not a READ_ONLY viewer", async () => {
    const id = await makeTemplate(repCtx, uniqueName("Rep copy"));
    expect(id).toBeTruthy();

    await expect(createTemplate(readOnlyCtx, { name: uniqueName("nope"), subject: "s", body: "b" }))
      .rejects.toThrow(ForbiddenError);
  });

  it("updates copy and allows re-casing its own name", async () => {
    const name = uniqueName("Nudge");
    const id = await makeTemplate(org.ctx, name);

    const updated = await updateTemplate(org.ctx, id, {
      name: name.toUpperCase(),
      subject: "New subject",
    });
    expect(updated.ok).toBe(true);

    const loaded = await getTemplate(org.ctx, id);
    expect(loaded?.name).toBe(name.toUpperCase());
    expect(loaded?.subject).toBe("New subject");
    expect(loaded?.body).toBe("Body"); // untouched
  });

  it("only lets MANAGER+ delete", async () => {
    const id = await makeTemplate(org.ctx, uniqueName("Doomed"));
    await expect(deleteTemplate(repCtx, id)).rejects.toThrow(ForbiddenError);

    const removed = await deleteTemplate(org.ctx, id);
    expect(removed.ok).toBe(true);
    expect(await getTemplate(org.ctx, id)).toBeNull();
  });

  it("leaves the sequence step standing when its template is deleted", async () => {
    const id = await makeTemplate(org.ctx, uniqueName("Cascade"));
    const campaign = await db.campaign.create({
      data: {
        organizationId: org.org.id,
        name: uniqueName("Cascade campaign"),
        ownerId: org.user.id,
      },
    });
    const step = await db.sequenceStep.create({
      data: {
        organizationId: org.org.id,
        campaignId: campaign.id,
        position: 1,
        templateId: id,
        instruction: "Send it",
      },
    });

    const removed = await deleteTemplate(org.ctx, id);
    expect(removed.ok).toBe(true);
    if (removed.ok) expect(removed.data.stepsAffected).toBe(1);

    const survivor = await db.sequenceStep.findUnique({ where: { id: step.id } });
    expect(survivor).not.toBeNull();
    expect(survivor?.templateId).toBeNull();
    expect(survivor?.instruction).toBe("Send it");
  });

  // ─────────────── tenancy ───────────────

  it("cannot see or write another tenant's template", async () => {
    const mine = await makeTemplate(org.ctx, uniqueName("Private"));

    expect(await getTemplate(other.ctx, mine)).toBeNull();
    expect(await listTemplates(other.ctx)).toEqual([]);

    const edit = await updateTemplate(other.ctx, mine, { subject: "hijacked" });
    expect(edit.ok).toBe(false);

    const gone = await deleteTemplate(other.ctx, mine);
    expect(gone.ok).toBe(false);

    // And the row is untouched.
    expect((await getTemplate(org.ctx, mine))?.subject).toBe("Hello");
  });

  it("cannot attach a variant to another tenant's template", async () => {
    const mine = await makeTemplate(org.ctx, uniqueName("Shielded"));
    const attempt = await upsertVariant(other.ctx, mine, { label: "B", subject: "s", body: "b" });
    expect(attempt.ok).toBe(false);
    expect((await getTemplate(org.ctx, mine))?.variants).toEqual([]);
  });

  // ─────────────── variants ───────────────

  it("upserts variants and normalises the label's case", async () => {
    const id = await makeTemplate(org.ctx, uniqueName("Experiment"));

    const first = await upsertVariant(org.ctx, id, { label: "b", subject: "B subject", body: "B" });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.data.label).toBe("B");

    // Same arm, lower case again — an update, not a second row.
    const second = await upsertVariant(org.ctx, id, {
      label: "B",
      subject: "B subject v2",
      body: "B2",
    });
    expect(second.ok).toBe(true);

    const loaded = await getTemplate(org.ctx, id);
    expect(loaded?.variants).toHaveLength(1);
    expect(loaded?.variants[0].subject).toBe("B subject v2");
  });

  it("only lets MANAGER+ delete a variant", async () => {
    const id = await makeTemplate(org.ctx, uniqueName("Armed"));
    await upsertVariant(org.ctx, id, { label: "B", subject: "s", body: "b" });

    await expect(deleteVariant(repCtx, id, "B")).rejects.toThrow(ForbiddenError);

    const removed = await deleteVariant(org.ctx, id, "b");
    expect(removed.ok).toBe(true);
    if (removed.ok) expect(removed.data.removed).toBe(true);
    expect((await getTemplate(org.ctx, id))?.variants).toEqual([]);
  });

  // ─────────────── deterministic bucketing (pure) ───────────────

  it("assigns the same variant for the same seed, every time", async () => {
    const labels = ["A", "B"];
    const seed = "campaign-1:contact-42";

    const first = pickVariantLabel(labels, seed);
    const second = pickVariantLabel(labels, seed);
    const third = pickVariantLabel(labels, seed);

    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(labels).toContain(first);
  });

  it("does not depend on the order the labels came back in", () => {
    const seed = "campaign-1:contact-42";
    expect(pickVariantLabel(["A", "B", "C"], seed)).toBe(pickVariantLabel(["C", "B", "A"], seed));
  });

  it("spreads seeds across every arm", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 300; i++) {
      const label = pickVariantLabel(["A", "B"], `campaign:contact-${i}`);
      counts.set(label!, (counts.get(label!) ?? 0) + 1);
    }

    expect(counts.get("A")).toBeGreaterThan(0);
    expect(counts.get("B")).toBeGreaterThan(0);
    // Not a distribution test — just proof it is not a constant.
    expect(counts.get("A")! + counts.get("B")!).toBe(300);
  });

  it("has no variant to pick when there are none", () => {
    expect(pickVariantLabel([], "anything")).toBeNull();
  });

  // ─────────────── resolving copy (pure) ───────────────

  it("resolves the assigned variant, and falls back when it is missing", () => {
    const template = {
      subject: "Base subject",
      body: "Base body",
      variants: [{ label: "B", subject: "B subject", body: "B body" }],
    };

    expect(copyFor(template, "B")).toEqual({ subject: "B subject", body: "B body" });
    // Step not part of the experiment, or the arm was deleted mid-flight.
    expect(copyFor(template, "C")).toEqual({ subject: "Base subject", body: "Base body" });
    expect(copyFor(template, null)).toEqual({ subject: "Base subject", body: "Base body" });
  });

  it("substitutes merge fields and never leaves a placeholder behind", () => {
    const rendered = renderCopy(
      { subject: "Hi {{ first_name }}", body: "About {{company}} — {{unknown}}" },
      { first_name: "Dana", company: "Acme" },
    );

    expect(rendered.subject).toBe("Hi Dana");
    expect(rendered.body).toBe("About Acme — ");
  });
});
