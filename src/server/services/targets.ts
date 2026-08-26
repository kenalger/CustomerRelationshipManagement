import { z } from "zod";

import type { Role } from "@/generated/prisma/enums";
import { TargetMetric, TargetPeriod } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { type MoneyTotal, sumByCurrency, weightedByCurrency } from "@/lib/money";
import {
  type Pace,
  elapsedFraction,
  isMoneyMetric,
  isOutcomeMetric,
  pace,
  periodBounds,
  periodLabel,
  requiredCoverage,
  successThreshold,
} from "@/lib/targets";
import { type Ctx, requireRole, seesAllRecords } from "@/server/authz";
import { type Result, err, ok } from "@/server/result";
import { writeAudit } from "@/server/services/audit";

/**
 * Targets, quotas and live KPI attainment.
 *
 * Two rules shape everything below and are worth stating once:
 *
 *  1. **Attainment is never stored.** Every figure here is recomputed from
 *     Deals, Leads and Activities on read. A stored number is wrong the moment
 *     a deal is re-staged, and a "recalculate" button people forget to press
 *     is worse than no number at all.
 *  2. **The system reports; it does not judge.** There is deliberately no
 *     composite score and no ranking function in this file. A manager reads
 *     the numbers and forms a view — see `plan/04-features/kpis/plan.md`.
 *
 * Schemas are colocated rather than living in `lib/validation/` for the same
 * reason tags' are: one consumer, two small shapes, no boundary to gain.
 */

// ─────────────────────────── validation ───────────────────────────

/**
 * ISO 4217-shaped, normalised on the way in.
 *
 * Uppercased here so "usd" and "USD" cannot end up as two different quota
 * buckets — currency matching in `attainment` is an exact string compare, and
 * a case difference would silently exclude every deal from its own target.
 */
const currencySchema = z
  .string()
  .transform((raw) => raw.trim().toUpperCase())
  .refine((code) => /^[A-Z]{3}$/.test(code), "Use a three-letter currency code like USD");

/**
 * A target's value.
 *
 * `Decimal(18,2)` in the database, so the ceiling is here rather than left to
 * Postgres — a numeric overflow surfacing as a 500 teaches a user nothing.
 * Zero is allowed: "we are not chasing this metric this month" is a real
 * statement, and it is different from having no target row at all.
 */
const targetValueSchema = z
  .number()
  .refine((n) => Number.isFinite(n), "That is not a number")
  .min(0, "A target cannot be negative")
  .max(1_000_000_000_000, "That target is implausibly large");

export const targetSetSchema = z
  .object({
    /** Null — or absent — means the whole team rather than one person. */
    userId: z.string().cuid().nullish(),
    metric: z.enum(TargetMetric),
    period: z.enum(TargetPeriod),
    /** Any instant inside the period; normalised to the period's real start. */
    periodStart: z.coerce.date(),
    value: targetValueSchema,
    currency: currencySchema.nullish(),
  })
  // Checked here rather than in the service body so the caller gets a field
  // error pointing at `currency` instead of a sentence about metrics.
  .superRefine((input, ctx) => {
    if (isMoneyMetric(input.metric) && !input.currency) {
      ctx.addIssue({
        code: "custom",
        path: ["currency"],
        message: "A revenue target needs a currency",
      });
    }
    if (!isMoneyMetric(input.metric) && input.currency) {
      ctx.addIssue({
        code: "custom",
        path: ["currency"],
        // A count of calls in GBP is not a thing, and accepting it would let
        // two targets for the same metric look meaningfully different.
        message: "Only revenue targets carry a currency",
      });
    }
  });

export type TargetSetInput = z.infer<typeof targetSetSchema>;

/**
 * A batch of targets, as one save of the rep x metric grid.
 *
 * Capped because the whole batch runs in a single interactive transaction and
 * writes an audit row per entry — an unbounded array would sit on a connection
 * long enough to hit the transaction timeout, and a half-applied grid is the
 * one outcome worse than a rejected one.
 */
export const targetSetManySchema = z.array(targetSetSchema).min(1).max(200);

// ─────────────────────────── shapes ───────────────────────────

export type TargetRow = {
  id: string;
  /** Null = the whole team. */
  userId: string | null;
  metric: TargetMetric;
  period: TargetPeriod;
  periodStart: Date;
  value: number;
  currency: string | null;
};

