import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import type { Ctx } from "@/server/authz";
import { createDeal, moveDealToStage } from "@/server/services/deals";
import { ingestLead, convertLead, markLeadTouched } from "@/server/services/leads";
import {
  dealSlippage,
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

  describe("deal slippage", () => {
    let slipOrg: Awaited<ReturnType<typeof makeOrg>>;
    let slipWonStage: string;

    /** Creates a closed deal with a forecast date and an actual close date. */
    async function closedDeal(expected: Date | null, closedAt: Date) {
      await db.deal.create({
        data: {
          organizationId: slipOrg.org.id,
          title: `Slip ${closedAt.toISOString()}-${Math.random()}`,
          value: 1000,
          currency: "USD",
          pipelineId: slipOrg.pipeline.id,
          stageId: slipWonStage,
          expectedCloseDate: expected,
          closedAt,
        },
      });
    }

    beforeAll(async () => {
      // Its own org: slippage is org-wide, so asserting counts inside the
      // shared fixture would really be asserting on file execution order.
      slipOrg = await makeOrg();
      slipWonStage = (
        await db.stage.findFirstOrThrow({
          where: { pipelineId: slipOrg.pipeline.id, isWon: true },
        })
      ).id;
    });

    afterAll(async () => {
      await dropOrg(slipOrg.org.id);
    });

    it("reports null rather than zero when nothing carries a forecast date", async () => {
      // "No deal ever slipped" and "nobody sets a forecast date" are opposite
      // findings and must not render identically.
      const empty = await dealSlippage(slipOrg.ctx);
      expect(empty.medianSlipDays).toBeNull();
      expect(empty.sampled).toBe(0);
    });

    it("counts deals with no forecast date instead of dropping them", async () => {
      const closed = new Date(Date.now() - 5 * 86_400_000);
      await closedDeal(null, closed);

      const result = await dealSlippage(slipOrg.ctx);
      expect(result.unforecast).toBe(1);
      // Still nothing to measure — the unforecast deal must not become a 0.
      expect(result.medianSlipDays).toBeNull();
    });

    it("takes the median so one wild deal cannot distort it", async () => {
      const day = 86_400_000;
      const base = Date.now() - 30 * day;

      // Slips of 2, 4, and 300 days. The mean is 102; the median is 4.
      await closedDeal(new Date(base), new Date(base + 2 * day));
      await closedDeal(new Date(base), new Date(base + 4 * day));
      await closedDeal(new Date(base), new Date(base + 300 * day));

      const result = await dealSlippage(slipOrg.ctx);
      expect(result.sampled).toBe(3);
      expect(result.medianSlipDays).toBe(4);
      expect(result.late).toBe(3);
    });

    it("treats a day either side as on time, and counts early separately", async () => {
      const fresh = await makeOrg();
      const wonStageId = (
        await db.stage.findFirstOrThrow({
          where: { pipelineId: fresh.pipeline.id, isWon: true },
        })
      ).id;
      const base = Date.now() - 20 * 86_400_000;

      for (const offsetDays of [0, 1, -1, -9, 6]) {
        await db.deal.create({
          data: {
            organizationId: fresh.org.id,
            title: `Edge ${offsetDays}`,
            value: 500,
            currency: "USD",
            pipelineId: fresh.pipeline.id,
            stageId: wonStageId,
            expectedCloseDate: new Date(base),
            closedAt: new Date(base + offsetDays * 86_400_000),
          },
        });
      }

      const result = await dealSlippage(fresh.ctx);
      // Nobody closes to the hour, so 0 and ±1 all count as on time.
      expect(result.onTime).toBe(3);
      expect(result.early).toBe(1);
      expect(result.late).toBe(1);

      await dropOrg(fresh.org.id);
    });

    it("does not see another tenant's deals", async () => {
      const stranger = await makeOrg();
      const result = await dealSlippage(stranger.ctx);
      expect(result.sampled).toBe(0);
      expect(result.unforecast).toBe(0);
      await dropOrg(stranger.org.id);
    });
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
