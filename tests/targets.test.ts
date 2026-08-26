import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { type Ctx, ForbiddenError } from "@/server/authz";
import * as targetsModule from "@/server/services/targets";
import {
  attainment,
  copyTargets,
  coverage,
  deleteTarget,
  listTargets,
  setTarget,
} from "@/server/services/targets";
import { dropOrg, makeOrg } from "./factories";

/**
 * The whole fixture runs in Asia/Manila (UTC+8, no DST), because a period
 * computed in UTC would start at 08:00 the previous day and every boundary
 * assertion below would pass for the wrong reason.
 */
const TZ = "Asia/Manila";

/** Any instant inside September 2026, Manila. Services normalise it. */
const SEPTEMBER = new Date("2026-09-15T00:00:00Z");
const OCTOBER = new Date("2026-10-15T00:00:00Z");

/** 1 September 2026, 00:00 Manila. */
const SEPT_START = new Date("2026-08-31T16:00:00Z");
/** 1 October 2026, 00:00 Manila — the exclusive end of September. */
const OCT_START = new Date("2026-09-30T16:00:00Z");

/** 30 minutes after local midnight on the 1st. Belongs to September. */
const JUST_INSIDE = new Date("2026-08-31T16:30:00Z");
/** 30 minutes before it. Belongs to August, and to UTC's idea of September. */
const JUST_OUTSIDE = new Date("2026-08-31T15:30:00Z");

/** Mid-period and late-period reference points for pace. */
const DAY_12 = new Date("2026-09-12T04:00:00Z");
const DAY_27 = new Date("2026-09-27T04:00:00Z");

/** Unwrapped, because a target the service refused to set is a test failure. */
async function set(ctx: Ctx, input: Record<string, unknown>) {
  const result = await setTarget(ctx, input);
  if (!result.ok) throw new Error(result.error);
  return result.data.id;
}

