import { db } from "@/lib/db";
import { sumByCurrency, weightedByCurrency } from "@/lib/money";
import type { Ctx } from "@/server/authz";

/**
 * Everything the overview needs, in one place. Each figure exists to answer a
 * stated question — anything that answers nothing does not belong on a
 * dashboard a rep sees every morning.
 */
export async function getDashboard(ctx: Ctx) {
  const scope = { organizationId: ctx.organizationId, deletedAt: null };

  const [openDeals, newLeads, unworked, contacts, leadHistory, needsAttention] = await Promise.all([
    // "What is the pipeline worth, and what will it probably close at?"
    db.deal.findMany({
      where: { ...scope, stage: { isWon: false, isLost: false } },
      select: {
        value: true,
        currency: true,
        stage: { select: { id: true, name: true, order: true, probability: true } },
      },
    }),
    db.lead.count({ where: { ...scope, status: "NEW" } }),
    db.lead.count({ where: { ...scope, firstTouchedAt: null, status: { in: ["NEW", "WORKING"] } } }),
    db.contact.count({ where: scope }),

    // "Are leads still arriving?" — 14 days is enough to see a stall.
    db.lead.findMany({
      where: { ...scope, createdAt: { gte: new Date(Date.now() - 14 * 86_400_000) } },
      select: { createdAt: true },
      orderBy: { createdAt: "asc" },
    }),

    // "What needs me right now?"
    db.lead.findMany({
      where: { ...scope, firstTouchedAt: null, status: { in: ["NEW", "WORKING"] } },
      orderBy: { createdAt: "asc" },
      take: 6,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        companyName: true,
        createdAt: true,
        owner: { select: { name: true, email: true } },
      },
    }),
  ]);

  // Grouped by currency: adding USD to JPY as raw numbers is silently wrong,
  // and we have no FX rates to convert with.
  const pipelineValue = sumByCurrency(openDeals);
  const weighted = weightedByCurrency(
    openDeals.map((d) => ({
      value: d.value,
      currency: d.currency,
      probability: d.stage.probability,
    })),
  );

  // Value by stage, in pipeline order — stages with nothing in them still
  // appear, because an empty stage is itself a signal.
  const byStageMap = new Map<
    string,
    { name: string; order: number; deals: { value: unknown; currency: string }[]; count: number }
  >();
  for (const deal of openDeals) {
    const existing = byStageMap.get(deal.stage.id) ?? {
      name: deal.stage.name,
      order: deal.stage.order,
      deals: [],
      count: 0,
    };
    existing.deals.push({ value: deal.value, currency: deal.currency });
    existing.count += 1;
    byStageMap.set(deal.stage.id, existing);
  }
  // The chart plots one number per stage, so it uses the dominant currency and
  // the page discloses when the pipeline is mixed.
  const byStage = [...byStageMap.values()]
    .sort((a, b) => a.order - b.order)
    .map((stage) => {
      const total = sumByCurrency(stage.deals);
      return {
        name: stage.name,
        order: stage.order,
        count: stage.count,
        value: total.dominant?.amount ?? 0,
        currency: total.dominant?.currency ?? "USD",
      };
    });

  // Bucket by local day, filling gaps — a missing day must read as zero, not
  // as a gap the line hops over.
  const counts = new Map<string, number>();
  for (const lead of leadHistory) {
    const key = new Date(lead.createdAt).toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const trend: { date: string; label: string; count: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86_400_000);
    const key = day.toISOString().slice(0, 10);
    trend.push({
      date: key,
      label: day.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      count: counts.get(key) ?? 0,
    });
  }

  // Age is computed here, not in the component: a render function must be
  // pure, and reading the clock during render is not.
  const attention = needsAttention.map((lead) => ({
    ...lead,
    ageMinutes: Math.floor((Date.now() - lead.createdAt.getTime()) / 60_000),
  }));

  return {
    pipelineValue,
    weighted,
    openCount: openDeals.length,
    newLeads,
    unworked,
    contacts,
    byStage,
    trend,
    needsAttention: attention,
  };
}