/** A target plus what has actually happened against it, computed live. */
export type AttainmentRow = {
  targetId: string;
  /** Null = the whole team, aggregated across everyone. */
  userId: string | null;
  userName: string;
  metric: TargetMetric;
  period: TargetPeriod;
  periodStart: Date;
  periodEnd: Date;
  /** e.g. "2026-09" or "2026-Q3", in the org's timezone. */
  periodLabel: string;
  target: number;
  currency: string | null;
  /**
   * What has happened so far. Always a number — a target with no matching
   * records reads 0 against its target, because "no progress" and "no data"
   * must not look identical on the screen.
   */
  attained: number;
  /** attained / target. Null only when the target is 0 — there is nothing to divide by. */
  ratio: number | null;
  pace: Pace;
  /** How much of the period has gone, 0–1. */
  elapsed: number;
  /** True for committed quota metrics, false for aspirational activity ones. */
  isOutcome: boolean;
  /** 1 for quota, 0.7 for activity. The UI grades against this, never against 1 for both. */
  successThreshold: number;
  /**
   * REVENUE_WON only: won deals in this period, for this person, in a currency
   * the target is not denominated in. They are NOT added to `attained` — see
   * `lib/money.ts`. Reported so the number is honest about what it left out.
   */
  excluded: { count: number; value: MoneyTotal } | null;
};

export type CoverageRow = {
  targetId: string;
  userId: string | null;
  userName: string;
  currency: string;
  quota: number;
  attained: number;
  /** Quota still to find, floored at 0. */
  remaining: number;
  /** Open pipeline in the target's currency, weighted by stage probability. */
  weightedPipeline: number;
  /** weightedPipeline / remaining. Null once the quota is met — infinite coverage is not a number. */
  ratio: number | null;
  /** Null when `ratio` or `required` is unknown. Never a guess. */
  meetsRequirement: boolean | null;
};

export type CoverageResult = {
  /** Trailing window the win rate is derived from, matching `reports.winLoss`. */
  windowDays: number;
  wonCount: number;
  lostCount: number;
  /** Percentage 0–100, or null with nothing to divide by. */
  winRate: number | null;
  /**
   * 1 / win rate, derived from real history — never a hardcoded 3x.
   * Null when there is too little closed history to say, which is a different
   * statement from "you need 3x" and must not be rendered as one.
   */
  required: number | null;
  rows: CoverageRow[];
};

/**
 * Column order for the grid: committed outcomes first, then aspirational
 * activity.
 *
 * Fixed, and every row always carries all six. That is what structurally
 * enforces the plan's first design rule — no activity number is ever shown
 * alone. A rep with 200 calls and no meetings is the finding, and a payload
 * that could return the 200 without the columns either side of it would let a
 * screen hide exactly that.
 */
export const GRID_METRICS: TargetMetric[] = [
  "REVENUE_WON",
  "DEALS_WON",
  "LEADS_CONVERTED",
  "CALLS_LOGGED",
  "MEETINGS_HELD",
  "FIRST_TOUCHES",
];

export type TargetGridCell = {
  metric: TargetMetric;
  /** Null when management has not set this KPI for this person yet. */
  targetId: string | null;
  /**
   * Null means "no target set", which is NOT the same as a target of 0. Zero
   * is a deliberate "we are not chasing this metric this period"; null is an
   * empty box waiting for a manager. Rendering both as `0` would silently
   * invent a commitment nobody made.
   */
  value: number | null;
  currency: string | null;
  isOutcome: boolean;
  successThreshold: number;
};

export type TargetGridRow = {
  userId: string;
  userName: string;
  role: Role;
  /** One cell per metric in `GRID_METRICS` order, set or not. */
  cells: TargetGridCell[];
};

export type TargetGrid = {
  period: TargetPeriod;
  periodStart: Date;
  periodEnd: Date;
  periodLabel: string;
  metrics: TargetMetric[];
  /** One row per person who can carry a target, whether or not they have one. */
  rows: TargetGridRow[];
  /**
   * The team-wide row, kept out of `rows` because it is not a person and must
   * not be totalled or averaged alongside them.
   */
  team: TargetGridCell[];
};

// ─────────────────────────── internals ───────────────────────────

/** Trailing window for the win rate, chosen to agree with `reports.winLoss`. */
const WIN_RATE_WINDOW_DAYS = 90;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A duplicate target is a user-facing outcome, not a 500 with a Prisma stack. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

/**
 * The org's IANA zone, which every period boundary is resolved in.
 *
 * Loaded, never assumed. A monthly period computed in UTC starts at 8am on the
 * previous day for an org in Asia/Manila, so a deal closed at 00:30 local on
 * the 1st would be counted against the month that just ended.
 */
async function orgTimezone(organizationId: string): Promise<string> {
  const org = await db.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { timezone: true },
  });
  return org.timezone;
}

/**
 * Which targets this caller may read.
 *
 * A REP sees their own and nothing else — including no team target, because a
 * team row aggregates everyone's revenue and would hand a rep the company
 * number by the back door. Plan decision 6 asks for this to be deliberate
 * rather than inherited from `visibleTo()` by accident, so it is spelled out
 * here instead of reusing that helper.
 *
 * MANAGER, ADMIN, OWNER and READ_ONLY see everyone. READ_ONLY is an oversight
 * role: it sees all and changes nothing.
 */