describe("targets, quotas and KPI attainment", () => {
  let org: Awaited<ReturnType<typeof makeOrg>>;
  let other: Awaited<ReturnType<typeof makeOrg>>;

  let repCtx: Ctx;
  let managerCtx: Ctx;
  let readOnlyCtx: Ctx;
  let repId: string;

  let openStage: string;
  let wonStage: string;

  beforeAll(async () => {
    org = await makeOrg(); // OWNER
    other = await makeOrg();

    await db.organization.update({ where: { id: org.org.id }, data: { timezone: TZ } });

    const rep = await db.user.create({
      data: {
        organizationId: org.org.id,
        email: `rep-${randomUUID().slice(0, 8)}@test.local`,
        name: "Rep Person",
        role: "REP",
        passwordHash: "not-used-in-these-tests",
      },
    });
    repId = rep.id;
    repCtx = { userId: rep.id, organizationId: org.org.id, role: "REP" };

    const manager = await db.user.create({
      data: {
        organizationId: org.org.id,
        email: `mgr-${randomUUID().slice(0, 8)}@test.local`,
        role: "MANAGER",
        passwordHash: "not-used-in-these-tests",
      },
    });
    managerCtx = { userId: manager.id, organizationId: org.org.id, role: "MANAGER" };

    const readOnly = await db.user.create({
      data: {
        organizationId: org.org.id,
        email: `ro-${randomUUID().slice(0, 8)}@test.local`,
        role: "READ_ONLY",
        passwordHash: "not-used-in-these-tests",
      },
    });
    readOnlyCtx = { userId: readOnly.id, organizationId: org.org.id, role: "READ_ONLY" };

    openStage = (
      await db.stage.findFirstOrThrow({ where: { pipelineId: org.pipeline.id, isWon: false } })
    ).id;
    wonStage = (
      await db.stage.findFirstOrThrow({ where: { pipelineId: org.pipeline.id, isWon: true } })
    ).id;

    const deal = (input: {
      title: string;
      value: number;
      currency: string;
      ownerId: string;
      stageId: string;
      closedAt?: Date;
    }) =>
      db.deal.create({
        data: {
          organizationId: org.org.id,
          pipelineId: org.pipeline.id,
          ...input,
        },
      });

    // 20,000 + 11,000 = 31,000 USD won by the owner inside September Manila.
    await deal({ title: "Mid-month", value: 20_000, currency: "USD", ownerId: org.user.id, stageId: wonStage, closedAt: new Date("2026-09-10T00:00:00Z") });
    await deal({ title: "Just after local midnight", value: 11_000, currency: "USD", ownerId: org.user.id, stageId: wonStage, closedAt: JUST_INSIDE });
    // Before the period opened in Manila, though inside it in UTC.
    await deal({ title: "Just before local midnight", value: 5_000, currency: "USD", ownerId: org.user.id, stageId: wonStage, closedAt: JUST_OUTSIDE });
    // Right metric, right period, wrong currency.
    await deal({ title: "Euro deal", value: 9_000, currency: "EUR", ownerId: org.user.id, stageId: wonStage, closedAt: new Date("2026-09-11T00:00:00Z") });
    // Open, so it is pipeline rather than attainment.
    await deal({ title: "Still open", value: 4_000, currency: "USD", ownerId: org.user.id, stageId: openStage });
    await deal({ title: "Rep win", value: 7_000, currency: "USD", ownerId: repId, stageId: wonStage, closedAt: new Date("2026-09-05T00:00:00Z") });

    const lead = (input: {
      status: "NEW" | "CONVERTED";
      convertedAt?: Date;
      firstTouchedAt?: Date;
      ownerId: string;
    }) =>
      db.lead.create({
        data: {
          organizationId: org.org.id,
          source: "WEB_FORM",
          dedupeKey: randomUUID(),
          ...input,
        },
      });

    await lead({ status: "CONVERTED", convertedAt: new Date("2026-09-05T00:00:00Z"), firstTouchedAt: new Date("2026-09-02T00:00:00Z"), ownerId: org.user.id });
    await lead({ status: "CONVERTED", convertedAt: new Date("2026-09-06T00:00:00Z"), firstTouchedAt: new Date("2026-09-03T00:00:00Z"), ownerId: org.user.id });
    // Converted, but in August — out of period on both counts.
    await lead({ status: "CONVERTED", convertedAt: new Date("2026-08-20T00:00:00Z"), firstTouchedAt: new Date("2026-08-19T00:00:00Z"), ownerId: org.user.id });
    await lead({ status: "NEW", firstTouchedAt: new Date("2026-09-04T00:00:00Z"), ownerId: org.user.id });

    const activity = (input: {
      type: "CALL" | "MEETING";
      occurredAt: Date;
      userId: string;
      outcome?: "HELD" | "NO_SHOW" | "CONNECTED";
    }) => db.activity.create({ data: { organizationId: org.org.id, ...input } });

    for (const day of ["03", "04", "05"]) {
      await activity({ type: "CALL", occurredAt: new Date(`2026-09-${day}T00:00:00Z`), userId: org.user.id, outcome: "CONNECTED" });
    }
    await activity({ type: "CALL", occurredAt: JUST_OUTSIDE, userId: org.user.id });
    await activity({ type: "MEETING", occurredAt: new Date("2026-09-08T00:00:00Z"), userId: org.user.id, outcome: "HELD" });
    await activity({ type: "MEETING", occurredAt: new Date("2026-09-09T00:00:00Z"), userId: org.user.id, outcome: "HELD" });
    // Booked but never happened, and booked with nothing recorded. Neither counts.
    await activity({ type: "MEETING", occurredAt: new Date("2026-09-09T00:00:00Z"), userId: org.user.id, outcome: "NO_SHOW" });
    await activity({ type: "MEETING", occurredAt: new Date("2026-09-10T00:00:00Z"), userId: org.user.id });
    await activity({ type: "CALL", occurredAt: new Date("2026-09-07T00:00:00Z"), userId: repId, outcome: "NO_ANSWER" as "CONNECTED" });
    await activity({ type: "CALL", occurredAt: new Date("2026-09-08T00:00:00Z"), userId: repId, outcome: "CONNECTED" });

    // Targets, set sequentially — this pg adapter cannot run concurrent
    // interactive transactions, and setTarget opens one.
    const base = { period: "MONTH" as const, periodStart: SEPTEMBER };
    await set(org.ctx, { ...base, userId: org.user.id, metric: "REVENUE_WON", value: 50_000, currency: "usd" });
    await set(org.ctx, { ...base, userId: org.user.id, metric: "DEALS_WON", value: 5 });
    await set(org.ctx, { ...base, userId: org.user.id, metric: "LEADS_CONVERTED", value: 4 });
    await set(org.ctx, { ...base, userId: org.user.id, metric: "FIRST_TOUCHES", value: 20 });
    await set(org.ctx, { ...base, userId: org.user.id, metric: "CALLS_LOGGED", value: 40 });
    await set(org.ctx, { ...base, userId: org.user.id, metric: "MEETINGS_HELD", value: 10 });
    await set(org.ctx, { ...base, userId: null, metric: "REVENUE_WON", value: 100_000, currency: "USD" });
    await set(org.ctx, { ...base, userId: repId, metric: "REVENUE_WON", value: 20_000, currency: "USD" });
    await set(org.ctx, { ...base, userId: repId, metric: "CALLS_LOGGED", value: 30 });
  });

  afterAll(async () => {
    await dropOrg(org.org.id);
    await dropOrg(other.org.id);
    await db.$disconnect();
  });

  const owner = (rows: targetsModule.AttainmentRow[], metric: string) =>
    rows.find((r) => r.userId === org.user.id && r.metric === metric);

  // ─────────────────────────── setting targets ───────────────────────────

  it("normalises periodStart to midnight in the org's timezone, not UTC", async () => {
    // The caller passed mid-September; what is stored is the instant September
    // began in Manila. Storing 2026-09-15 (or a UTC month start) would put the
    // period boundary eight hours out for everyone in the org.
    const row = await db.target.findFirstOrThrow({
      where: { organizationId: org.org.id, userId: org.user.id, metric: "REVENUE_WON" },
    });
    expect(row.periodStart.toISOString()).toBe(SEPT_START.toISOString());
  });

  it("upserts rather than erroring when the same target is set twice", async () => {
    const scratch = await makeOrg();
    try {
      const first = await set(scratch.ctx, { userId: scratch.user.id, metric: "DEALS_WON", period: "MONTH", periodStart: SEPTEMBER, value: 5 });
      const second = await set(scratch.ctx, { userId: scratch.user.id, metric: "DEALS_WON", period: "MONTH", periodStart: SEPTEMBER, value: 8 });

      expect(second).toBe(first);
      const rows = await listTargets(scratch.ctx, { period: "MONTH", periodStart: SEPTEMBER });
      expect(rows).toHaveLength(1);
      expect(rows[0].value).toBe(8);
    } finally {
      await dropOrg(scratch.org.id);
    }
  });

  it("upserts a TEAM target rather than duplicating it", async () => {
    // Regression test for the case the schema was silently getting wrong.
    // Postgres treats NULLs as distinct in a unique index by default, so
    // `userId = NULL` was unconstrained: two identical team targets both
    // inserted, and nothing keyed on that constraint could ever match the
    // existing row. Fixed by recreating the index NULLS NOT DISTINCT in
    // `migrations/20260826054809_target_team_uniqueness`.
    const scratch = await makeOrg();
    try {
      const first = await set(scratch.ctx, { userId: null, metric: "REVENUE_WON", period: "MONTH", periodStart: SEPTEMBER, value: 100_000, currency: "USD" });
      // Second write, same key, no userId supplied at all this time — absent
      // and explicit-null must resolve to the same team row.
      const second = await set(scratch.ctx, { metric: "REVENUE_WON", period: "MONTH", periodStart: SEPTEMBER, value: 120_000, currency: "USD" });

      expect(second).toBe(first);
      const rows = await db.target.findMany({
        where: { organizationId: scratch.org.id, userId: null, metric: "REVENUE_WON" },
      });
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].value.toString())).toBe(120_000);

      // And the constraint itself is real, not just the service's lookup: a
      // raw insert bypassing `setTarget` must be rejected. `periodStart` is
      // taken from the stored row rather than a constant — this scratch org
      // runs in UTC, so its September does not begin when Manila's does.
      await expect(
        db.target.create({
          data: {
            organizationId: scratch.org.id,
            userId: null,
            metric: "REVENUE_WON",
            period: "MONTH",
            periodStart: rows[0].periodStart,
            value: 999,
            currency: "USD",
          },
        }),
      ).rejects.toMatchObject({ code: "P2002" });
    } finally {
      await dropOrg(scratch.org.id);
    }
  });

  it("normalises the currency code so case cannot split one quota in two", async () => {
    const row = await db.target.findFirstOrThrow({
      where: { organizationId: org.org.id, userId: org.user.id, metric: "REVENUE_WON" },
    });
    expect(row.currency).toBe("USD");
  });

  it("keeps a monthly and a quarterly target apart on a shared start date", async () => {
    /*
     * Regression. `period` was originally missing from the uniqueness key, and
     * every quarter starts on a month boundary — so on 1 January, 1 April,
     * 1 July and 1 October a MONTH and a QUARTER target for the same person
     * and metric were the same row, and setting one silently overwrote the
     * other. Four days a year, which is how a bug like this reaches
     * production.
     */
    const scratch = await makeOrg();
    try {
      await db.organization.update({
        where: { id: scratch.org.id },
        data: { timezone: TZ },
      });
      // 1 October is both a month start and a quarter start.
      const shared = new Date("2026-10-01T00:00:00Z");

      const monthly = await setTarget(scratch.ctx, {
        userId: scratch.user.id,
        metric: "DEALS_WON",
        period: "MONTH",
        periodStart: shared,
        value: 5,
      });
      const quarterly = await setTarget(scratch.ctx, {
        userId: scratch.user.id,
        metric: "DEALS_WON",
        period: "QUARTER",
        periodStart: shared,
        value: 15,
      });
      expect(monthly.ok && quarterly.ok).toBe(true);
      if (!monthly.ok || !quarterly.ok) throw new Error("setup");

      // Two distinct rows, not one overwritten one.
      expect(monthly.data.id).not.toBe(quarterly.data.id);
      expect(await db.target.count({ where: { organizationId: scratch.org.id } })).toBe(2);

      const month = await db.target.findUniqueOrThrow({ where: { id: monthly.data.id } });
      const quarter = await db.target.findUniqueOrThrow({ where: { id: quarterly.data.id } });
      expect(Number(month.value)).toBe(5);
      expect(Number(quarter.value)).toBe(15);
    } finally {
      await dropOrg(scratch.org.id);
    }
  });

  it("refuses a target for a user in another organization", async () => {
    const result = await setTarget(other.ctx, {
      userId: org.user.id,
      metric: "DEALS_WON",
      period: "MONTH",
      periodStart: SEPTEMBER,
      value: 3,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toMatch(/not in this workspace/i);
    // And nothing crossed the tenant line.
    expect(
      await db.target.count({ where: { organizationId: other.org.id } }),
    ).toBe(0);
  });

  it("requires MANAGER or above to set a target", async () => {
    const payload = { userId: repId, metric: "DEALS_WON", period: "MONTH", periodStart: SEPTEMBER, value: 3 };
    await expect(setTarget(repCtx, payload)).rejects.toThrow(ForbiddenError);
    // READ_ONLY sees everything and changes nothing.
    await expect(setTarget(readOnlyCtx, payload)).rejects.toThrow(ForbiddenError);
  });

  it("lets a MANAGER set targets", async () => {
    const scratch = await makeOrg();
    try {
      const mgr = await db.user.create({
        data: { organizationId: scratch.org.id, email: `m-${randomUUID().slice(0, 8)}@test.local`, role: "MANAGER", passwordHash: "x" },
      });
      const ctx: Ctx = { userId: mgr.id, organizationId: scratch.org.id, role: "MANAGER" };
      const result = await setTarget(ctx, { userId: null, metric: "CALLS_LOGGED", period: "MONTH", periodStart: SEPTEMBER, value: 100 });
      expect(result.ok).toBe(true);
    } finally {
      await dropOrg(scratch.org.id);
    }
  });

  it("rejects a negative or non-finite value", async () => {
    const bad = async (value: unknown) => {
      const result = await setTarget(org.ctx, { userId: repId, metric: "DEALS_WON", period: "MONTH", periodStart: OCTOBER, value });
      expect(result.ok).toBe(false);
      return result;
    };
    await bad(-1);
    await bad(Number.POSITIVE_INFINITY);
    await bad(Number.NaN);
  });

  it("requires a currency for revenue and rejects one on every other metric", async () => {
    const missing = await setTarget(org.ctx, { userId: repId, metric: "REVENUE_WON", period: "MONTH", periodStart: OCTOBER, value: 1000 });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.fieldErrors?.currency?.[0]).toMatch(/currency/i);

    const spurious = await setTarget(org.ctx, { userId: repId, metric: "CALLS_LOGGED", period: "MONTH", periodStart: OCTOBER, value: 10, currency: "USD" });
    expect(spurious.ok).toBe(false);
    if (!spurious.ok) expect(spurious.fieldErrors?.currency?.[0]).toMatch(/only revenue/i);
  });

  it("audits setting and deleting a target", async () => {
    const scratch = await makeOrg();
    try {
      const id = await set(scratch.ctx, { userId: scratch.user.id, metric: "DEALS_WON", period: "MONTH", periodStart: SEPTEMBER, value: 4 });
      await set(scratch.ctx, { userId: scratch.user.id, metric: "DEALS_WON", period: "MONTH", periodStart: SEPTEMBER, value: 6 });
      const removed = await deleteTarget(scratch.ctx, id);
      expect(removed.ok).toBe(true);

      const log = await db.auditLog.findMany({
        where: { organizationId: scratch.org.id, entity: "Target", entityId: id },
        orderBy: { at: "asc" },
        select: { action: true },
      });
      expect(log.map((l) => l.action)).toEqual(["create", "update", "delete"]);
    } finally {
      await dropOrg(scratch.org.id);
    }
  });

  // ─────────────────────────── deleting ───────────────────────────

  it("requires MANAGER or above to delete, and refuses across tenants", async () => {
    const scratch = await makeOrg();
    try {
      const id = await set(scratch.ctx, { userId: null, metric: "DEALS_WON", period: "MONTH", periodStart: SEPTEMBER, value: 4 });

      await expect(deleteTarget(repCtx, id)).rejects.toThrow(ForbiddenError);

      // A manager in a different org must not be able to reach it.
      const crossTenant = await deleteTarget(org.ctx, id);
      expect(crossTenant.ok).toBe(false);
      if (!crossTenant.ok) expect(crossTenant.error).toMatch(/not found/i);
      expect(await db.target.count({ where: { id } })).toBe(1);

      const removed = await deleteTarget(scratch.ctx, id);
      expect(removed.ok).toBe(true);
      expect(await db.target.count({ where: { id } })).toBe(0);
    } finally {
      await dropOrg(scratch.org.id);
    }
  });

  // ─────────────────────────── listing ───────────────────────────

  it("lists a period's targets for a manager, team row included", async () => {
    const rows = await listTargets(org.ctx, { period: "MONTH", periodStart: SEPTEMBER });
    expect(rows).toHaveLength(9);
    expect(rows.some((r) => r.userId === null && r.metric === "REVENUE_WON")).toBe(true);
    // Decimal must never escape the service.
    expect(typeof rows[0].value).toBe("number");
  });

  it("shows a REP only their own targets, never the team row", async () => {
    const rows = await listTargets(repCtx, { period: "MONTH", periodStart: SEPTEMBER });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.userId === repId)).toBe(true);
  });

  it("shows READ_ONLY everyone's targets", async () => {
    const rows = await listTargets(readOnlyCtx, { period: "MONTH", periodStart: SEPTEMBER });
    expect(rows).toHaveLength(9);
  });

  it("shows a MANAGER everyone's targets and attainment", async () => {
    expect(await listTargets(managerCtx, { period: "MONTH", periodStart: SEPTEMBER })).toHaveLength(9);

    const rows = await attainment(managerCtx, { period: "MONTH", periodStart: SEPTEMBER, now: DAY_12 });
    expect(rows).toHaveLength(9);
    expect(rows.some((r) => r.userId === null)).toBe(true);
    expect(rows.find((r) => r.userId === repId && r.metric === "REVENUE_WON")?.attained).toBe(7_000);
  });

  it("isolates listing across tenants", async () => {
    expect(await listTargets(other.ctx, { period: "MONTH", periodStart: SEPTEMBER })).toEqual([]);
  });

  it("does not show a month's targets under the quarter that contains it", async () => {
    // The unique key omits `period`, so reads filter on it explicitly.
    expect(await listTargets(org.ctx, { period: "QUARTER", periodStart: SEPTEMBER })).toEqual([]);
  });

  // ─────────────────────────── attainment ───────────────────────────

  it("computes revenue attainment against the target's own currency", async () => {
    const rows = await attainment(org.ctx, { period: "MONTH", periodStart: SEPTEMBER, now: DAY_12 });
    const revenue = owner(rows, "REVENUE_WON");

    expect(revenue?.attained).toBe(31_000);
    expect(revenue?.target).toBe(50_000);
    expect(revenue?.currency).toBe("USD");
    expect(revenue?.ratio).toBeCloseTo(0.62, 5);
  });

  it("never folds another currency into a revenue target, and says what it left out", async () => {
    const rows = await attainment(org.ctx, { period: "MONTH", periodStart: SEPTEMBER, now: DAY_12 });
    const revenue = owner(rows, "REVENUE_WON");

    // 9,000 EUR was won in the period and is deliberately not in the 31,000.
    expect(revenue?.excluded?.count).toBe(1);
    expect(revenue?.excluded?.value.byCurrency).toEqual([{ currency: "EUR", amount: 9_000 }]);
    // Counts are currency-agnostic, so the EUR deal DOES count here.
    expect(owner(rows, "DEALS_WON")?.attained).toBe(3);
  });

  it("puts a deal closed just after local midnight in the new period, not the old one", async () => {
    const rows = await attainment(org.ctx, { period: "MONTH", periodStart: SEPTEMBER, now: DAY_12 });
    const revenue = owner(rows, "REVENUE_WON");

    expect(revenue?.periodStart.toISOString()).toBe(SEPT_START.toISOString());
    expect(revenue?.periodEnd.toISOString()).toBe(OCT_START.toISOString());
    expect(revenue?.periodLabel).toBe("2026-09");

    // 11,000 closed 00:30 on 1 September Manila and is inside the 31,000.
    // 5,000 closed 23:30 on 31 August Manila — which IS 1 September in UTC —
    // and is not. Computing this in UTC would have swapped both.
    const august = await attainment(org.ctx, {
      period: "MONTH",
      periodStart: new Date("2026-08-15T00:00:00Z"),
      now: DAY_12,
    });
    expect(august).toEqual([]);
  });

  it("reads pace against elapsed time, not attainment alone", async () => {
    const early = await attainment(org.ctx, { period: "MONTH", periodStart: SEPTEMBER, now: DAY_12 });
    const late = await attainment(org.ctx, { period: "MONTH", periodStart: SEPTEMBER, now: DAY_27 });

    // The same 62%: comfortably ahead on the 12th, a real miss on the 27th.
    expect(owner(early, "REVENUE_WON")?.pace).toBe("ahead");
    expect(owner(early, "REVENUE_WON")?.elapsed).toBeCloseTo(11.5 / 30, 5);
    expect(owner(late, "REVENUE_WON")?.pace).toBe("behind");
    expect(owner(late, "REVENUE_WON")?.elapsed).toBeCloseTo(26.5 / 30, 5);
  });

  it("counts calls, held meetings, conversions and first touches from the right columns", async () => {
    const rows = await attainment(org.ctx, { period: "MONTH", periodStart: SEPTEMBER, now: DAY_12 });

    expect(owner(rows, "CALLS_LOGGED")?.attained).toBe(3);
    expect(owner(rows, "LEADS_CONVERTED")?.attained).toBe(2);
    expect(owner(rows, "FIRST_TOUCHES")?.attained).toBe(3);
  });

  it("counts a meeting only when it was actually held", async () => {
    const rows = await attainment(org.ctx, { period: "MONTH", periodStart: SEPTEMBER, now: DAY_12 });
    // Four MEETING rows exist for this owner in the period; two are HELD, one
    // no-showed and one records no outcome. A booked-meeting metric would
    // report 4 and go up when nothing happened.
    expect(
      await db.activity.count({
        where: { organizationId: org.org.id, type: "MEETING", userId: org.user.id },
      }),
    ).toBe(4);
    expect(owner(rows, "MEETINGS_HELD")?.attained).toBe(2);
  });

  it("grades quota and activity targets differently", async () => {
    const rows = await attainment(org.ctx, { period: "MONTH", periodStart: SEPTEMBER, now: DAY_12 });

    expect(owner(rows, "REVENUE_WON")?.isOutcome).toBe(true);
    expect(owner(rows, "REVENUE_WON")?.successThreshold).toBe(1);
    expect(owner(rows, "CALLS_LOGGED")?.isOutcome).toBe(false);
    expect(owner(rows, "CALLS_LOGGED")?.successThreshold).toBe(0.7);
  });

  it("aggregates a team target across everyone", async () => {
    const rows = await attainment(org.ctx, { period: "MONTH", periodStart: SEPTEMBER, now: DAY_12 });
    const team = rows.find((r) => r.userId === null && r.metric === "REVENUE_WON");

    // 31,000 from the owner plus 7,000 from the rep.
    expect(team?.attained).toBe(38_000);
    expect(team?.userName).toBe("Whole team");
  });

  it("reports zero progress as 0, never as null or a missing row", async () => {
    const scratch = await makeOrg();
    try {
      await set(scratch.ctx, { userId: scratch.user.id, metric: "REVENUE_WON", period: "MONTH", periodStart: SEPTEMBER, value: 50_000, currency: "USD" });
      const [row] = await attainment(scratch.ctx, { period: "MONTH", periodStart: SEPTEMBER, now: DAY_12 });

      // "No data" and "no progress" must not render identically: the row is
      // present, the number is 0, and the target it is 0% of is still there.
      expect(row.attained).toBe(0);
      expect(row.ratio).toBe(0);
      expect(row.target).toBe(50_000);
      expect(row.pace).toBe("behind");
    } finally {
      await dropOrg(scratch.org.id);
    }
  });

  it("names the person a target belongs to", async () => {
    const rows = await attainment(org.ctx, { period: "MONTH", periodStart: SEPTEMBER, now: DAY_12 });
    expect(rows.find((r) => r.userId === repId)?.userName).toBe("Rep Person");
  });

  it("shows a REP only their own attainment", async () => {
    const rows = await attainment(repCtx, { period: "MONTH", periodStart: SEPTEMBER, now: DAY_12 });

    expect(rows.every((r) => r.userId === repId)).toBe(true);
    // No team row: it aggregates everyone's revenue and would hand a rep the
    // company number by the back door.
    expect(rows.some((r) => r.userId === null)).toBe(false);
    expect(rows.find((r) => r.metric === "REVENUE_WON")?.attained).toBe(7_000);
  });

  it("cannot be widened by a REP asking for someone else's userId", async () => {
    const rows = await attainment(repCtx, {
      period: "MONTH",
      periodStart: SEPTEMBER,
      userId: org.user.id,
      now: DAY_12,
    });
    expect(rows.every((r) => r.userId === repId)).toBe(true);
  });

  it("shows READ_ONLY everyone's attainment", async () => {
    const rows = await attainment(readOnlyCtx, { period: "MONTH", periodStart: SEPTEMBER, now: DAY_12 });
    expect(rows).toHaveLength(9);
    expect(rows.some((r) => r.userId === null)).toBe(true);
  });

  it("lets a manager filter attainment to one person", async () => {
    const rows = await attainment(org.ctx, {
      period: "MONTH",
      periodStart: SEPTEMBER,
      userId: repId,
      now: DAY_12,
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.userId === repId)).toBe(true);
  });

  it("isolates attainment across tenants", async () => {
    expect(
      await attainment(other.ctx, { period: "MONTH", periodStart: SEPTEMBER, now: DAY_12 }),
    ).toEqual([]);
  });

  // ─────────────────────────── coverage ───────────────────────────

  it("refuses to invent a coverage requirement without enough closed history", async () => {
    const result = await coverage(org.ctx, { period: "MONTH", periodStart: SEPTEMBER, now: DAY_12 });

    // Five closed deals is below the threshold in `requiredCoverage`, so the
    // answer is "we don't know yet" — never the received 3x.
    expect(result.wonCount).toBe(5);
    expect(result.lostCount).toBe(0);
    expect(result.required).toBeNull();
    expect(result.rows.every((r) => r.meetsRequirement === null)).toBe(true);
  });

  it("measures open weighted pipeline against the quota still to find", async () => {
    const result = await coverage(org.ctx, { period: "MONTH", periodStart: SEPTEMBER, now: DAY_12 });
    const row = result.rows.find((r) => r.userId === org.user.id);

    expect(row?.remaining).toBe(19_000); // 50,000 quota less 31,000 won
    // One open USD deal worth 4,000 at a 10% stage.
    expect(row?.weightedPipeline).toBe(400);
    expect(row?.ratio).toBeCloseTo(400 / 19_000, 6);
    // Only revenue targets have a coverage question.
    expect(result.rows.every((r) => r.currency === "USD")).toBe(true);
  });

  it("derives the required ratio from the real win rate", async () => {
    const scratch = await makeOrg();
    try {
      const won = (await db.stage.findFirstOrThrow({ where: { pipelineId: scratch.pipeline.id, isWon: true } })).id;
      const open = (await db.stage.findFirstOrThrow({ where: { pipelineId: scratch.pipeline.id, isWon: false } })).id;
      const lost = await db.stage.create({
        data: { pipelineId: scratch.pipeline.id, name: "Lost", order: 9, probability: 0, isLost: true },
      });
      const half = await db.stage.create({
        data: { pipelineId: scratch.pipeline.id, name: "Proposal", order: 3, probability: 50 },
      });
      expect(open).toBeTruthy();

      // Six won, six lost, all in August so they land in the trailing window
      // but outside the September period being measured.
      for (let i = 0; i < 12; i++) {
        await db.deal.create({
          data: {
            organizationId: scratch.org.id,
            pipelineId: scratch.pipeline.id,
            stageId: i < 6 ? won : lost.id,
            title: `Closed ${i}`,
            value: 1_000,
            currency: "USD",
            ownerId: scratch.user.id,
            closedAt: new Date("2026-08-10T00:00:00Z"),
          },
        });
      }
      await db.deal.create({
        data: {
          organizationId: scratch.org.id,
          pipelineId: scratch.pipeline.id,
          stageId: half.id,
          title: "Big open one",
          value: 100_000,
          currency: "USD",
          ownerId: scratch.user.id,
        },
      });

      await set(scratch.ctx, { userId: scratch.user.id, metric: "REVENUE_WON", period: "MONTH", periodStart: SEPTEMBER, value: 100_000, currency: "USD" });

      const result = await coverage(scratch.ctx, { period: "MONTH", periodStart: SEPTEMBER, now: DAY_12 });

      expect(result.winRate).toBe(50);
      // 1 / 0.5 — derived, not the folk-wisdom 3x.
      expect(result.required).toBe(2);
      expect(result.windowDays).toBe(90);

      const row = result.rows[0];
      expect(row.remaining).toBe(100_000);
      expect(row.weightedPipeline).toBe(50_000); // 100,000 at a 50% stage
      expect(row.ratio).toBe(0.5);
      expect(row.meetsRequirement).toBe(false);
    } finally {
      await dropOrg(scratch.org.id);
    }
  });

  it("reports no coverage ratio once the quota is met", async () => {
    const scratch = await makeOrg();
    try {
      const won = (await db.stage.findFirstOrThrow({ where: { pipelineId: scratch.pipeline.id, isWon: true } })).id;
      await db.deal.create({
        data: {
          organizationId: scratch.org.id,
          pipelineId: scratch.pipeline.id,
          stageId: won,
          title: "Over quota",
          value: 12_000,
          currency: "USD",
          ownerId: scratch.user.id,
          closedAt: new Date("2026-09-09T00:00:00Z"),
        },
      });
      await set(scratch.ctx, { userId: scratch.user.id, metric: "REVENUE_WON", period: "MONTH", periodStart: SEPTEMBER, value: 10_000, currency: "USD" });

      const [row] = (await coverage(scratch.ctx, { period: "MONTH", periodStart: SEPTEMBER, now: DAY_12 })).rows;
      expect(row.attained).toBe(12_000);
      expect(row.remaining).toBe(0);
      // Null, not 0 and not Infinity: there is no coverage question left.
      expect(row.ratio).toBeNull();
      expect(row.meetsRequirement).toBeNull();
    } finally {
      await dropOrg(scratch.org.id);
    }
  });

  it("isolates coverage across tenants", async () => {
    const result = await coverage(other.ctx, { period: "MONTH", periodStart: SEPTEMBER, now: DAY_12 });
    expect(result.rows).toEqual([]);
    expect(result.wonCount).toBe(0);
  });

  // ─────────────────────────── copying forward ───────────────────────────

  it("copies a period's targets forward and skips ones already set", async () => {
    const scratch = await makeOrg();
    try {
      await set(scratch.ctx, { userId: scratch.user.id, metric: "DEALS_WON", period: "MONTH", periodStart: SEPTEMBER, value: 5 });
      await set(scratch.ctx, { userId: null, metric: "CALLS_LOGGED", period: "MONTH", periodStart: SEPTEMBER, value: 200 });
      // Already adjusted for October by hand — a copy must not overwrite it.
      await set(scratch.ctx, { userId: scratch.user.id, metric: "DEALS_WON", period: "MONTH", periodStart: OCTOBER, value: 9 });

      const result = await copyTargets(scratch.ctx, {
        period: "MONTH",
        fromPeriodStart: SEPTEMBER,
        toPeriodStart: OCTOBER,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.data).toEqual({ copied: 1, skipped: 1 });

      const october = await listTargets(scratch.ctx, { period: "MONTH", periodStart: OCTOBER });
      expect(october).toHaveLength(2);
      expect(october.find((r) => r.metric === "DEALS_WON")?.value).toBe(9);
      expect(october.find((r) => r.metric === "CALLS_LOGGED")?.value).toBe(200);
    } finally {
      await dropOrg(scratch.org.id);
    }
  });

  it("refuses to copy a period onto itself or from an empty one", async () => {
    const same = await copyTargets(org.ctx, {
      period: "MONTH",
      fromPeriodStart: SEPTEMBER,
      // A different instant in the same September — normalisation makes them equal.
      toPeriodStart: new Date("2026-09-02T00:00:00Z"),
    });
    expect(same.ok).toBe(false);

    const empty = await copyTargets(org.ctx, {
      period: "MONTH",
      fromPeriodStart: new Date("2026-05-15T00:00:00Z"),
      toPeriodStart: new Date("2026-06-15T00:00:00Z"),
    });
    expect(empty.ok).toBe(false);
  });

  it("requires MANAGER or above to copy targets", async () => {
    await expect(
      copyTargets(repCtx, { period: "MONTH", fromPeriodStart: SEPTEMBER, toPeriodStart: OCTOBER }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("isolates copying across tenants", async () => {
    const result = await copyTargets(other.ctx, {
      period: "MONTH",
      fromPeriodStart: SEPTEMBER,
      toPeriodStart: OCTOBER,
    });
    // The other org has no targets of its own, and cannot reach this one's.
    expect(result.ok).toBe(false);
    expect(await db.target.count({ where: { organizationId: other.org.id } })).toBe(0);
  });

  // ─────────────────────────── the thing this must not do ───────────────────────────

  it("exposes no composite score and no ranking function", () => {
    // Design rule 3 in the plan: the system reports, it does not judge. This
    // test exists so adding `sortByPerformance` is a deliberate act with a
    // failing test attached, rather than a quiet afternoon's work.
    const exported = Object.keys(targetsModule);
    expect(exported.filter((name) => /score|rank|league|grade|best|worst/i.test(name))).toEqual([]);
  });
});
