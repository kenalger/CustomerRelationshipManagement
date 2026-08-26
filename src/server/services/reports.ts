import { businessMinutesBetween } from "@/lib/business-hours";
import { db } from "@/lib/db";
import { sumByCurrency, type MoneyTotal } from "@/lib/money";
import { type Ctx, visibleTo } from "@/server/authz";

/**
 * Leadership reporting: pipeline health and where leads come from.
 *
 * Everything here is computed from data the app already records — no new
 * tracking. Two things the brief asks for are deliberately absent and called
 * out rather than faked:
 *
 *  - **Cost per lead** needs spend, and no spend exists anywhere in the
 *    schema. A number invented from nothing would be worse than its absence.
 *  - **Campaign performance** needs campaigns, which are not built yet.
 *
 * Every query is scoped by organization AND by `visibleTo`, so a rep's report
 * reflects their own book rather than the whole company's.
 */

export type SourceBreakdown = {
  source: string;
  leads: number;
  converted: number;
  /** Percentage, 0-100. Null when there are no leads to divide by. */
  conversionRate: number | null;
  /** Median working minutes from arrival to first touch. Null if untouched. */
  medianFirstTouchMinutes: number | null;
};

export type StageHealth = {
  stage: string;
  order: number;
  deals: number;
  value: MoneyTotal;
  /** Median days deals have sat in this stage. Surfaces where things rot. */
  medianDaysInStage: number | null;
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  // Even counts average the two middle values rather than picking one, so the
  // figure does not jump when a single record is added.
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

/** Lead volume, conversion and responsiveness, grouped by where they came from. */
export async function leadsBySource(ctx: Ctx, days = 90): Promise<SourceBreakdown[]> {
  const since = new Date(Date.now() - days * 86_400_000);

  const [org, leads] = await Promise.all([
    db.organization.findUniqueOrThrow({
      where: { id: ctx.organizationId },
      select: {
        timezone: true,
        businessHoursEnabled: true,
        businessDays: true,
        businessStartMinute: true,
        businessEndMinute: true,
      },
    }),
    db.lead.findMany({
      where: {
        organizationId: ctx.organizationId,
        deletedAt: null,
        createdAt: { gte: since },
        ...visibleTo(ctx),
      },
      select: { source: true, status: true, createdAt: true, firstTouchedAt: true },
    }),
  ]);

  const bySource = new Map<string, { leads: number; converted: number; touch: number[] }>();

  for (const lead of leads) {
    const entry = bySource.get(lead.source) ?? { leads: 0, converted: 0, touch: [] };
    entry.leads++;
    if (lead.status === "CONVERTED") entry.converted++;
    if (lead.firstTouchedAt) {
      // Working minutes, so an overnight arrival is not counted as a slow
      // response — the same rule the SLA uses.
      entry.touch.push(businessMinutesBetween(lead.createdAt, lead.firstTouchedAt, org));
    }
    bySource.set(lead.source, entry);
  }

  return [...bySource.entries()]
    .map(([source, entry]) => ({
      source,
      leads: entry.leads,
      converted: entry.converted,
      conversionRate: entry.leads > 0 ? Math.round((entry.converted / entry.leads) * 100) : null,
      medianFirstTouchMinutes: median(entry.touch),
    }))
    .sort((a, b) => b.leads - a.leads);
}

/** Where the open pipeline sits, and where it is going stale. */
export async function pipelineHealth(ctx: Ctx): Promise<StageHealth[]> {
  const stages = await db.stage.findMany({
    where: { pipeline: { organizationId: ctx.organizationId, deletedAt: null } },
    orderBy: { order: "asc" },
    select: {
      id: true,
      name: true,
      order: true,
      isWon: true,
      isLost: true,
      deals: {
        where: { organizationId: ctx.organizationId, deletedAt: null, ...visibleTo(ctx) },
        select: { value: true, currency: true, stageEnteredAt: true },
      },
    },
  });

  const now = Date.now();

  return stages
    .filter((stage) => !stage.isWon && !stage.isLost)
    .map((stage) => ({
      stage: stage.name,
      order: stage.order,
      deals: stage.deals.length,
      value: sumByCurrency(stage.deals),
      medianDaysInStage: median(
        stage.deals.map((d) => Math.floor((now - d.stageEnteredAt.getTime()) / 86_400_000)),
      ),
    }));
}

/** Won versus lost over a window, with the reasons deals were lost. */
export async function winLoss(ctx: Ctx, days = 90) {
  const since = new Date(Date.now() - days * 86_400_000);

  const closed = await db.deal.findMany({
    where: {
      organizationId: ctx.organizationId,
      deletedAt: null,
      closedAt: { gte: since },
      ...visibleTo(ctx),
    },
    select: {
      value: true,
      currency: true,
      lostReason: true,
      stage: { select: { isWon: true, isLost: true } },
    },
  });

  const won = closed.filter((d) => d.stage.isWon);
  const lost = closed.filter((d) => d.stage.isLost);

  // Grouped rather than listed: "went with a competitor, 7 times" is the
  // finding; seven individual sentences are not.
  const reasons = new Map<string, number>();
  for (const deal of lost) {
    const reason = deal.lostReason?.trim() || "No reason recorded";
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }

  return {
    won: won.length,
    lost: lost.length,
    winRate: closed.length > 0 ? Math.round((won.length / closed.length) * 100) : null,
    wonValue: sumByCurrency(won),
    lostValue: sumByCurrency(lost),
    lostReasons: [...reasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/** Per-rep throughput, for a manager reviewing the team. */
export async function ownerPerformance(ctx: Ctx, days = 90) {
  const since = new Date(Date.now() - days * 86_400_000);

  const users = await db.user.findMany({
    where: { organizationId: ctx.organizationId, deletedAt: null },
    select: {
      id: true,
      name: true,
      email: true,
      ownedLeads: {
        where: { deletedAt: null, createdAt: { gte: since } },
        select: { status: true, firstTouchedAt: true },
      },
      ownedDeals: {
        where: { deletedAt: null, closedAt: { gte: since } },
        select: { value: true, currency: true, stage: { select: { isWon: true } } },
      },
    },
  });

  return users
    .map((user) => {
      const leads = user.ownedLeads;
      const wonDeals = user.ownedDeals.filter((d) => d.stage.isWon);
      return {
        id: user.id,
        name: user.name ?? user.email,
        leads: leads.length,
        // Untouched is the number a manager acts on, so it is reported
        // directly rather than left to be inferred from a percentage.
        untouched: leads.filter((l) => !l.firstTouchedAt).length,
        converted: leads.filter((l) => l.status === "CONVERTED").length,
        dealsWon: wonDeals.length,
        wonValue: sumByCurrency(wonDeals),
      };
    })
    .sort((a, b) => b.leads - a.leads);
}