function targetVisibility(ctx: Ctx, userId?: string): { userId?: string | null } {
  if (!seesAllRecords(ctx)) return { userId: ctx.userId };
  return userId === undefined ? {} : { userId };
}

/**
 * The same rule applied to the underlying records, so a rep's attainment is
 * computed from their own book.
 *
 * Two fragments rather than one because deals and leads are *owned*
 * (`ownerId`) while activities are *performed* (`userId`) — a single helper
 * would have to guess which column it is filtering.
 */
function recordScopes(ctx: Ctx) {
  const own = !seesAllRecords(ctx);
  return {
    ownerScope: own ? { ownerId: ctx.userId } : {},
    actorScope: own ? { userId: ctx.userId } : {},
  };
}

/** Display name for a subject row; `null` is the whole team. */
function subjectName(userId: string | null, names: Map<string, string>): string {
  if (userId === null) return "Whole team";
  return names.get(userId) ?? "Unknown user";
}

type Attributed = { key: string | null };

/** Rows belonging to one subject — everything, when the subject is the team. */
function forSubject<T extends Attributed>(rows: T[], userId: string | null): T[] {
  return userId === null ? rows : rows.filter((row) => row.key === userId);
}

/**
 * Normalises a caller-supplied instant to the real bounds of its period.
 *
 * Callers pass "some time in September"; storage and every query need "the
 * instant September began in Manila". Doing this in one place is what makes
 * `setTarget` and `attainment` agree on which row is which.
 */
function boundsFor(period: TargetPeriod, instant: Date, timeZone: string) {
  return periodBounds(period, instant, timeZone);
}

// ─────────────────────────── target lifecycle ───────────────────────────

/**
 * Every target for one period, scoped to what the caller may see.
 *
 * `period` is part of the filter even though it is not part of the unique key.
 * The key is `(organizationId, userId, metric, periodStart)`, so on 1 January
 * a monthly and a quarterly target for the same metric collide — filtering by
 * period means a month view never shows a quarter's number as if it were the
 * month's.
 */
export async function listTargets(
  ctx: Ctx,
  opts: { period: TargetPeriod; periodStart: Date },
): Promise<TargetRow[]> {
  const timeZone = await orgTimezone(ctx.organizationId);
  const { start } = boundsFor(opts.period, opts.periodStart, timeZone);

  const rows = await db.target.findMany({
    where: {
      organizationId: ctx.organizationId, // tenant scope — non-negotiable
      period: opts.period,
      periodStart: start,
      ...targetVisibility(ctx),
    },
    orderBy: [{ userId: "asc" }, { metric: "asc" }, { id: "asc" }],
    select: {
      id: true,
      userId: true,
      metric: true,
      period: true,
      periodStart: true,
      value: true,
      currency: true,
    },
  });

  // Decimal never reaches a caller: it does not survive JSON, and a client
  // that does arithmetic on `{ s, e, d }` gets NaN rather than an error.
  return rows.map((row) => ({ ...row, value: Number(row.value.toString()) }));
}

/**
 * Sets a target, creating or replacing the one on that key.
 *
 * An upsert rather than a create, because "set September's quota to 50k" is
 * idempotent by nature and a manager typing it twice has asked for one thing,
 * not committed an error.
 *
 * Implemented as find-then-write rather than `db.target.upsert` because the
 * unique key includes a nullable `userId`, and Prisma's generated
 * compound-unique input types that column as non-null — there is no way to
 * express "the team's row" through `upsert` at all.
 *
 * The database does back both cases: the index is recreated by hand as
 * `NULLS NOT DISTINCT` in `migrations/20260826054809_target_team_uniqueness`,
 * because Postgres otherwise treats two NULL `userId`s as distinct and the
 * constraint would not constrain team targets. So P2002 below is a genuine
 * race backstop for the team row as well as the per-person one.
 */
