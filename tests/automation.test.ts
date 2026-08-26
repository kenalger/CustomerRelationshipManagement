import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import type { LeadStatus } from "@/generated/prisma/enums";
import type { Ctx } from "@/server/authz";
import type { Result } from "@/server/result";
import {
  type AutomationEvent,
  createAutomation,
  deleteAutomation,
  dispatch,
  getAutomation,
  insideAutomationRun,
  listAutomations,
  listRuns,
  setAutomationEnabled,
  setSteps,
  updateAutomation,
} from "@/server/services/automation";
import { dropOrg, makeOrg } from "./factories";

/**
 * The automation engine, against real Postgres.
 *
 * Everything here runs sequentially — no `Promise.all` over service calls or
 * transactions, which this pg adapter answers with `08P01`.
 */

/** Automation names collide per org, so every rule gets its own. */
const uniqueName = (label: string) => `${label}-${randomUUID().slice(0, 8)}`;

/** Unwraps a `Result`, failing loudly rather than returning a falsy default. */
function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

const DAY = 86_400_000;

describe("automation", () => {
  let org: Awaited<ReturnType<typeof makeOrg>>;
  let other: Awaited<ReturnType<typeof makeOrg>>;

  let ownerCtx: Ctx;
  let adminCtx: Ctx;
  let managerCtx: Ctx;
  let repCtx: Ctx;
  let readOnlyCtx: Ctx;

  /** A real REP user, so "a record owned by someone else" is a real someone. */
  let repId: string;
  let otherRepId: string;
  let tagId: string;

  const as = (role: Ctx["role"], userId?: string): Ctx => ({
    ...org.ctx,
    role,
    userId: userId ?? org.ctx.userId,
  });

  async function makeUser(role: Ctx["role"]) {
    const user = await db.user.create({
      data: {
        organizationId: org.org.id,
        email: `${role.toLowerCase()}-${randomUUID().slice(0, 8)}@test.local`,
        role,
        passwordHash: "not-used-in-these-tests",
      },
      select: { id: true },
    });
    return user.id;
  }

  async function makeLead(input: {
    ownerId?: string | null;
    status?: LeadStatus;
    score?: number;
    organizationId?: string;
  }) {
    const lead = await db.lead.create({
      data: {
        organizationId: input.organizationId ?? org.org.id,
        source: "WEB_FORM",
        status: input.status ?? "NEW",
        score: input.score ?? 0,
        firstName: "Test",
        lastName: randomUUID().slice(0, 8),
        dedupeKey: randomUUID(),
        ownerId: input.ownerId ?? null,
      },
      select: { id: true },
    });
    return lead.id;
  }

  /** A live rule: created, stepped, enabled. Returns its id. */
  async function makeAutomation(input: {
    trigger: AutomationEvent["trigger"];
    steps: unknown[];
    conditions?: unknown;
    dailyRunLimit?: number;
    enabled?: boolean;
  }) {
    const created = unwrap(
      await createAutomation(managerCtx, {
        name: uniqueName("Rule"),
        trigger: input.trigger,
        conditions: input.conditions,
        dailyRunLimit: input.dailyRunLimit,
      }),
    );
    unwrap(await setSteps(managerCtx, created.id, input.steps));
    if (input.enabled !== false) unwrap(await setAutomationEnabled(adminCtx, created.id, true));
    return created.id;
  }

  const eventFor = (
    trigger: AutomationEvent["trigger"],
    recordId: string,
    overrides: Partial<AutomationEvent> = {},
  ): AutomationEvent => ({
    organizationId: org.org.id,
    trigger,
    recordKind: "LEAD",
    recordId,
    triggerEventId: randomUUID(),
    ...overrides,
  });

  const runsFor = (automationId: string) =>
    db.automationRun.findMany({
      where: { automationId },
      orderBy: { startedAt: "asc" },
      select: { status: true, error: true, log: true, recordId: true, finishedAt: true },
    });

  beforeAll(async () => {
    org = await makeOrg();
    other = await makeOrg();

    ownerCtx = org.ctx;
    repId = await makeUser("REP");
    otherRepId = await makeUser("REP");

    adminCtx = as("ADMIN");
    managerCtx = as("MANAGER");
    repCtx = as("REP", repId);
    readOnlyCtx = as("READ_ONLY");

    const tag = await db.tag.create({
      data: { organizationId: org.org.id, name: uniqueName("Tag") },
      select: { id: true },
    });
    tagId = tag.id;
  });

  /**
   * Every test disarms the org on its way out.
   *
   * The whole file shares one organization, and `dispatch` deliberately runs
   * EVERY enabled rule listening to a trigger — so without this, a rule left
   * armed by an earlier test fires on a later test's event and every
   * `matched`/`ran` count drifts. Disabling is the same lever a user has, and
   * it keeps each test's totals about its own rules.
   */
  afterEach(async () => {
    await db.automation.updateMany({
      where: { organizationId: org.org.id, enabled: true },
      data: { enabled: false },
    });
  });

  afterAll(async () => {
    await dropOrg(org.org.id);
    await dropOrg(other.org.id);
  });

  // ─────────────────────────── lifecycle ───────────────────────────

  describe("lifecycle", () => {
    it("creates a rule disabled, whatever the payload says", async () => {
      const created = unwrap(
        await createAutomation(managerCtx, {
          name: uniqueName("Draft"),
          trigger: "LEAD_CREATED",
          description: "  routes new leads  ",
        }),
      );

      const automation = unwrap(await getAutomation(managerCtx, created.id));
      expect(automation.enabled).toBe(false);
      expect(automation.description).toBe("routes new leads");
      expect(automation.dailyRunLimit).toBe(500);
      expect(automation.createdById).toBe(managerCtx.userId);
    });

    it("rejects `enabled` in the payload rather than ignoring it", async () => {
      const result = await createAutomation(managerCtx, {
        name: uniqueName("Sneaky"),
        trigger: "LEAD_CREATED",
        enabled: true,
      });
      expect(result.ok).toBe(false);
    });

    it("refuses a duplicate name, whatever its case", async () => {
      const name = uniqueName("Unique");
      unwrap(await createAutomation(managerCtx, { name, trigger: "LEAD_CREATED" }));

      const clash = await createAutomation(managerCtx, {
        name: name.toUpperCase(),
        trigger: "LEAD_CREATED",
      });
      expect(clash.ok).toBe(false);
      if (!clash.ok) expect(clash.error).toMatch(/already exists/i);
    });

    it("patches name, description, cap and conditions, and cannot move the trigger", async () => {
      const created = unwrap(
        await createAutomation(managerCtx, {
          name: uniqueName("Patch"),
          trigger: "LEAD_CREATED",
          conditions: { status: ["NEW"] },
        }),
      );

      unwrap(
        await updateAutomation(managerCtx, created.id, {
          description: "now with a cap",
          dailyRunLimit: 25,
          conditions: { scoreMin: 70 },
        }),
      );

      const after = unwrap(await getAutomation(managerCtx, created.id));
      expect(after.dailyRunLimit).toBe(25);
      expect(after.conditions).toEqual({ scoreMin: 70 });

      const moved = await updateAutomation(managerCtx, created.id, {
        trigger: "DEAL_STAGE_CHANGED",
      });
      expect(moved.ok).toBe(false);
    });

    it("clears conditions with an explicit null", async () => {
      const created = unwrap(
        await createAutomation(managerCtx, {
          name: uniqueName("Clearable"),
          trigger: "LEAD_CREATED",
          conditions: { status: ["NEW"] },
        }),
      );

      unwrap(await updateAutomation(managerCtx, created.id, { conditions: null }));

      const row = await db.automation.findUnique({
        where: { id: created.id },
        select: { conditions: true },
      });
      // `Prisma.DbNull`, not JSON null: the column is absent, not holding a value.
      expect(row?.conditions).toBeNull();
    });

    it("is not found across a tenant boundary", async () => {
      const created = unwrap(
        await createAutomation(managerCtx, { name: uniqueName("Mine"), trigger: "LEAD_CREATED" }),
      );

      const seen = await getAutomation(other.ctx, created.id);
      expect(seen.ok).toBe(false);
      const edited = await updateAutomation(other.ctx, created.id, { name: uniqueName("Theirs") });
      expect(edited.ok).toBe(false);
    });

    it("lists with step and run counts", async () => {
      const id = await makeAutomation({
        trigger: "LEAD_CREATED",
        steps: [{ action: "NOTIFY", config: { message: "hello" } }],
      });

      const listed = await listAutomations(readOnlyCtx);
      const mine = listed.find((row) => row.id === id);
      expect(mine?.stepCount).toBe(1);
      expect(mine?.runCount).toBe(0);
    });
  });

  // ─────────────────────────── conditions vocabulary ───────────────────────────

  describe("conditions", () => {
    it("accepts only the segment filter vocabulary", async () => {
      const bad = await createAutomation(managerCtx, {
        name: uniqueName("Typo"),
        trigger: "LEAD_CREATED",
        // Not a key `leadFilterSchema` knows; `.strict()` rejects it rather
        // than dropping it and silently widening the rule.
        conditions: { statuses: ["NEW"] },
      });
      expect(bad.ok).toBe(false);
    });

    it("refuses conditions on a trigger with no filter vocabulary", async () => {
      const result = await createAutomation(managerCtx, {
        name: uniqueName("DealCond"),
        trigger: "DEAL_STAGE_CHANGED",
        conditions: { scoreMin: 50 },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/only available for lead automations/i);
    });
  });

  // ─────────────────────────── steps ───────────────────────────

  describe("steps", () => {
    it("numbers positions from the array and replaces the whole list", async () => {
      const created = unwrap(
        await createAutomation(managerCtx, { name: uniqueName("Steps"), trigger: "LEAD_CREATED" }),
      );

      expect(
        unwrap(
          await setSteps(managerCtx, created.id, [
            { action: "ADD_TAG", config: { tagId } },
            { action: "NOTIFY", config: { message: "tagged" } },
          ]),
        ).count,
      ).toBe(2);

      let automation = unwrap(await getAutomation(managerCtx, created.id));
      expect(automation.steps.map((step) => step.position)).toEqual([1, 2]);

      unwrap(await setSteps(managerCtx, created.id, [{ action: "NOTIFY", config: { message: "only" } }]));
      automation = unwrap(await getAutomation(managerCtx, created.id));
      expect(automation.steps).toHaveLength(1);
      expect(automation.steps[0].position).toBe(1);
    });

    it("rejects a config that does not match its action, at save time", async () => {
      const created = unwrap(
        await createAutomation(managerCtx, { name: uniqueName("BadCfg"), trigger: "LEAD_CREATED" }),
      );

      // NOTIFY without a message.
      expect((await setSteps(managerCtx, created.id, [{ action: "NOTIFY", config: {} }])).ok).toBe(false);
      // ASSIGN_OWNER naming both a person and a strategy.
      expect(
        (
          await setSteps(managerCtx, created.id, [
            { action: "ASSIGN_OWNER", config: { userId: repId, strategy: "ROUND_ROBIN" } },
          ])
        ).ok,
      ).toBe(false);
      // A step that saved nothing left nothing behind.
      expect(await db.automationStep.count({ where: { automationId: created.id } })).toBe(0);
    });

    it("whitelists SET_FIELD per record kind", async () => {
      const lead = unwrap(
        await createAutomation(managerCtx, { name: uniqueName("LeadSet"), trigger: "LEAD_CREATED" }),
      ).id;

      expect(
        unwrap(
          await setSteps(managerCtx, lead, [{ action: "SET_FIELD", config: { field: "status", value: "WORKING" } }]),
        ).count,
      ).toBe(1);

      // Off the whitelist: identity, provenance and the dedupe key.
      for (const field of ["email", "source", "dedupeKey", "organizationId", "ownerId"]) {
        const result = await setSteps(managerCtx, lead, [
          { action: "SET_FIELD", config: { field, value: "x" } },
        ]);
        expect(result.ok, `${field} must not be writable`).toBe(false);
      }

      // Not a valid member of the enum, even on a whitelisted field.
      expect(
        (
          await setSteps(managerCtx, lead, [
            { action: "SET_FIELD", config: { field: "status", value: "NOT_A_STATUS" } },
          ])
        ).ok,
      ).toBe(false);
    });

    it("refuses actions a record kind cannot support", async () => {
      const deal = unwrap(
        await createAutomation(managerCtx, { name: uniqueName("DealRule"), trigger: "DEAL_STAGE_CHANGED" }),
      ).id;
      // `Tagging` has no deal column.
      const tagged = await setSteps(managerCtx, deal, [{ action: "ADD_TAG", config: { tagId } }]);
      expect(tagged.ok).toBe(false);
      if (!tagged.ok) expect(tagged.error).toMatch(/not available for deal automations/i);

      const task = unwrap(
        await createAutomation(managerCtx, { name: uniqueName("TaskRule"), trigger: "TASK_COMPLETED" }),
      ).id;
      // A task is assigned, not owned, and has no writable fields.
      expect((await setSteps(managerCtx, task, [{ action: "ASSIGN_OWNER", config: { userId: repId } }])).ok).toBe(
        false,
      );
      expect(
        (await setSteps(managerCtx, task, [{ action: "SET_FIELD", config: { field: "title", value: "x" } }])).ok,
      ).toBe(false);
      // But it can still make a task and tell someone.
      expect(
        unwrap(await setSteps(managerCtx, task, [{ action: "NOTIFY", config: { message: "done" } }])).count,
      ).toBe(1);
    });
  });

  // ─────────────────────────── roles ───────────────────────────

  describe("roles", () => {
    let id: string;

    beforeAll(async () => {
      id = await makeAutomation({
        trigger: "LEAD_CREATED",
        steps: [{ action: "NOTIFY", config: { message: "hi" } }],
        enabled: false,
      });
    });

    it("lets everyone read, including READ_ONLY", async () => {
      expect(unwrap(await getAutomation(readOnlyCtx, id)).id).toBe(id);
      expect(await listAutomations(readOnlyCtx)).not.toHaveLength(0);
      expect(await listRuns(readOnlyCtx)).toBeInstanceOf(Array);
    });

    it("needs MANAGER to write a rule or its steps", async () => {
      await expect(
        createAutomation(repCtx, { name: uniqueName("Nope"), trigger: "LEAD_CREATED" }),
      ).rejects.toThrow(/permission/i);
      await expect(updateAutomation(repCtx, id, { name: uniqueName("Nope") })).rejects.toThrow(/permission/i);
      await expect(setSteps(repCtx, id, [])).rejects.toThrow(/permission/i);
      await expect(
        createAutomation(readOnlyCtx, { name: uniqueName("Nope"), trigger: "LEAD_CREATED" }),
      ).rejects.toThrow(/permission/i);
    });

    it("needs ADMIN to turn a rule loose or delete it", async () => {
      // A MANAGER may write the rule but not arm it — the two acts have very
      // different blast radii.
      await expect(setAutomationEnabled(managerCtx, id, true)).rejects.toThrow(/permission/i);
      await expect(deleteAutomation(managerCtx, id)).rejects.toThrow(/permission/i);

      unwrap(await setAutomationEnabled(adminCtx, id, true));
      expect(unwrap(await getAutomation(managerCtx, id)).enabled).toBe(true);
      unwrap(await setAutomationEnabled(adminCtx, id, false));
    });

    it("refuses to enable a rule with no steps", async () => {
      const empty = unwrap(
        await createAutomation(managerCtx, { name: uniqueName("Empty"), trigger: "LEAD_CREATED" }),
      ).id;
      const result = await setAutomationEnabled(adminCtx, empty, true);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/at least one step/i);
    });

    it("deletes with an ADMIN, taking the steps with it", async () => {
      const doomed = await makeAutomation({
        trigger: "LEAD_CREATED",
        steps: [{ action: "NOTIFY", config: { message: "bye" } }],
        enabled: false,
      });
      unwrap(await deleteAutomation(ownerCtx, doomed));
      expect((await getAutomation(ownerCtx, doomed)).ok).toBe(false);
      expect(await db.automationStep.count({ where: { automationId: doomed } })).toBe(0);
    });
  });

  // ─────────────────────────── dispatch ───────────────────────────

  describe("dispatch", () => {
    it("does nothing for a disabled rule", async () => {
      const id = await makeAutomation({
        trigger: "LEAD_CREATED",
        steps: [{ action: "ADD_TAG", config: { tagId } }],
        enabled: false,
      });
      const lead = await makeLead({ ownerId: repId });

      const totals = await dispatch(eventFor("LEAD_CREATED", lead));
      expect(totals.matched).toBe(0);
      expect(await runsFor(id)).toHaveLength(0);
    });

    it("runs every step and records what each one did", async () => {
      const id = await makeAutomation({
        trigger: "LEAD_CREATED",
        steps: [
          { action: "ADD_TAG", config: { tagId } },
          { action: "SET_FIELD", config: { field: "score", value: 80 } },
          { action: "CREATE_TASK", config: { title: "Call them", dueInDays: 3, assignTo: repId } },
          { action: "NOTIFY", config: { message: "New lead routed" } },
        ],
      });
      const lead = await makeLead({ ownerId: repId });
      const now = new Date("2026-03-10T12:00:00.000Z");

      const totals = await dispatch(eventFor("LEAD_CREATED", lead, { now }));
      expect(totals).toMatchObject({ ran: 1, skipped: 0, failed: 0 });

      const [run] = await runsFor(id);
      expect(run.status).toBe("SUCCEEDED");
      expect(run.finishedAt).not.toBeNull();
      expect(run.log).toHaveLength(4);

      const after = await db.lead.findUnique({
        where: { id: lead },
        select: { score: true, scoredAt: true, taggings: { select: { tagId: true } } },
      });
      expect(after?.score).toBe(80);
      expect(after?.scoredAt).not.toBeNull();
      expect(after?.taggings.map((t) => t.tagId)).toEqual([tagId]);

      const task = await db.task.findFirst({ where: { leadId: lead }, select: { title: true, dueAt: true, assigneeId: true } });
      expect(task?.title).toBe("Call them");
      expect(task?.assigneeId).toBe(repId);
      // `dueInDays` counts from the pinned clock, not from the wall clock.
      expect(task?.dueAt?.getTime()).toBe(now.getTime() + 3 * DAY);

      const notification = await db.notification.findFirst({
        where: { entity: "Lead", entityId: lead },
        select: { userId: true, title: true },
      });
      // No `userId` in the config, so it went to the record's owner.
      expect(notification?.userId).toBe(repId);
      expect(notification?.title).toBe("New lead routed");
    });

    it("re-adding a tag is a no-op, not a failure", async () => {
      const id = await makeAutomation({
        trigger: "LEAD_CREATED",
        steps: [{ action: "ADD_TAG", config: { tagId } }],
      });
      const lead = await makeLead({ ownerId: repId });

      await dispatch(eventFor("LEAD_CREATED", lead));
      // A second, genuinely different occurrence for the same record.
      const totals = await dispatch(eventFor("LEAD_CREATED", lead));
      expect(totals.ran).toBe(1);

      const runs = await runsFor(id);
      expect(runs.map((run) => run.status)).toEqual(["SUCCEEDED", "SUCCEEDED"]);
      expect(await db.tagging.count({ where: { leadId: lead, tagId } })).toBe(1);
    });

    it("evaluates conditions by re-querying, and records a miss as SKIPPED", async () => {
      const id = await makeAutomation({
        trigger: "LEAD_STATUS_CHANGED",
        conditions: { status: ["QUALIFIED"], scoreMin: 70 },
        steps: [{ action: "ADD_TAG", config: { tagId } }],
      });

      const matching = await makeLead({ ownerId: repId, status: "QUALIFIED", score: 90 });
      const missing = await makeLead({ ownerId: repId, status: "QUALIFIED", score: 10 });

      expect((await dispatch(eventFor("LEAD_STATUS_CHANGED", matching))).ran).toBe(1);
      expect((await dispatch(eventFor("LEAD_STATUS_CHANGED", missing))).skipped).toBe(1);

      const runs = await runsFor(id);
      expect(runs.find((run) => run.recordId === matching)?.status).toBe("SUCCEEDED");
      expect(runs.find((run) => run.recordId === missing)?.status).toBe("SKIPPED");
      expect(await db.tagging.count({ where: { leadId: missing } })).toBe(0);
    });

    /**
     * The subtlety that would otherwise be a silent, awful bug: an automation
     * has no user, so it must not inherit anyone's record visibility.
     */
    it("fires for a record owned by somebody else", async () => {
      const id = await makeAutomation({
        trigger: "LEAD_CREATED",
        // Conditions go through `segmentWhere`, which spreads `visibleTo(ctx)`.
        // A rule evaluated as a REP would find nothing here.
        conditions: { status: ["NEW"] },
        steps: [{ action: "ADD_TAG", config: { tagId } }],
      });
      const theirs = await makeLead({ ownerId: otherRepId });

      expect((await dispatch(eventFor("LEAD_CREATED", theirs))).ran).toBe(1);
      expect((await runsFor(id))[0].status).toBe("SUCCEEDED");
      expect(await db.tagging.count({ where: { leadId: theirs, tagId } })).toBe(1);
    });

    it("stays inside its tenant", async () => {
      const mine = await makeAutomation({
        trigger: "LEAD_CREATED",
        steps: [{ action: "NOTIFY", config: { message: "mine" } }],
      });
      const theirLead = await makeLead({ organizationId: other.org.id });

      const totals = await dispatch({
        organizationId: other.org.id,
        trigger: "LEAD_CREATED",
        recordKind: "LEAD",
        recordId: theirLead,
        triggerEventId: randomUUID(),
      });
      expect(totals.matched).toBe(0);
      expect(await runsFor(mine)).toHaveLength(0);
    });

    it("ignores an event whose record kind disagrees with its trigger", async () => {
      const id = await makeAutomation({
        trigger: "DEAL_STAGE_CHANGED",
        steps: [{ action: "NOTIFY", config: { message: "moved" } }],
      });
      const lead = await makeLead({ ownerId: repId });

      const totals = await dispatch(eventFor("DEAL_STAGE_CHANGED", lead));
      expect(totals).toEqual({ matched: 0, ran: 0, skipped: 0, failed: 0 });
      expect(await runsFor(id)).toHaveLength(0);
    });

    it("assigns round-robin deterministically: fewest open leads wins", async () => {
      // Every other candidate carries an open lead; `otherRepId` carries none,
      // so the winner is unambiguous rather than decided by a tiebreak.
      await makeLead({ ownerId: ownerCtx.userId, status: "WORKING" });
      await makeLead({ ownerId: repId, status: "WORKING" });
      await db.lead.updateMany({ where: { ownerId: otherRepId }, data: { status: "JUNK" } });

      const id = await makeAutomation({
        trigger: "LEAD_CREATED",
        steps: [{ action: "ASSIGN_OWNER", config: { strategy: "ROUND_ROBIN" } }],
      });
      const unowned = await makeLead({ ownerId: null });

      expect((await dispatch(eventFor("LEAD_CREATED", unowned))).ran).toBe(1);
      const after = await db.lead.findUnique({ where: { id: unowned }, select: { ownerId: true } });
      expect(after?.ownerId).toBe(otherRepId);
      expect((await runsFor(id))[0].status).toBe("SUCCEEDED");
    });

    it("records a failing step as FAILED without throwing or stopping the sweep", async () => {
      // A user id from another tenant passes the cuid check at save time and
      // is caught at run time, which is exactly where team membership can be
      // checked honestly.
      const broken = await makeAutomation({
        trigger: "LEAD_CREATED",
        steps: [{ action: "NOTIFY", config: { userId: other.ctx.userId, message: "leak" } }],
      });
      const healthy = await makeAutomation({
        trigger: "LEAD_CREATED",
        steps: [{ action: "ADD_TAG", config: { tagId } }],
      });
      const lead = await makeLead({ ownerId: repId });

      const totals = await dispatch(eventFor("LEAD_CREATED", lead));
      expect(totals.failed).toBe(1);
      // The broken rule did not stop the healthy one.
      expect(totals.ran).toBe(1);

      const [failed] = await runsFor(broken);
      expect(failed.status).toBe("FAILED");
      expect(failed.error).toMatch(/not on this team/i);
      expect(failed.log).toHaveLength(1);
      expect((await runsFor(healthy))[0].status).toBe("SUCCEEDED");
      expect(await db.notification.count({ where: { userId: other.ctx.userId } })).toBe(0);
    });

    it("records a stored condition document that no longer parses as FAILED", async () => {
      const id = await makeAutomation({
        trigger: "LEAD_CREATED",
        conditions: { status: ["NEW"] },
        steps: [{ action: "ADD_TAG", config: { tagId } }],
      });
      // Planted directly: the service refuses to save this, but a filter saved
      // before a field was retired would read back exactly like it.
      await db.automation.update({ where: { id }, data: { conditions: { retiredField: 1 } } });
      const lead = await makeLead({ ownerId: repId });

      expect((await dispatch(eventFor("LEAD_CREATED", lead))).failed).toBe(1);
      const [run] = await runsFor(id);
      expect(run.status).toBe("FAILED");
      expect(run.error).toMatch(/segment filter/i);
      expect(await db.tagging.count({ where: { leadId: lead } })).toBe(0);
    });

    it("lists runs newest first, filtered by automation", async () => {
      const id = await makeAutomation({
        trigger: "LEAD_CREATED",
        steps: [{ action: "NOTIFY", config: { message: "listed" } }],
      });
      const lead = await makeLead({ ownerId: repId });
      await dispatch(eventFor("LEAD_CREATED", lead));

      const runs = await listRuns(readOnlyCtx, { automationId: id });
      expect(runs).toHaveLength(1);
      expect(runs[0].recordId).toBe(lead);
      expect(runs[0].automation.name).toMatch(/^Rule-/);
    });
  });

  // ─────────────────────────── loop protection ───────────────────────────

  describe("loop protection", () => {
    it("(a) runs a record once per automation per event, however often it is dispatched", async () => {
      const id = await makeAutomation({
        trigger: "LEAD_CREATED",
        steps: [{ action: "SET_FIELD", config: { field: "score", value: 42 } }],
      });
      const lead = await makeLead({ ownerId: repId });
      const event = eventFor("LEAD_CREATED", lead);

      const first = await dispatch(event);
      // The same occurrence, redelivered — a webhook retry, a replayed job.
      const second = await dispatch(event);
      const third = await dispatch(event);

      expect(first.ran).toBe(1);
      expect(second).toMatchObject({ matched: 1, ran: 0, skipped: 1, failed: 0 });
      expect(third.skipped).toBe(1);

      // "Already ran" is not an error, and it leaves exactly one row behind.
      const runs = await runsFor(id);
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe("SUCCEEDED");
    });

    it("(b) an action taken by an automation does not re-trigger automations", async () => {
      /*
       * The canonical infinite loop: "when the status changes, change the
       * status". `SET_FIELD` raises `LEAD_STATUS_CHANGED` exactly as
       * `setLeadStatus` would, with a fresh `triggerEventId` — so neither the
       * unique index nor the daily cap could stop this. Only the marker can.
       */
      const id = await makeAutomation({
        trigger: "LEAD_STATUS_CHANGED",
        steps: [{ action: "SET_FIELD", config: { field: "status", value: "WORKING" } }],
      });
      const lead = await makeLead({ ownerId: repId, status: "NEW" });

      const totals = await dispatch(eventFor("LEAD_STATUS_CHANGED", lead));

      expect(totals).toMatchObject({ matched: 1, ran: 1, skipped: 0, failed: 0 });
      expect((await db.lead.findUnique({ where: { id: lead }, select: { status: true } }))?.status).toBe("WORKING");
      // One row: the follow-on event was dropped, not run and not recorded.
      expect(await runsFor(id)).toHaveLength(1);
      // And the marker does not leak out of the run.
      expect(insideAutomationRun()).toBe(false);
    });

    it("(b) two rules on the same event still both run — the marker is not a global mute", async () => {
      const first = await makeAutomation({
        trigger: "TASK_COMPLETED",
        steps: [{ action: "NOTIFY", config: { userId: repId, message: "one" } }],
      });
      const second = await makeAutomation({
        trigger: "TASK_COMPLETED",
        steps: [{ action: "NOTIFY", config: { userId: repId, message: "two" } }],
      });
      const task = await db.task.create({
        data: { organizationId: org.org.id, title: "Done", assigneeId: repId, completedAt: new Date() },
        select: { id: true },
      });

      const totals = await dispatch({
        organizationId: org.org.id,
        trigger: "TASK_COMPLETED",
        recordKind: "TASK",
        recordId: task.id,
        triggerEventId: randomUUID(),
      });

      expect(totals).toMatchObject({ matched: 2, ran: 2 });
      expect((await runsFor(first))[0].status).toBe("SUCCEEDED");
      expect((await runsFor(second))[0].status).toBe("SUCCEEDED");
    });

    it("(c) stops at the daily cap and records why, once", async () => {
      const id = await makeAutomation({
        trigger: "LEAD_CREATED",
        dailyRunLimit: 2,
        steps: [{ action: "SET_FIELD", config: { field: "score", value: 5 } }],
      });

      const leads: string[] = [];
      for (let i = 0; i < 4; i++) leads.push(await makeLead({ ownerId: repId }));

      const outcomes: string[] = [];
      // Sequential: the cap is a running count, and parallel dispatches would
      // race past it (and this pg adapter refuses concurrent transactions).
      for (const lead of leads) {
        const totals = await dispatch(eventFor("LEAD_CREATED", lead));
        outcomes.push(totals.ran === 1 ? "ran" : "skipped");
      }
      expect(outcomes).toEqual(["ran", "ran", "skipped", "skipped"]);

      const runs = await runsFor(id);
      expect(runs.filter((run) => run.status === "SUCCEEDED")).toHaveLength(2);

      // Exactly one notice, not one per suppressed event: writing 40,000 "I
      // was capped" rows would miss the point of the cap entirely.
      const capped = runs.filter((run) => run.error?.startsWith("Daily run limit"));
      expect(capped).toHaveLength(1);
      expect(capped[0].status).toBe("SKIPPED");
      expect(capped[0].error).toMatch(/of 2 reached/);

      // The last two leads were never touched.
      const untouched = await db.lead.count({ where: { id: { in: leads.slice(2) }, score: 0 } });
      expect(untouched).toBe(2);
    });

    it("(c) yesterday's runs do not spend today's budget", async () => {
      const id = await makeAutomation({
        trigger: "LEAD_CREATED",
        dailyRunLimit: 1,
        steps: [{ action: "SET_FIELD", config: { field: "score", value: 7 } }],
      });
      const yesterdaysLead = await makeLead({ ownerId: repId });
      const todaysLead = await makeLead({ ownerId: repId });

      const yesterday = new Date(Date.now() - DAY);
      expect((await dispatch(eventFor("LEAD_CREATED", yesterdaysLead, { now: yesterday }))).ran).toBe(1);
      expect((await dispatch(eventFor("LEAD_CREATED", todaysLead))).ran).toBe(1);

      expect((await runsFor(id)).filter((run) => run.status === "SUCCEEDED")).toHaveLength(2);
    });
  });
});
