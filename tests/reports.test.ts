import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import type { Ctx } from "@/server/authz";
import { createDeal, moveDealToStage } from "@/server/services/deals";
import { ingestLead, convertLead, markLeadTouched } from "@/server/services/leads";
import {
  leadsBySource,
  ownerPerformance,
  pipelineHealth,
  winLoss,
} from "@/server/services/reports";
import { dropOrg, makeOrg } from "./factories";

describe("leadership reporting", () => {
  let org: Awaited<ReturnType<typeof makeOrg>>;
  let wonStage: string;
  let lostStage: string;

  beforeAll(async () => {
    org = await makeOrg();
    // Wall clock, so the first-touch figures below are deterministic.
    await db.organization.update({
      where: { id: org.org.id },
      data: { businessHoursEnabled: false },
    });

    wonStage = (
      await db.stage.findFirstOrThrow({ where: { pipelineId: org.pipeline.id, isWon: true } })
    ).id;
    const lost = await db.stage.create({
      data: { pipelineId: org.pipeline.id, name: "Lost", order: 9, probability: 0, isLost: true },
    });
    lostStage = lost.id;

    // Three leads: two from email (one converted), one from Facebook.
    for (const [key, source, provider] of [
      ["a", "EMAIL", "GOOGLE"],
      ["b", "EMAIL", "GOOGLE"],
      ["c", "FACEBOOK_LEAD_ADS", "FACEBOOK"],
    ] as const) {
      const out = await ingestLead({
        organizationId: org.org.id,
        provider,
        source,
        externalId: `report-${key}`,
        rawPayload: {},
        normalized: { firstName: "Rep", lastName: key, email: `report-${key}@test.local` },
      });
      if (out.kind !== "created") throw new Error("seed");
    }

    const [first] = await db.lead.findMany({
      where: { organizationId: org.org.id, source: "EMAIL" },
      orderBy: { createdAt: "asc" },
      take: 1,
    });
    await markLeadTouched(org.ctx, first.id);
    await convertLead(org.ctx, first.id);
  });

  afterAll(async () => {
    await dropOrg(org.org.id);
    await db.$disconnect();
  });

  it("breaks leads down by source with a real conversion rate", async () => {
    const rows = await leadsBySource(org.ctx);
    const email = rows.find((r) => r.source === "EMAIL");
    const facebook = rows.find((r) => r.source === "FACEBOOK_LEAD_ADS");

    expect(email?.leads).toBe(2);
    expect(email?.converted).toBe(1);
    expect(email?.conversionRate).toBe(50);
    expect(facebook?.conversionRate).toBe(0);
  });

  it("returns null rather than zero when there is nothing to divide by", async () => {
    // A source with no leads must not report 0% conversion, which would read
    // as "we tried and failed" instead of "we have no data".
    const empty = await makeOrg();
    try {
      expect(await leadsBySource(empty.ctx)).toEqual([]);
      const health = await winLoss(empty.ctx);
      expect(health.winRate).toBeNull();
    } finally {
      await dropOrg(empty.org.id);
    }
  });

  it("reports open pipeline by stage and how long deals have sat", async () => {
    const deal = await createDeal(org.ctx, { title: "Stale one", value: 1000, currency: "USD" });
    if (!deal.ok) throw new Error(deal.error);
    await db.deal.update({
      where: { id: deal.data.id },
      data: { stageEnteredAt: new Date(Date.now() - 20 * 86_400_000) },
    });

    const health = await pipelineHealth(org.ctx);
    const withDeals = health.find((s) => s.deals > 0);

    // Two deals sit in this stage: one created fresh by the lead conversion
    // above (0 days) and the one just backdated to 20. An even count averages
    // the two middle values, so the median is 10 — asserting 20 would have
    // been asserting the maximum, not the median.
    expect(withDeals?.deals).toBe(2);
    expect(withDeals?.medianDaysInStage).toBe(10);
    // Closed stages are not "pipeline" and must not inflate it.
    expect(health.every((s) => s.stage !== "Lost")).toBe(true);
  });

  it("groups lost reasons rather than listing them", async () => {
    for (const title of ["Lost one", "Lost two"]) {
      const deal = await createDeal(org.ctx, { title, value: 500, currency: "USD" });
      if (!deal.ok) throw new Error(deal.error);
      await moveDealToStage(org.ctx, deal.data.id, lostStage, "Went with a competitor");
    }
    const deal = await createDeal(org.ctx, { title: "Won one", value: 9000, currency: "USD" });
    if (!deal.ok) throw new Error(deal.error);
    await moveDealToStage(org.ctx, deal.data.id, wonStage);

    const result = await winLoss(org.ctx);
    expect(result.won).toBe(1);
    expect(result.lost).toBe(2);
    expect(result.winRate).toBe(33);
    expect(result.lostReasons[0]).toEqual({ reason: "Went with a competitor", count: 2 });
  });

  it("surfaces untouched leads per owner, which is what a manager acts on", async () => {
    const rows = await ownerPerformance(org.ctx);
    const owner = rows.find((r) => r.id === org.ctx.userId);

    expect(owner?.leads).toBe(3);
    expect(owner?.untouched).toBe(2);
    expect(owner?.dealsWon).toBe(1);
  });

  describe("scoping", () => {
    it("a REP's report covers only their own book", async () => {
      const rep = await db.user.create({
        data: {
          organizationId: org.org.id,
          email: `report-rep-${org.org.id}@test.local`,
          role: "REP",
          passwordHash: "x",
        },
      });
      const repCtx: Ctx = { ...org.ctx, role: "REP", userId: rep.id };

      // Owns nothing, so every figure is empty rather than the company's.
      expect(await leadsBySource(repCtx)).toEqual([]);
      const health = await pipelineHealth(repCtx);
      expect(health.every((s) => s.deals === 0)).toBe(true);
    });

    it("never reports another organization's numbers", async () => {
      const other = await makeOrg();
      try {
        expect(await leadsBySource(other.ctx)).toEqual([]);
        expect((await winLoss(other.ctx)).won).toBe(0);
      } finally {
        await dropOrg(other.org.id);
      }
    });
  });
});