export async function setTarget(ctx: Ctx, raw: unknown): Promise<Result<{ id: string }>> {
  // Setting a number someone is measured against is a management act.
  requireRole(ctx, "MANAGER");

  const parsed = targetSetSchema.safeParse(raw);
  if (!parsed.success) {
    return err("Check the highlighted fields", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;
  const userId = input.userId ?? null;

  // Loaded inside the tenant scope, which is what turns a target aimed at
  // another org's user into "not found" rather than a cross-tenant write.
  if (userId !== null) {
    const member = await db.user.findFirst({
      where: { id: userId, organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!member) return err("That person is not in this workspace");
  }

  const timeZone = await orgTimezone(ctx.organizationId);
  const { start } = boundsFor(input.period, input.periodStart, timeZone);

  const data = {
    period: input.period,
    periodStart: start,
    value: input.value,
    // Explicit null, not undefined: Prisma reads undefined as "leave this
    // column alone", which would strand a currency on a metric that changed.
    currency: isMoneyMetric(input.metric) ? (input.currency ?? null) : null,
  };

  // `period` is part of the lookup, not just of the index. Every quarter
  // starts on a month boundary, so on 1 January, 1 April, 1 July and 1 October
  // a monthly and a quarterly target share a `periodStart` — matching without
  // `period` would find the wrong row and overwrite it.
  const existing = await db.target.findFirst({
    where: {
      organizationId: ctx.organizationId,
      userId,
      metric: input.metric,
      period: input.period,
      periodStart: start,
    },
    select: { id: true, period: true, value: true, currency: true },
  });

  try {
    const id = await db.$transaction(async (tx) => {
      if (existing) {
        await tx.target.update({ where: { id: existing.id }, data });
        await writeAudit(tx, ctx, {
          entity: "Target",
          entityId: existing.id,
          action: "update",
          // Decimal is not JSON — stringify before it reaches the payload.
          before: { ...existing, value: existing.value.toString() },
          after: { ...data, metric: input.metric, userId },
        });
        return existing.id;
      }

      const created = await tx.target.create({
        data: {
          organizationId: ctx.organizationId,
          userId,
          metric: input.metric,
          createdById: ctx.userId,
          ...data,
        },
        select: { id: true },
      });
      await writeAudit(tx, ctx, {
        entity: "Target",
        entityId: created.id,
        action: "create",
        after: { ...data, metric: input.metric, userId },
      });
      return created.id;
    });

    return ok({ id });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    // Lost a race with a concurrent set. Nothing of ours was written, so this
    // reports a failure rather than an `ok` for something that did not happen.
    return err("That target was changed at the same time — try again");
  }
}

export async function deleteTarget(ctx: Ctx, id: string): Promise<Result<{ id: string }>> {
  requireRole(ctx, "MANAGER");

  const existing = await db.target.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true, userId: true, metric: true, period: true, periodStart: true, value: true, currency: true },
  });
  if (!existing) return err("Target not found");

  await db.$transaction(async (tx) => {
    await tx.target.delete({ where: { id: existing.id } });
    await writeAudit(tx, ctx, {
      entity: "Target",
      entityId: existing.id,
      action: "delete",
      before: { ...existing, value: existing.value.toString() },
    });
  });

  return ok({ id: existing.id });
}

/**
 * Copies a period's targets forward.
 *
 * Nobody wants to retype eight numbers every month, and a settings page that
 * demands it is a settings page that goes stale. Targets already present in
 * the destination are skipped rather than overwritten — a manager who has
 * already adjusted next month should not lose that to a stray click, and the
 * skipped count is returned so the screen can say what happened.
 *
 * One transaction around the whole loop, and a sequential loop inside it: this
 * pg adapter falls over on concurrent interactive transactions.
 */
export async function copyTargets(
  ctx: Ctx,
  opts: { period: TargetPeriod; fromPeriodStart: Date; toPeriodStart: Date },
): Promise<Result<{ copied: number; skipped: number }>> {
  requireRole(ctx, "MANAGER");

  const timeZone = await orgTimezone(ctx.organizationId);
  const from = boundsFor(opts.period, opts.fromPeriodStart, timeZone).start;
  const to = boundsFor(opts.period, opts.toPeriodStart, timeZone).start;

  if (from.getTime() === to.getTime()) return err("Pick a different period to copy into");

  const source = await db.target.findMany({
    where: { organizationId: ctx.organizationId, period: opts.period, periodStart: from },
    orderBy: [{ userId: "asc" }, { metric: "asc" }, { id: "asc" }],
    select: { userId: true, metric: true, value: true, currency: true },
  });
  if (source.length === 0) return err("That period has no targets to copy");

  const destination = await db.target.findMany({
    where: { organizationId: ctx.organizationId, period: opts.period, periodStart: to },
    select: { userId: true, metric: true },
  });
  // Keyed on the unique constraint's columns, `period` included. Without it a
  // copy into 1 October would treat an existing QUARTER target as blocking the
  // MONTH one it is not actually in conflict with, and silently skip it.
  const taken = new Set(destination.map((row) => `${row.userId ?? ""}|${row.metric}`));

  let copied = 0;
  let skipped = 0;

  await db.$transaction(async (tx) => {
    for (const row of source) {
      if (taken.has(`${row.userId ?? ""}|${row.metric}`)) {
        skipped++;
        continue;
      }
      const created = await tx.target.create({
        data: {
          organizationId: ctx.organizationId,
          userId: row.userId,
          metric: row.metric,
          period: opts.period,
          periodStart: to,
          value: row.value,
          currency: row.currency,
          createdById: ctx.userId,
        },
        select: { id: true },
      });
      await writeAudit(tx, ctx, {
        entity: "Target",
        entityId: created.id,
        action: "copy",
        after: {
          userId: row.userId,
          metric: row.metric,
          periodStart: to,
          value: row.value.toString(),
          currency: row.currency,
        },
      });
      copied++;
    }
  });

  return ok({ copied, skipped });
}

// ─────────────────────────── live attainment ───────────────────────────

type MetricSources = {
  wonDeals: { key: string | null; value: unknown; currency: string }[];
  convertedLeads: Attributed[];
  firstTouches: Attributed[];
  calls: Attributed[];
  meetingsHeld: Attributed[];
};

/**
 * Loads only the records the targets in play actually need.
 *
 * An org with a single CALLS_LOGGED target should not pay for a scan of every
 * won deal in the quarter. Read-only `findMany`s, so `Promise.all` is safe
 * here — it is *interactive transactions* this adapter cannot run concurrently.
 */
async function loadSources(
  ctx: Ctx,
  metrics: Set<TargetMetric>,
  start: Date,
  end: Date,
): Promise<MetricSources> {
  const { ownerScope, actorScope } = recordScopes(ctx);
  const org = ctx.organizationId;
  // Half-open `[start, end)`: a deal closing at exactly midnight on the 1st
  // belongs to the new period, and `lte` would count it in both.
  const window = { gte: start, lt: end };

  const needsDeals = metrics.has("REVENUE_WON") || metrics.has("DEALS_WON");

  const [wonDeals, convertedLeads, firstTouches, calls, meetingsHeld] = await Promise.all([
    needsDeals
      ? db.deal.findMany({
          where: {
            organizationId: org,
            deletedAt: null,
            closedAt: window,
            stage: { isWon: true },
            ...ownerScope,
          },
          select: { ownerId: true, value: true, currency: true },
        })
      : Promise.resolve([]),
    metrics.has("LEADS_CONVERTED")
      ? db.lead.findMany({
          where: {
            organizationId: org,
            deletedAt: null,
            // Both halves. `status` alone has no date on it, so it would count
            // every lead ever converted against whichever period is open;
            // `convertedAt` alone would count a lead that was converted and
            // later moved back to JUNK.
            status: "CONVERTED",
            convertedAt: window,
            ...ownerScope,
          },
          select: { ownerId: true },
        })
      : Promise.resolve([]),
    metrics.has("FIRST_TOUCHES")
      ? db.lead.findMany({
          where: { organizationId: org, deletedAt: null, firstTouchedAt: window, ...ownerScope },
          select: { ownerId: true },
        })
      : Promise.resolve([]),
    metrics.has("CALLS_LOGGED")
      ? db.activity.findMany({
          where: { organizationId: org, type: "CALL", occurredAt: window, ...actorScope },
          select: { userId: true },
        })
      : Promise.resolve([]),
    metrics.has("MEETINGS_HELD")
      ? db.activity.findMany({
          where: {
            organizationId: org,
            type: "MEETING",
            // HELD, never merely booked. A meeting that no-shows costs nothing
            // to produce, so a target on bookings goes up when nothing
            // happened — this filter is the whole reason the column exists.
            outcome: "HELD",
            occurredAt: window,
            ...actorScope,
          },
          select: { userId: true },
        })
      : Promise.resolve([]),
  ]);

  return {
    wonDeals: wonDeals.map((d) => ({ key: d.ownerId, value: d.value, currency: d.currency })),
    convertedLeads: convertedLeads.map((l) => ({ key: l.ownerId })),
    firstTouches: firstTouches.map((l) => ({ key: l.ownerId })),
    calls: calls.map((a) => ({ key: a.userId })),
    meetingsHeld: meetingsHeld.map((a) => ({ key: a.userId })),
  };
}

/** Every user in the org by id, for naming rows. Includes deactivated people. */
async function userNames(organizationId: string): Promise<Map<string, string>> {
  const users = await db.user.findMany({
    where: { organizationId },
    select: { id: true, name: true, email: true },
  });
  return new Map(users.map((u) => [u.id, u.name ?? u.email]));
}

/**
 * Every target for a period with what has actually happened against it.
 *
 * Computed on every call — see the note at the top of this file. `now` is a
 * parameter so pace is testable against a fixed instant rather than whatever
 * time the suite happens to run at.
 */
export async function attainment(
  ctx: Ctx,
  opts: { period: TargetPeriod; periodStart: Date; userId?: string; now?: Date },
): Promise<AttainmentRow[]> {
  const now = opts.now ?? new Date();
  const timeZone = await orgTimezone(ctx.organizationId);
  const { start, end } = boundsFor(opts.period, opts.periodStart, timeZone);

  const targets = await db.target.findMany({
    where: {
      organizationId: ctx.organizationId,
      period: opts.period,
      periodStart: start,
      ...targetVisibility(ctx, opts.userId),
    },
    orderBy: [{ userId: "asc" }, { metric: "asc" }, { id: "asc" }],
    select: { id: true, userId: true, metric: true, period: true, value: true, currency: true },
  });
  if (targets.length === 0) return [];

  const metrics = new Set(targets.map((t) => t.metric));
  const [sources, names] = await Promise.all([
    loadSources(ctx, metrics, start, end),
    userNames(ctx.organizationId),
  ]);

  const elapsed = elapsedFraction(start, end, now);
  const label = periodLabel(opts.period, start, timeZone);

  return targets.map((target) => {
    const value = Number(target.value.toString());
    let attained = 0;
    let excluded: AttainmentRow["excluded"] = null;

    switch (target.metric) {
      case "REVENUE_WON": {
        const mine = forSubject(sources.wonDeals, target.userId);
        // Exact-string currency match. Deals in another currency are counted
        // separately and never folded in: `lib/money.ts` refuses to sum across
        // currencies because we have no FX rates, and quota attainment is not
        // the place that quietly breaks that rule. A REVENUE_WON row with no
        // currency set is misconfigured, and reports everything as excluded
        // rather than picking a currency on its behalf.
        const matching = mine.filter((d) => target.currency && d.currency === target.currency);
        const others = mine.filter((d) => !target.currency || d.currency !== target.currency);
        attained = round2(sumByCurrency(matching).dominant?.amount ?? 0);
        excluded = { count: others.length, value: sumByCurrency(others) };
        break;
      }
      case "DEALS_WON":
        attained = forSubject(sources.wonDeals, target.userId).length;
        break;
      case "LEADS_CONVERTED":
        attained = forSubject(sources.convertedLeads, target.userId).length;
        break;
      case "CALLS_LOGGED":
        attained = forSubject(sources.calls, target.userId).length;
        break;
      case "MEETINGS_HELD":
        attained = forSubject(sources.meetingsHeld, target.userId).length;
        break;
      case "FIRST_TOUCHES":
        attained = forSubject(sources.firstTouches, target.userId).length;
        break;
    }

    return {
      targetId: target.id,
      userId: target.userId,
      userName: subjectName(target.userId, names),
      metric: target.metric,
      period: target.period,
      periodStart: start,
      periodEnd: end,
      periodLabel: label,
      target: value,
      currency: target.currency,
      attained,
      // Null only when there is genuinely nothing to divide by. Zero
      // attainment against a real target is `0`, not null — the two mean
      // different things and must not render the same.
      ratio: value > 0 ? attained / value : null,
      // Raw attainment vs elapsed. Deliberately not pre-graded against
      // `successThreshold`: `lib/targets.ts` owns that distinction, and the
      // threshold travels on the row so a caller applies it once.
      pace: pace(attained, value, elapsed),
      elapsed,
      isOutcome: isOutcomeMetric(target.metric),
      successThreshold: successThreshold(target.metric),
      excluded,
    };
  });
}

// ─────────────────────────── coverage ───────────────────────────

/**
 * Open weighted pipeline against the quota still to find.
 *
 * The earliest honest signal of whether a revenue period lands, and unlike an
 * activity count it cannot be improved by doing more of something cheap.
 *
 * The required ratio is derived from the caller's own closed history as
 * `1 / win rate`, over the same trailing window `reports.winLoss` uses, and is
 * **null when there is too little history** — the received 3x wisdom is not
 * shipped as a constant, because a made-up number that reaches a board pack is
 * worse than an admitted gap.
 *
 * All open pipeline counts, not only deals whose `expectedCloseDate` falls in
 * the period: the field is optional and mostly unset, so filtering on it would
 * silently drop most of the pipeline and report a coverage crisis that is
 * really a data-entry one.
 */
export async function coverage(
  ctx: Ctx,
  opts: { period: TargetPeriod; periodStart: Date; userId?: string; now?: Date },
): Promise<CoverageResult> {
  const now = opts.now ?? new Date();
  const { ownerScope } = recordScopes(ctx);
  const since = new Date(now.getTime() - WIN_RATE_WINDOW_DAYS * 86_400_000);

  // Revenue attainment is reused rather than recomputed, so coverage cannot
  // disagree with the attainment screen about the same quota.
  const rows = (await attainment(ctx, opts)).filter((row) => row.metric === "REVENUE_WON");

  const [closed, openDeals] = await Promise.all([
    db.deal.findMany({
      where: {
        organizationId: ctx.organizationId,
        deletedAt: null,
        closedAt: { gte: since, lte: now },
        ...ownerScope,
      },
      select: { stage: { select: { isWon: true, isLost: true } } },
    }),
    rows.length === 0
      ? Promise.resolve([])
      : db.deal.findMany({
          where: {
            organizationId: ctx.organizationId,
            deletedAt: null,
            stage: { isWon: false, isLost: false },
            ...ownerScope,
          },
          select: {
            ownerId: true,
            value: true,
            currency: true,
            stage: { select: { probability: true } },
          },
        }),
  ]);

  const wonCount = closed.filter((d) => d.stage.isWon).length;
  const lostCount = closed.filter((d) => d.stage.isLost).length;
  const closedCount = wonCount + lostCount;
  const required = requiredCoverage(wonCount, lostCount);

  const pipeline = openDeals.map((d) => ({
    key: d.ownerId,
    value: d.value,
    currency: d.currency,
    probability: d.stage.probability,
  }));

  return {
    windowDays: WIN_RATE_WINDOW_DAYS,
    wonCount,
    lostCount,
    winRate: closedCount > 0 ? Math.round((wonCount / closedCount) * 100) : null,
    required,
    rows: rows.map((row) => {
      const currency = row.currency ?? "";
      const remaining = round2(Math.max(0, row.target - row.attained));
      const weighted = weightedByCurrency(
        forSubject(pipeline, row.userId).filter((d) => currency && d.currency === currency),
      );
      const weightedPipeline = round2(weighted.dominant?.amount ?? 0);
      // Null, not Infinity and not 0: a quota already met has no coverage
      // question left to answer, and 0 would read as "no pipeline".
      const ratio = remaining > 0 ? weightedPipeline / remaining : null;

      return {
        targetId: row.targetId,
        userId: row.userId,
        userName: row.userName,
        currency,
        quota: row.target,
        attained: row.attained,
        remaining,
        weightedPipeline,
        ratio,
        meetsRequirement: ratio !== null && required !== null ? ratio >= required : null,
      };
    }),
  };
}

// ─────────────────────────── the rep × metric grid ───────────────────────────

/**
 * Every person who can carry a target, crossed with every metric, for one
 * period — including the empty boxes.
 *
 * This is the shape the Settings → Targets screen needs, and `listTargets` is
 * the wrong call for it: that returns only the rows that exist, so a rep whose
 * KPIs have never been set would simply be absent from the grid and would
 * quietly never get a number. Targets are set per rep, by hand, so the screen
 * has to show who has not been done yet.
 *
 * READ_ONLY users are excluded from `rows`. It is an oversight role that owns
 * no records (see `seesAllRecords`), so a revenue quota on one could never be
 * attained by anything — an un-fillable row in a grid a manager works through
 * top to bottom is noise that looks like an omission.
 *
 * Deliberately carries no attainment. This is the editing view; a settings
 * screen should not pay for six aggregation queries to render input boxes.
 * Call `attainment` for the reporting view.
 */
export async function targetGrid(
  ctx: Ctx,
  opts: { period: TargetPeriod; periodStart: Date },
): Promise<TargetGrid> {
  const timeZone = await orgTimezone(ctx.organizationId);
  const { start, end } = boundsFor(opts.period, opts.periodStart, timeZone);

  const [people, existing] = await Promise.all([
    db.user.findMany({
      where: {
        organizationId: ctx.organizationId,
        deletedAt: null,
        role: { not: "READ_ONLY" },
        // A REP gets a one-row grid of themselves, the same rule
        // `listTargets` and `attainment` apply. The team matrix is management
        // information.
        ...(seesAllRecords(ctx) ? {} : { id: ctx.userId }),
      },
      orderBy: [{ name: "asc" }, { email: "asc" }],
      select: { id: true, name: true, email: true, role: true },
    }),
    db.target.findMany({
      where: {
        organizationId: ctx.organizationId,
        period: opts.period,
        periodStart: start,
        ...targetVisibility(ctx),
      },
      select: { id: true, userId: true, metric: true, value: true, currency: true },
    }),
  ]);

  // Keyed on person + metric. `""` stands in for the team's null userId, which
  // cannot be a Map key alongside strings without this.
  const bySlot = new Map(
    existing.map((row) => [`${row.userId ?? ""}|${row.metric}`, row] as const),
  );

  const cellsFor = (userId: string | null): TargetGridCell[] =>
    GRID_METRICS.map((metric) => {
      const found = bySlot.get(`${userId ?? ""}|${metric}`);
      return {
        metric,
        targetId: found?.id ?? null,
        // Null, not 0 — see the note on TargetGridCell.value.
        value: found ? Number(found.value.toString()) : null,
        currency: found?.currency ?? null,
        isOutcome: isOutcomeMetric(metric),
        successThreshold: successThreshold(metric),
      };
    });

  return {
    period: opts.period,
    periodStart: start,
    periodEnd: end,
    periodLabel: periodLabel(opts.period, start, timeZone),
    metrics: GRID_METRICS,
    rows: people.map((person) => ({
      userId: person.id,
      userName: person.name ?? person.email,
      role: person.role,
      cells: cellsFor(person.id),
    })),
    team: seesAllRecords(ctx) ? cellsFor(null) : [],
  };
}

/**
 * Saves many targets at once — one row of the grid, one column, or the lot.
 *
 * Targets are set per rep by hand, which means a manager filling in six
 * numbers for a person would otherwise cost six round trips and six chances to
 * half-succeed. This applies the batch atomically instead: either every number
 * lands or none does, so the grid on screen can never disagree with the
 * database about what was saved.
 *
 * The whole batch is validated BEFORE anything is written. One bad cell
 * rejects the save and names the offending index, rather than persisting the
 * first four numbers and erroring on the fifth — a partly-applied set of
 * quotas is a number somebody is measured against that nobody chose.
 */
export async function setTargets(
  ctx: Ctx,
  raw: unknown,
): Promise<Result<{ created: number; updated: number }>> {
  requireRole(ctx, "MANAGER");

  const parsed = targetSetManySchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return err(
      first ? `${first.path.join(".") || "targets"}: ${first.message}` : "Check the targets",
    );
  }
  const inputs = parsed.data;

  // Every referenced person, in one query rather than one per entry.
  const userIds = [...new Set(inputs.map((i) => i.userId).filter((id): id is string => !!id))];
  if (userIds.length > 0) {
    const members = await db.user.findMany({
      where: { id: { in: userIds }, organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true },
    });
    if (members.length !== userIds.length) {
      // Named as "not in this workspace" rather than listing which id failed:
      // confirming that an id exists somewhere is itself a cross-tenant leak.
      return err("One of those people is not in this workspace");
    }
  }

  const timeZone = await orgTimezone(ctx.organizationId);

  const slot = (userId: string | null, metric: TargetMetric, start: Date) =>
    `${userId ?? ""}|${metric}|${start.getTime()}`;

  const entries = inputs.map((input) => {
    const start = boundsFor(input.period, input.periodStart, timeZone).start;
    const userId = input.userId ?? null;
    return {
      key: slot(userId, input.metric, start),
      userId,
      metric: input.metric,
      period: input.period,
      periodStart: start,
      value: input.value,
      currency: isMoneyMetric(input.metric) ? (input.currency ?? null) : null,
    };
  });

  // Two entries for the same slot would make the saved value depend on array
  // order, which is not something a caller can reason about. Rejected.
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.key)) {
      return err("The same target appears twice in that batch");
    }
    seen.add(entry.key);
  }

  const current = await db.target.findMany({
    where: {
      organizationId: ctx.organizationId,
      periodStart: { in: [...new Set(entries.map((e) => e.periodStart.getTime()))].map((t) => new Date(t)) },
    },
    select: { id: true, userId: true, metric: true, periodStart: true, period: true, value: true, currency: true },
  });
  const bySlot = new Map(
    current.map((row) => [slot(row.userId, row.metric, row.periodStart), row] as const),
  );

  let created = 0;
  let updated = 0;

  try {
    await db.$transaction(
      async (tx) => {
        // Sequential: this pg adapter cannot run concurrent statements inside
        // one interactive transaction.
        for (const entry of entries) {
          const existing = bySlot.get(entry.key);
          const data = {
            period: entry.period,
            periodStart: entry.periodStart,
            value: entry.value,
            // Explicit null, never undefined — Prisma reads undefined as
            // "leave this column alone".
            currency: entry.currency,
          };

          if (existing) {
            await tx.target.update({ where: { id: existing.id }, data });
            await writeAudit(tx, ctx, {
              entity: "Target",
              entityId: existing.id,
              action: "update",
              before: { ...existing, value: existing.value.toString() },
              after: { ...data, metric: entry.metric, userId: entry.userId },
            });
            updated++;
            continue;
          }

          const row = await tx.target.create({
            data: {
              organizationId: ctx.organizationId,
              userId: entry.userId,
              metric: entry.metric,
              createdById: ctx.userId,
              ...data,
            },
            select: { id: true },
          });
          await writeAudit(tx, ctx, {
            entity: "Target",
            entityId: row.id,
            action: "create",
            after: { ...data, metric: entry.metric, userId: entry.userId },
          });
          created++;
        }
      },
      // The default 5s is not enough for a full grid plus an audit row each.
      { timeout: 20_000 },
    )
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    // The transaction rolled back, so nothing was written — reporting a
    // failure rather than an `ok` for a save that did not happen.
    return err("Those targets were changed at the same time — reload and try again");
  }

  return ok({ created, updated });
}
