import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { logActivity } from "@/server/services/activities";
import { createCompany, getCompany, listCompanies, updateCompany } from "@/server/services/companies";
import { createDeal, getDeal, getPipelineBoard, listDeals, moveDealToStage } from "@/server/services/deals";
import { dropOrg, makeOrg } from "./factories";

describe("deals and companies", () => {
  let a: Awaited<ReturnType<typeof makeOrg>>;
  let b: Awaited<ReturnType<typeof makeOrg>>;
  let dealId: string;
  let companyId: string;
  let wonStageId: string;

  beforeAll(async () => {
    a = await makeOrg();
    b = await makeOrg();

    const company = await createCompany(a.ctx, { name: "Northwind Logistics", domain: "northwind.test" });
    if (!company.ok) throw new Error(company.error);
    companyId = company.data.id;

    const deal = await createDeal(a.ctx, {
      title: "Northwind — fleet rollout",
      value: 48000,
      currency: "USD",
      companyId,
    });
    if (!deal.ok) throw new Error(deal.error);
    dealId = deal.data.id;

    const won = await db.stage.findFirst({ where: { pipelineId: a.pipeline.id, isWon: true } });
    wonStageId = won!.id;
  });

  afterAll(async () => {
    await dropOrg(a.org.id);
    await dropOrg(b.org.id);
    await db.$disconnect();
  });

  it("puts a new deal in the first stage of the default pipeline", async () => {
    const deal = await getDeal(a.ctx, dealId);
    expect(deal?.stage.order).toBe(1);
    expect(Number(deal?.value)).toBe(48000);
  });

  it("stores money as an exact decimal, not a float", async () => {
    const created = await createDeal(a.ctx, { title: "Rounding check", value: 1234.56, currency: "USD" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const deal = await db.deal.findUnique({ where: { id: created.data.id } });
    expect(deal?.value.toString()).toBe("1234.56");
  });

  it("moves a deal to another stage and records why", async () => {
    const result = await moveDealToStage(a.ctx, dealId, wonStageId);
    expect(result.ok).toBe(true);

    const deal = await getDeal(a.ctx, dealId);
    expect(deal?.stage.isWon).toBe(true);
    expect(deal?.closedAt).not.toBeNull();

    const activity = await db.activity.findFirst({
      where: { organizationId: a.org.id, dealId, type: "STAGE_CHANGE" },
    });
    expect(activity?.subject).toBe("New → Won");

    const audit = await db.auditLog.findFirst({
      where: { organizationId: a.org.id, entity: "Deal", action: "stage_change" },
    });
    expect(audit).not.toBeNull();
  });

  it("clears closedAt when a deal moves back out of a closed stage", async () => {
    const newStage = await db.stage.findFirst({ where: { pipelineId: a.pipeline.id, order: 1 } });
    await moveDealToStage(a.ctx, dealId, newStage!.id);

    const deal = await getDeal(a.ctx, dealId);
    expect(deal?.closedAt).toBeNull();
  });

  it("rejects a stage from another org's pipeline", async () => {
    const foreignStage = await db.stage.findFirst({ where: { pipelineId: b.pipeline.id } });
    const result = await moveDealToStage(a.ctx, dealId, foreignStage!.id);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/does not belong/i);
  });

  it("rejects a companyId belonging to another org when creating a deal", async () => {
    const foreign = await createCompany(b.ctx, { name: "Org B Holdings" });
    if (!foreign.ok) throw new Error(foreign.error);

    const result = await createDeal(a.ctx, {
      title: "Crafted",
      value: 100,
      currency: "USD",
      companyId: foreign.data.id,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/company does not exist/i);
  });

  describe("tenant isolation", () => {
    it("cannot read another org's company", async () => {
      await expect(getCompany(b.ctx, companyId)).resolves.toBeNull();
    });

    it("does not list another org's companies", async () => {
      const { rows } = await listCompanies(b.ctx, {});
      expect(rows.map((r) => r.id)).not.toContain(companyId);
    });

    it("cannot update another org's company", async () => {
      const result = await updateCompany(b.ctx, companyId, { name: "Hijacked" });
      expect(result.ok).toBe(false);

      const untouched = await db.company.findUnique({ where: { id: companyId } });
      expect(untouched?.name).toBe("Northwind Logistics");
    });

    it("cannot read another org's deal", async () => {
      await expect(getDeal(b.ctx, dealId)).resolves.toBeNull();
    });

    it("does not list another org's deals", async () => {
      const { rows } = await listDeals(b.ctx, { open: "all" });
      expect(rows.map((r) => r.id)).not.toContain(dealId);
    });

    it("cannot move another org's deal", async () => {
      const before = await db.deal.findUnique({ where: { id: dealId }, select: { stageId: true } });
      const result = await moveDealToStage(b.ctx, dealId, wonStageId);

      expect(result.ok).toBe(false);
      const after = await db.deal.findUnique({ where: { id: dealId }, select: { stageId: true } });
      expect(after?.stageId).toBe(before?.stageId);
    });

    it("shows only the caller's own deals on the board", async () => {
      const board = await getPipelineBoard(b.ctx);
      const ids = board?.stages.flatMap((s) => s.deals.map((d) => d.id)) ?? [];
      expect(ids).not.toContain(dealId);
    });
  });

  describe("activities", () => {
    it("logs a note against a deal", async () => {
      const result = await logActivity(a.ctx, {
        type: "CALL",
        subject: "Intro call",
        body: "Walked through pricing.",
        dealId,
      });
      expect(result.ok).toBe(true);
    });

    it("refuses to attach an activity to another org's record", async () => {
      const result = await logActivity(b.ctx, { type: "NOTE", body: "Snooping", dealId });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/does not exist/i);

      const leaked = await db.activity.count({
        where: { organizationId: b.org.id, dealId },
      });
      expect(leaked).toBe(0);
    });

    it("requires exactly one linked record", async () => {
      const none = await logActivity(a.ctx, { type: "NOTE", body: "Floating" });
      expect(none.ok).toBe(false);

      const two = await logActivity(a.ctx, { type: "NOTE", body: "Both", dealId, companyId });
      expect(two.ok).toBe(false);
      if (!two.ok) expect(two.error).toMatch(/exactly one/i);
    });
  });
});
