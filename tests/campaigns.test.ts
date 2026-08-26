import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { ForbiddenError, type Ctx } from "@/server/authz";
import {
  activateCampaign,
  addStep,
  archiveCampaign,
  completeCampaign,
  createCampaign,
  deleteCampaign,
  enroll,
  enrollList,
  getCampaign,
  listCampaigns,
  pauseCampaign,
  removeStep,
  reorderSteps,
  stopEnrollment,
  sweepDueEnrollments,
  updateCampaign,
  updateStep,
} from "@/server/services/campaigns";
import { createTemplate, upsertVariant } from "@/server/services/templates";
import { dropOrg, makeOrg } from "./factories";

/** Campaign and template names collide per org, so every test gets its own. */
const uniqueName = (label: string) => `${label}-${randomUUID().slice(0, 8)}`;

/**
 * Every time-dependent assertion is pinned to this instant.
 *
 * Services take an optional `now`, so the sweep can be run "a day later"
 * without sleeping and without the test being a different test at 23:59.
 */
const T0 = new Date("2026-08-26T09:00:00.000Z");
const minutesAfter = (from: Date, minutes: number) => new Date(from.getTime() + minutes * 60_000);

type StepSpec = { delayMinutes: number; instruction?: string; templateId?: string };

describe("campaigns", () => {
  let org: Awaited<ReturnType<typeof makeOrg>>;
  let other: Awaited<ReturnType<typeof makeOrg>>;

  let repCtx: Ctx;
  let readOnlyCtx: Ctx;

  /** Owned by the org OWNER — invisible to the rep below. */
  let ownerContactId: string;
  /** Owned by the rep. */
  let repContactId: string;
  /** Belongs to the other tenant entirely. */
  let foreignContactId: string;
  let leadId: string;

  /** Creates a campaign with the given steps, optionally started. */
  async function makeCampaign(
    ctx: Ctx,
    label: string,
    steps: StepSpec[],
    options: { activate?: boolean; listId?: string } = {},
  ): Promise<string> {
    const created = await createCampaign(ctx, {
      name: uniqueName(label),
      goal: "Book meetings",
      listId: options.listId ?? null,
    });
    if (!created.ok) throw new Error(created.error);

    for (const step of steps) {
      const added = await addStep(ctx, created.data.id, {
        delayMinutes: step.delayMinutes,
        instruction: step.instruction ?? "Do the thing",
        templateId: step.templateId ?? null,
      });
      if (!added.ok) throw new Error(added.error);
    }

    if (options.activate) {
      const activated = await activateCampaign(ctx, created.data.id, T0);
      if (!activated.ok) throw new Error(activated.error);
    }

    return created.data.id;
  }

  async function enrollContact(ctx: Ctx, campaignId: string, contactId: string, now = T0) {
    const result = await enroll(ctx, campaignId, { contactId }, now);
    if (!result.ok) throw new Error(result.error);
    return result.data;
  }

  const readEnrollment = (id: string) => db.enrollment.findUniqueOrThrow({ where: { id } });

  /**
   * Orgs created inside a test, torn down at the end.
   *
   * The sweep is org-wide by design, so any test that asserts on its RETURNED
   * COUNTS needs an organization nobody else has enrolled anyone into —
   * otherwise it is really asserting on the order the file happens to run in.
   */
  const scratchOrgs: string[] = [];

  async function makeScratchOrg() {
    const fresh = await makeOrg();
    scratchOrgs.push(fresh.org.id);

    const contact = await db.contact.create({
      data: {
        organizationId: fresh.org.id,
        firstName: "Dana",
        lastName: "Owner",
        email: "dana@example.com",
        ownerId: fresh.user.id,
      },
    });

    const rep = await db.user.create({
      data: {
        organizationId: fresh.org.id,
        email: `rep-${randomUUID().slice(0, 8)}@test.local`,
        role: "REP",
        passwordHash: "not-used-in-these-tests",
      },
    });
    const repContact = await db.contact.create({
      data: {
        organizationId: fresh.org.id,
        firstName: "Robin",
        lastName: "Rep",
        ownerId: rep.id,
      },
    });
    const lead = await db.lead.create({
      data: {
        organizationId: fresh.org.id,
        source: "MANUAL",
        dedupeKey: `lead-${randomUUID()}`,
        firstName: "Lee",
        ownerId: fresh.user.id,
      },
    });

    return {
      ...fresh,
      contactId: contact.id,
      repCtx: { userId: rep.id, organizationId: fresh.org.id, role: "REP" } as Ctx,
      repContactId: repContact.id,
      leadId: lead.id,
    };
  }

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

    ownerContactId = (
      await db.contact.create({
        data: {
          organizationId: org.org.id,
          firstName: "Dana",
          lastName: "Owner",
          email: "dana@example.com",
          ownerId: org.user.id,
        },
      })
    ).id;

    repContactId = (
      await db.contact.create({
        data: {
          organizationId: org.org.id,
          firstName: "Robin",
          lastName: "Rep",
          email: "robin@example.com",
          ownerId: rep.id,
        },
      })
    ).id;

    foreignContactId = (
      await db.contact.create({
        data: { organizationId: other.org.id, firstName: "Elsewhere", ownerId: other.user.id },
      })
    ).id;

    leadId = (
      await db.lead.create({
        data: {
          organizationId: org.org.id,
          source: "MANUAL",
          dedupeKey: `lead-${randomUUID()}`,
          firstName: "Lee",
          companyName: "Leadco",
          ownerId: org.user.id,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await dropOrg(org.org.id);
    await dropOrg(other.org.id);
    for (const id of scratchOrgs) await dropOrg(id);
  });

  // ─────────────── campaign lifecycle ───────────────

  it("creates a campaign in DRAFT, owned by its author", async () => {
    const id = await makeCampaign(org.ctx, "Q3 outbound", []);

    const loaded = await getCampaign(org.ctx, id);
    expect(loaded?.status).toBe("DRAFT");
    expect(loaded?.owner.id).toBe(org.user.id);
    expect(loaded?.steps).toEqual([]);
    expect(loaded?.enrollments).toEqual({ ACTIVE: 0, PAUSED: 0, COMPLETED: 0, STOPPED: 0 });
  });

  it("rejects a duplicate campaign name regardless of case", async () => {
    const name = uniqueName("Duplicate");
    const first = await createCampaign(org.ctx, { name });
    expect(first.ok).toBe(true);

    const second = await createCampaign(org.ctx, { name: name.toUpperCase() });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/already exists/);
  });

  it("lets a REP create but never a READ_ONLY viewer", async () => {
    const mine = await createCampaign(repCtx, { name: uniqueName("Rep campaign") });
    expect(mine.ok).toBe(true);

    await expect(createCampaign(readOnlyCtx, { name: uniqueName("Nope") })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("does not let a REP edit a campaign they do not own", async () => {
    const id = await makeCampaign(org.ctx, "Managers only", [{ delayMinutes: 0 }]);

    // Readable — a rep needs to know what a prospect is receiving …
    expect(await getCampaign(repCtx, id)).not.toBeNull();

    // … but not editable.
    const renamed = await updateCampaign(repCtx, id, { name: uniqueName("Hijacked") });
    expect(renamed.ok).toBe(false);

    const started = await activateCampaign(repCtx, id, T0);
    expect(started.ok).toBe(false);

    const step = await addStep(repCtx, id, { delayMinutes: 0, instruction: "sneak" });
    expect(step.ok).toBe(false);
  });

  it("only lets MANAGER+ delete or archive", async () => {
    const id = await makeCampaign(org.ctx, "Doomed", [{ delayMinutes: 0 }]);

    await expect(deleteCampaign(repCtx, id)).rejects.toThrow(ForbiddenError);
    await expect(archiveCampaign(repCtx, id)).rejects.toThrow(ForbiddenError);

    const removed = await deleteCampaign(org.ctx, id);
    expect(removed.ok).toBe(true);
    expect(await getCampaign(org.ctx, id)).toBeNull();
  });

  // ─────────────── sequence steps ───────────────

  it("derives step positions rather than taking them from the caller", async () => {
    const id = await makeCampaign(org.ctx, "Cadence", [
      { delayMinutes: 0, instruction: "one" },
      { delayMinutes: 60, instruction: "two" },
      { delayMinutes: 120, instruction: "three" },
    ]);

    const loaded = await getCampaign(org.ctx, id);
    expect(loaded?.steps.map((s) => s.position)).toEqual([1, 2, 3]);
    expect(loaded?.steps.map((s) => s.instruction)).toEqual(["one", "two", "three"]);
  });

  it("refuses a step with nothing for a person to do", async () => {
    const id = await makeCampaign(org.ctx, "Empty step", []);

    const empty = await addStep(org.ctx, id, { delayMinutes: 30 });
    expect(empty.ok).toBe(false);

    const added = await addStep(org.ctx, id, { delayMinutes: 30, instruction: "Call them" });
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    // And it cannot be emptied out afterwards either.
    const blanked = await updateStep(org.ctx, added.data.id, { instruction: "" });
    expect(blanked.ok).toBe(false);
  });

  it("rejects a template belonging to another tenant", async () => {
    const theirs = await createTemplate(other.ctx, {
      name: uniqueName("Theirs"),
      subject: "s",
      body: "b",
    });
    if (!theirs.ok) throw new Error(theirs.error);

    const id = await makeCampaign(org.ctx, "Foreign template", []);
    const added = await addStep(org.ctx, id, { delayMinutes: 0, templateId: theirs.data.id });
    expect(added.ok).toBe(false);
  });

  it("swaps two steps without tripping the unique position index", async () => {
    const id = await makeCampaign(org.ctx, "Reorder", [
      { delayMinutes: 0, instruction: "one" },
      { delayMinutes: 60, instruction: "two" },
      { delayMinutes: 120, instruction: "three" },
    ]);

    const before = await getCampaign(org.ctx, id);
    const [one, two, three] = before!.steps.map((s) => s.id);

    // The write order that a naive implementation dies on: step 2 moves into
    // slot 1 while step 1 still holds it.
    const reordered = await reorderSteps(org.ctx, id, [two, one, three]);
    expect(reordered.ok).toBe(true);

    const after = await getCampaign(org.ctx, id);
    expect(after?.steps.map((s) => s.instruction)).toEqual(["two", "one", "three"]);
    expect(after?.steps.map((s) => s.position)).toEqual([1, 2, 3]);
  });

  it("refuses a reorder that is not exactly the campaign's steps", async () => {
    const id = await makeCampaign(org.ctx, "Partial reorder", [
      { delayMinutes: 0, instruction: "one" },
      { delayMinutes: 60, instruction: "two" },
    ]);
    const steps = (await getCampaign(org.ctx, id))!.steps.map((s) => s.id);

    expect((await reorderSteps(org.ctx, id, [steps[0]])).ok).toBe(false);
    expect((await reorderSteps(org.ctx, id, [steps[0], steps[0]])).ok).toBe(false);

    const elsewhere = await makeCampaign(org.ctx, "Other cadence", [
      { delayMinutes: 0, instruction: "x" },
    ]);
    const foreignStep = (await getCampaign(org.ctx, elsewhere))!.steps[0].id;
    expect((await reorderSteps(org.ctx, id, [steps[0], foreignStep])).ok).toBe(false);

    // Nothing moved.
    expect((await getCampaign(org.ctx, id))!.steps.map((s) => s.position)).toEqual([1, 2]);
  });

  it("closes the gap when a step is removed", async () => {
    const id = await makeCampaign(org.ctx, "Removal", [
      { delayMinutes: 0, instruction: "one" },
      { delayMinutes: 60, instruction: "two" },
      { delayMinutes: 120, instruction: "three" },
    ]);
    const steps = (await getCampaign(org.ctx, id))!.steps;

    await expect(removeStep(repCtx, steps[0].id)).rejects.toThrow(ForbiddenError);

    const removed = await removeStep(org.ctx, steps[0].id);
    expect(removed.ok).toBe(true);

    const after = await getCampaign(org.ctx, id);
    expect(after?.steps.map((s) => s.position)).toEqual([1, 2]);
    expect(after?.steps.map((s) => s.instruction)).toEqual(["two", "three"]);
  });

  // ─────────────── activation ───────────────

  it("will not start a campaign with no steps", async () => {
    const id = await makeCampaign(org.ctx, "Stepless", []);

    const started = await activateCampaign(org.ctx, id, T0);
    expect(started.ok).toBe(false);
    if (!started.ok) expect(started.error).toMatch(/at least one step/);
    expect((await getCampaign(org.ctx, id))?.status).toBe("DRAFT");
  });

  it("will not start a campaign whose positions have a hole in them", async () => {
    const id = await makeCampaign(org.ctx, "Holed", [
      { delayMinutes: 0, instruction: "one" },
      { delayMinutes: 60, instruction: "two" },
    ]);
    const steps = (await getCampaign(org.ctx, id))!.steps;

    // Deleting behind the service's back is the only way to make this state —
    // which is exactly why the guard exists.
    await db.sequenceStep.delete({ where: { id: steps[0].id } });

    const started = await activateCampaign(org.ctx, id, T0);
    expect(started.ok).toBe(false);
    if (!started.ok) expect(started.error).toMatch(/numbered wrong/);
  });

  it("starts a campaign and stamps startedAt once", async () => {
    const id = await makeCampaign(org.ctx, "Live", [{ delayMinutes: 0, instruction: "go" }]);

    const started = await activateCampaign(org.ctx, id, T0);
    expect(started.ok).toBe(true);

    const loaded = await getCampaign(org.ctx, id);
    expect(loaded?.status).toBe("ACTIVE");
    expect(loaded?.startedAt).toEqual(T0);

    // Re-activating an already running campaign is a no-op, not a restart.
    const again = await activateCampaign(org.ctx, id, minutesAfter(T0, 90));
    expect(again.ok).toBe(true);
    expect((await getCampaign(org.ctx, id))?.startedAt).toEqual(T0);
  });

  // ─────────────── enrollment ───────────────

  it("schedules the first step from the enrollment, not from creation", async () => {
    const id = await makeCampaign(
      org.ctx,
      "Scheduled",
      [
        { delayMinutes: 30, instruction: "one" },
        { delayMinutes: 1440, instruction: "two" },
      ],
      { activate: true },
    );

    const enrolled = await enrollContact(org.ctx, id, ownerContactId);
    const row = await readEnrollment(enrolled.id);

    expect(row.state).toBe("ACTIVE");
    expect(row.currentPosition).toBe(0);
    expect(row.nextDueAt).toEqual(minutesAfter(T0, 30));
  });

  it("is idempotent: enrolling the same contact twice is a no-op", async () => {
    const id = await makeCampaign(org.ctx, "Idempotent", [{ delayMinutes: 0, instruction: "go" }], {
      activate: true,
    });

    const first = await enrollContact(org.ctx, id, ownerContactId);
    const second = await enrollContact(org.ctx, id, ownerContactId, minutesAfter(T0, 600));

    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
    expect(await db.enrollment.count({ where: { campaignId: id } })).toBe(1);

    // And the re-run did not reschedule the prospect either.
    expect((await readEnrollment(first.id)).nextDueAt).toEqual(T0);
  });

  it("assigns the same variant on a re-enrollment", async () => {
    const template = await createTemplate(org.ctx, {
      name: uniqueName("AB"),
      subject: "Base",
      body: "Base body",
    });
    if (!template.ok) throw new Error(template.error);
    await upsertVariant(org.ctx, template.data.id, { label: "A", subject: "A", body: "A body" });
    await upsertVariant(org.ctx, template.data.id, { label: "B", subject: "B", body: "B body" });

    const id = await makeCampaign(
      org.ctx,
      "Experiment",
      [{ delayMinutes: 0, instruction: "send", templateId: template.data.id }],
      { activate: true },
    );

    const first = await enrollContact(org.ctx, id, ownerContactId);
    expect(["A", "B"]).toContain(first.variantLabel);

    // Tear the enrollment down and do it again — the bucket is derived from
    // (campaign, record), so the prospect cannot flip arms.
    await db.enrollment.delete({ where: { id: first.id } });
    const second = await enrollContact(org.ctx, id, ownerContactId);
    expect(second.variantLabel).toBe(first.variantLabel);

    // A second enroll of the same record without deleting also cannot flip it.
    const third = await enrollContact(org.ctx, id, ownerContactId);
    expect(third.variantLabel).toBe(first.variantLabel);
  });

  it("enrolls a lead as readily as a contact", async () => {
    const id = await makeCampaign(org.ctx, "Leads too", [{ delayMinutes: 0, instruction: "go" }], {
      activate: true,
    });

    const result = await enroll(org.ctx, id, { leadId }, T0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = await readEnrollment(result.data.id);
    expect(row.leadId).toBe(leadId);
    expect(row.contactId).toBeNull();

    // Same lead again: still one row.
    const again = await enroll(org.ctx, id, { leadId }, T0);
    expect(again.ok && again.data.created).toBe(false);
    expect(await db.enrollment.count({ where: { campaignId: id } })).toBe(1);
  });

  it("refuses a payload naming both a contact and a lead", async () => {
    const id = await makeCampaign(org.ctx, "Ambiguous", [{ delayMinutes: 0, instruction: "go" }], {
      activate: true,
    });

    const result = await enroll(org.ctx, id, { contactId: ownerContactId, leadId }, T0);
    expect(result.ok).toBe(false);
  });

  it("lets a REP enroll their own contact but not a colleague's", async () => {
    const id = await makeCampaign(org.ctx, "Rep enrolls", [{ delayMinutes: 0, instruction: "go" }], {
      activate: true,
    });

    const mine = await enroll(repCtx, id, { contactId: repContactId }, T0);
    expect(mine.ok).toBe(true);

    const theirs = await enroll(repCtx, id, { contactId: ownerContactId }, T0);
    expect(theirs.ok).toBe(false);
    if (!theirs.ok) expect(theirs.error).toMatch(/does not exist/);

    // Nothing was written for the colleague's contact.
    expect(await db.enrollment.count({ where: { campaignId: id, contactId: ownerContactId } })).toBe(
      0,
    );
  });

  it("cannot enroll another tenant's record", async () => {
    const id = await makeCampaign(org.ctx, "Tenant scoped", [{ delayMinutes: 0, instruction: "go" }], {
      activate: true,
    });

    const result = await enroll(org.ctx, id, { contactId: foreignContactId }, T0);
    expect(result.ok).toBe(false);
    expect(await db.enrollment.count({ where: { campaignId: id } })).toBe(0);
  });

  it("cannot enroll into another tenant's campaign", async () => {
    const id = await makeCampaign(org.ctx, "Ours", [{ delayMinutes: 0, instruction: "go" }], {
      activate: true,
    });

    const result = await enroll(other.ctx, id, { contactId: foreignContactId }, T0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not found/);
  });

  it("refuses to enroll anyone into a campaign with no steps", async () => {
    const id = await makeCampaign(org.ctx, "Nothing to do", []);
    const result = await enroll(org.ctx, id, { contactId: ownerContactId }, T0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/at least one step/);
  });

  it("enrolls a prospect list, and re-running it only picks up newcomers", async () => {
    const list = await db.prospectList.create({
      data: { organizationId: org.org.id, name: uniqueName("ICP"), ownerId: org.user.id },
    });
    await db.prospectListMember.create({
      data: { organizationId: org.org.id, listId: list.id, contactId: ownerContactId },
    });

    const id = await makeCampaign(org.ctx, "From list", [{ delayMinutes: 0, instruction: "go" }], {
      activate: true,
      listId: list.id,
    });

    const first = await enrollList(org.ctx, id, { now: T0 });
    expect(first.ok && first.data).toEqual({ enrolled: 1, alreadyEnrolled: 0, skipped: 0 });

    await db.prospectListMember.create({
      data: { organizationId: org.org.id, listId: list.id, leadId },
    });

    const second = await enrollList(org.ctx, id, { now: T0 });
    expect(second.ok && second.data).toEqual({ enrolled: 1, alreadyEnrolled: 1, skipped: 0 });
    expect(await db.enrollment.count({ where: { campaignId: id } })).toBe(2);
  });

  // ─────────────── pause, resume, stop ───────────────

  it("pauses enrollments with the campaign and resumes them on a fresh clock", async () => {
    const id = await makeCampaign(
      org.ctx,
      "Pausable",
      [
        { delayMinutes: 60, instruction: "one" },
        { delayMinutes: 1440, instruction: "two" },
      ],
      { activate: true },
    );
    const enrolled = await enrollContact(org.ctx, id, ownerContactId);

    const paused = await pauseCampaign(org.ctx, id);
    expect(paused.ok && paused.data.paused).toBe(1);

    const held = await readEnrollment(enrolled.id);
    expect(held.state).toBe("PAUSED");
    // Nulled, so the sweep's (state, nextDueAt) index never sees it.
    expect(held.nextDueAt).toBeNull();

    const resumedAt = minutesAfter(T0, 10_000);
    const resumed = await activateCampaign(org.ctx, id, resumedAt);
    expect(resumed.ok && resumed.data.resumed).toBe(1);

    const running = await readEnrollment(enrolled.id);
    expect(running.state).toBe("ACTIVE");
    // Restarted from the resume, not the original due date — a week-long pause
    // must not wake up and fire the whole backlog at once.
    expect(running.nextDueAt).toEqual(minutesAfter(resumedAt, 60));
  });

  it("never resumes a stopped enrollment", async () => {
    const id = await makeCampaign(
      org.ctx,
      "Stop wins",
      [
        { delayMinutes: 0, instruction: "one" },
        { delayMinutes: 60, instruction: "two" },
      ],
      { activate: true },
    );
    const stopped = await enrollContact(org.ctx, id, ownerContactId);
    const running = await enrollContact(org.ctx, id, repContactId);

    const result = await stopEnrollment(org.ctx, stopped.id, "Replied");
    expect(result.ok && result.data.stopped).toBe(true);
    expect((await readEnrollment(stopped.id)).nextDueAt).toBeNull();

    await pauseCampaign(org.ctx, id);
    expect((await readEnrollment(stopped.id)).state).toBe("STOPPED");

    await activateCampaign(org.ctx, id, minutesAfter(T0, 500));

    const after = await readEnrollment(stopped.id);
    expect(after.state).toBe("STOPPED");
    expect(after.stoppedReason).toBe("Replied");
    expect(after.nextDueAt).toBeNull();
    // The one that was merely paused did come back.
    expect((await readEnrollment(running.id)).state).toBe("ACTIVE");

    // Stopping twice is a no-op, not an error.
    const again = await stopEnrollment(org.ctx, stopped.id, "Replied again");
    expect(again.ok && again.data.stopped).toBe(false);
    expect((await readEnrollment(stopped.id)).stoppedReason).toBe("Replied");
  });

  it("cannot stop an enrollment in another tenant", async () => {
    const id = await makeCampaign(org.ctx, "Not yours", [{ delayMinutes: 0, instruction: "go" }], {
      activate: true,
    });
    const enrolled = await enrollContact(org.ctx, id, ownerContactId);

    const result = await stopEnrollment(other.ctx, enrolled.id, "meddling");
    expect(result.ok).toBe(false);
    expect((await readEnrollment(enrolled.id)).state).toBe("ACTIVE");
  });

  it("closes in-flight enrollments when the campaign ends or is archived", async () => {
    const completing = await makeCampaign(
      org.ctx,
      "Finished",
      [{ delayMinutes: 60, instruction: "one" }],
      { activate: true },
    );
    const completed = await enrollContact(org.ctx, completing, ownerContactId);
    const done = await completeCampaign(org.ctx, completing, minutesAfter(T0, 5));
    expect(done.ok && done.data.closed).toBe(1);

    const closedRow = await readEnrollment(completed.id);
    expect(closedRow.state).toBe("COMPLETED");
    expect(closedRow.nextDueAt).toBeNull();
    expect((await getCampaign(org.ctx, completing))?.status).toBe("COMPLETED");
    // A finished campaign takes no more prospects.
    expect((await enroll(org.ctx, completing, { contactId: repContactId }, T0)).ok).toBe(false);

    const archiving = await makeCampaign(
      org.ctx,
      "Shelved",
      [{ delayMinutes: 60, instruction: "one" }],
      { activate: true },
    );
    const shelved = await enrollContact(org.ctx, archiving, ownerContactId);
    const archived = await archiveCampaign(org.ctx, archiving);
    expect(archived.ok && archived.data.stopped).toBe(1);

    const shelvedRow = await readEnrollment(shelved.id);
    // Stopped, not completed: they never saw the rest of the cadence.
    expect(shelvedRow.state).toBe("STOPPED");
    expect(shelvedRow.stoppedReason).toMatch(/archived/i);
  });

  // ─────────────── the sweep ───────────────
  //
  // Every test below runs in its own organization: the sweep is org-wide, so
  // asserting on its counts inside the shared fixture would really be
  // asserting on the order the file runs in.

  it("turns a due step into a task and schedules the next one", async () => {
    const tenant = await makeScratchOrg();

    const template = await createTemplate(tenant.ctx, {
      name: uniqueName("Intro"),
      subject: "Quick question, {{first_name}}",
      body: "Hi {{first_name}} — worth a chat?",
    });
    if (!template.ok) throw new Error(template.error);

    const id = await makeCampaign(
      tenant.ctx,
      "Sweepable",
      [
        { delayMinutes: 0, instruction: "Send the intro", templateId: template.data.id },
        { delayMinutes: 1440, instruction: "Bump" },
      ],
      { activate: true },
    );
    const enrolled = await enrollContact(tenant.ctx, id, tenant.contactId);

    const swept = await sweepDueEnrollments({ organizationId: tenant.org.id, now: T0 });
    expect(swept).toEqual({ scanned: 1, tasksCreated: 1, advanced: 1, completed: 0, failed: 0 });

    const row = await readEnrollment(enrolled.id);
    expect(row.currentPosition).toBe(1);
    expect(row.state).toBe("ACTIVE");
    // Measured from THIS step completing, not from enrollment.
    expect(row.nextDueAt).toEqual(minutesAfter(T0, 1440));

    const task = await db.task.findFirstOrThrow({
      where: { organizationId: tenant.org.id, contactId: tenant.contactId },
    });
    expect(task.assigneeId).toBe(tenant.user.id); // the record's owner
    expect(task.dueAt).toEqual(T0);
    expect(task.title).toContain("Send the intro");
    expect(task.notes).toContain("Quick question, Dana"); // merge fields rendered
    expect(task.notes).toContain("worth a chat?");
    // The whole point: nothing was sent, and the task says so.
    expect(task.notes).toMatch(/Sending is not automated yet/);

    // The step being reached is recorded — as reached, not as sent.
    const audit = await db.auditLog.findFirstOrThrow({
      where: {
        organizationId: tenant.org.id,
        entity: "Enrollment",
        entityId: enrolled.id,
        action: "step-due",
      },
    });
    // "step-due", never "sent" — the audit trail must not claim delivery.
    expect(audit.after).toMatchObject({ currentPosition: 1, completed: false });

    // Running the sweep again at the same instant does nothing: the next step
    // is not due yet, so nobody gets a second task.
    const second = await sweepDueEnrollments({ organizationId: tenant.org.id, now: T0 });
    expect(second.scanned).toBe(0);
    expect(await db.task.count({ where: { organizationId: tenant.org.id } })).toBe(1);
  });

  it("completes an enrollment after its last step", async () => {
    const tenant = await makeScratchOrg();
    const id = await makeCampaign(
      tenant.ctx,
      "Two steps",
      [
        { delayMinutes: 0, instruction: "one" },
        { delayMinutes: 60, instruction: "two" },
      ],
      { activate: true },
    );
    const enrolled = await enrollContact(tenant.ctx, id, tenant.contactId);

    await sweepDueEnrollments({ organizationId: tenant.org.id, now: T0 });

    const later = minutesAfter(T0, 60);
    const swept = await sweepDueEnrollments({ organizationId: tenant.org.id, now: later });
    expect(swept).toEqual({ scanned: 1, tasksCreated: 1, advanced: 1, completed: 1, failed: 0 });

    const row = await readEnrollment(enrolled.id);
    expect(row.state).toBe("COMPLETED");
    expect(row.currentPosition).toBe(2);
    expect(row.nextDueAt).toBeNull();
    expect(row.completedAt).toEqual(later);

    // Finished rows stay out of every later sweep.
    const muchLater = await sweepDueEnrollments({
      organizationId: tenant.org.id,
      now: minutesAfter(later, 10_000),
    });
    expect(muchLater.scanned).toBe(0);
  });

  it("leaves enrollments alone until they are due, and while the campaign is not running", async () => {
    const tenant = await makeScratchOrg();

    const running = await makeCampaign(
      tenant.ctx,
      "Not yet",
      [{ delayMinutes: 120, instruction: "later" }],
      { activate: true },
    );
    const waiting = await enrollContact(tenant.ctx, running, tenant.contactId);

    const draft = await makeCampaign(tenant.ctx, "Still drafting", [
      { delayMinutes: 0, instruction: "now" },
    ]);
    const audience = await enrollContact(tenant.ctx, draft, tenant.repContactId);

    const swept = await sweepDueEnrollments({
      organizationId: tenant.org.id,
      now: minutesAfter(T0, 60),
    });
    expect(swept.scanned).toBe(0);

    expect((await readEnrollment(waiting.id)).currentPosition).toBe(0);
    // A draft campaign can have its audience built in advance without that
    // audience receiving anything.
    expect((await readEnrollment(audience.id)).currentPosition).toBe(0);
  });

  it("does not advance a paused enrollment", async () => {
    const tenant = await makeScratchOrg();
    const id = await makeCampaign(tenant.ctx, "Held", [{ delayMinutes: 0, instruction: "one" }], {
      activate: true,
    });
    const enrolled = await enrollContact(tenant.ctx, id, tenant.contactId);
    await pauseCampaign(tenant.ctx, id);

    const swept = await sweepDueEnrollments({
      organizationId: tenant.org.id,
      now: minutesAfter(T0, 10),
    });
    expect(swept.scanned).toBe(0);
    expect((await readEnrollment(enrolled.id)).currentPosition).toBe(0);
  });

  it("is bounded by the take cap", async () => {
    const tenant = await makeScratchOrg();
    const id = await makeCampaign(tenant.ctx, "Backlog", [{ delayMinutes: 0, instruction: "one" }], {
      activate: true,
    });
    await enrollContact(tenant.ctx, id, tenant.contactId);
    await enrollContact(tenant.ctx, id, tenant.repContactId);
    await enroll(tenant.ctx, id, { leadId: tenant.leadId }, T0);

    // Three due, two per run: the backlog drains over successive ticks rather
    // than one run trying to do everything.
    const first = await sweepDueEnrollments({ organizationId: tenant.org.id, now: T0, limit: 2 });
    expect(first.scanned).toBe(2);

    const second = await sweepDueEnrollments({ organizationId: tenant.org.id, now: T0, limit: 2 });
    expect(second.scanned).toBe(1);

    const third = await sweepDueEnrollments({ organizationId: tenant.org.id, now: T0, limit: 2 });
    expect(third.scanned).toBe(0);
  });

  it("sweeps one tenant without touching another", async () => {
    const tenant = await makeScratchOrg();
    const neighbour = await makeScratchOrg();

    const mine = await makeCampaign(tenant.ctx, "Mine", [{ delayMinutes: 0, instruction: "one" }], {
      activate: true,
    });
    const ours = await enrollContact(tenant.ctx, mine, tenant.contactId);

    const theirs = await makeCampaign(
      neighbour.ctx,
      "Theirs",
      [{ delayMinutes: 0, instruction: "one" }],
      { activate: true },
    );
    const theirEnrollment = await enrollContact(neighbour.ctx, theirs, neighbour.contactId);

    const swept = await sweepDueEnrollments({ organizationId: tenant.org.id, now: T0 });
    expect(swept.scanned).toBe(1);

    expect((await readEnrollment(ours.id)).currentPosition).toBe(1);
    expect((await readEnrollment(theirEnrollment.id)).currentPosition).toBe(0);
    expect(await db.task.count({ where: { organizationId: neighbour.org.id } })).toBe(0);
  });

  it("assigns the task to the record's owner, not the campaign's", async () => {
    const tenant = await makeScratchOrg();
    const id = await makeCampaign(
      tenant.ctx,
      "Handoff",
      [{ delayMinutes: 0, instruction: "Call them" }],
      { activate: true },
    );
    const enrolled = await enrollContact(tenant.ctx, id, tenant.repContactId);

    await sweepDueEnrollments({ organizationId: tenant.org.id, now: T0 });

    const task = await db.task.findFirstOrThrow({
      where: { organizationId: tenant.org.id, contactId: tenant.repContactId },
    });
    expect(task.assigneeId).toBe(tenant.repCtx.userId);
    expect(task.title).toContain("Robin Rep");
    expect((await readEnrollment(enrolled.id)).currentPosition).toBe(1);
  });


  it("lists campaigns for the tenant and nobody else's", async () => {
    const mine = await listCampaigns(org.ctx);
    const theirs = await listCampaigns(other.ctx);

    expect(mine.length).toBeGreaterThan(0);
    const ids = new Set(mine.map((c) => c.id));
    for (const campaign of theirs) expect(ids.has(campaign.id)).toBe(false);
  });
});
