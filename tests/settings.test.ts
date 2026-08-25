import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { createDeal } from "@/server/services/deals";
import {
  addStage,
  createPipeline,
  deleteStage,
  getOrganization,
  listPipelines,
  renamePipeline,
  reorderStages,
  setDefaultPipeline,
  updateOrganization,
  updateStage,
} from "@/server/services/settings";
import { dropOrg, makeOrg } from "./factories";

describe("organization settings", () => {
  let org: Awaited<ReturnType<typeof makeOrg>>;

  beforeAll(async () => {
    org = await makeOrg();
  });
  afterAll(async () => {
    await dropOrg(org.org.id);
  });

  it("saves a new SLA policy", async () => {
    const result = await updateOrganization(org.ctx, {
      name: "Renamed Co",
      slaFirstTouchMinutes: 15,
      slaEscalateMinutes: 60,
    });
    expect(result.ok).toBe(true);

    const saved = await getOrganization(org.ctx);
    expect(saved.name).toBe("Renamed Co");
    expect(saved.slaFirstTouchMinutes).toBe(15);
  });

  it("refuses an escalation window at or before the first-touch target", async () => {
    // Both stages would fire on the same sweep, so the nudge is never seen alone.
    const equal = await updateOrganization(org.ctx, {
      name: "Renamed Co",
      slaFirstTouchMinutes: 30,
      slaEscalateMinutes: 30,
    });
    expect(equal.ok).toBe(false);
    if (!equal.ok) expect(equal.error).toMatch(/after the first-touch/i);

    const inverted = await updateOrganization(org.ctx, {
      name: "Renamed Co",
      slaFirstTouchMinutes: 120,
      slaEscalateMinutes: 30,
    });
    expect(inverted.ok).toBe(false);
  });

  it("rejects a nonsensical target", async () => {
    const zero = await updateOrganization(org.ctx, {
      name: "Renamed Co",
      slaFirstTouchMinutes: 0,
      slaEscalateMinutes: 60,
    });
    expect(zero.ok).toBe(false);
  });

  it("a MANAGER cannot change org settings", async () => {
    const manager = { ...org.ctx, role: "MANAGER" as const };
    await expect(
      updateOrganization(manager, {
        name: "Hijacked",
        slaFirstTouchMinutes: 5,
        slaEscalateMinutes: 10,
      }),
    ).rejects.toThrow(/permission/i);
  });
});

describe("pipeline administration", () => {
  let org: Awaited<ReturnType<typeof makeOrg>>;
  let other: Awaited<ReturnType<typeof makeOrg>>;
  let pipelineId: string;

  beforeAll(async () => {
    org = await makeOrg();
    other = await makeOrg();

    const created = await createPipeline(org.ctx, { name: "Enterprise" });
    if (!created.ok) throw new Error(created.error);
    pipelineId = created.data.id;
  });

  afterAll(async () => {
    await dropOrg(org.org.id);
    await dropOrg(other.org.id);
    await db.$disconnect();
  });

  it("never creates an empty pipeline", async () => {
    // A pipeline with no stages cannot hold a deal.
    const pipelines = await listPipelines(org.ctx);
    const created = pipelines.find((p) => p.id === pipelineId);
    expect(created?.stages.length).toBeGreaterThan(0);
    expect(created?.stages.some((s) => s.isWon)).toBe(true);
    expect(created?.stages.some((s) => s.isLost)).toBe(true);
  });

  it("refuses a duplicate pipeline name", async () => {
    const again = await createPipeline(org.ctx, { name: "Enterprise" });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toMatch(/already exists/i);
  });

  it("keeps exactly one default pipeline", async () => {
    const result = await setDefaultPipeline(org.ctx, pipelineId);
    expect(result.ok).toBe(true);

    const defaults = await db.pipeline.count({
      where: { organizationId: org.org.id, isDefault: true },
    });
    expect(defaults).toBe(1);
  });

  it("renames a pipeline", async () => {
    const result = await renamePipeline(org.ctx, pipelineId, { name: "Enterprise EMEA" });
    expect(result.ok).toBe(true);

    const pipeline = await db.pipeline.findUniqueOrThrow({ where: { id: pipelineId } });
    expect(pipeline.name).toBe("Enterprise EMEA");
  });

  it("appends a stage after the last one", async () => {
    const result = await addStage(org.ctx, pipelineId, {
      name: "Negotiation",
      probability: 70,
      outcome: "open",
    });
    expect(result.ok).toBe(true);

    const stages = await db.stage.findMany({ where: { pipelineId }, orderBy: { order: "asc" } });
    expect(stages.at(-1)?.name).toBe("Negotiation");
    // Orders must stay unique and contiguous.
    expect(stages.map((s) => s.order)).toEqual(stages.map((_, i) => i + 1));
  });

  it("updates a stage's probability and outcome", async () => {
    const stage = await db.stage.findFirstOrThrow({ where: { pipelineId, name: "Negotiation" } });
    const result = await updateStage(org.ctx, stage.id, {
      name: "Negotiation",
      probability: 85,
      outcome: "open",
    });
    expect(result.ok).toBe(true);

    const updated = await db.stage.findUniqueOrThrow({ where: { id: stage.id } });
    expect(updated.probability).toBe(85);
    expect(updated.isWon).toBe(false);
  });

  it("reorders stages without colliding on the unique order constraint", async () => {
    const before = await db.stage.findMany({
      where: { pipelineId },
      orderBy: { order: "asc" },
      select: { id: true, name: true },
    });

    // Reverse the whole list — the worst case for a naive swap.
    const reversed = [...before].reverse().map((s) => s.id);
    const result = await reorderStages(org.ctx, { pipelineId, stageIds: reversed });
    expect(result.ok).toBe(true);

    const after = await db.stage.findMany({
      where: { pipelineId },
      orderBy: { order: "asc" },
      select: { id: true, order: true },
    });
    expect(after.map((s) => s.id)).toEqual(reversed);
    expect(after.map((s) => s.order)).toEqual(after.map((_, i) => i + 1));
  });

  it("rejects a reorder that is not a full permutation", async () => {
    const stages = await db.stage.findMany({ where: { pipelineId }, select: { id: true } });

    const partial = await reorderStages(org.ctx, {
      pipelineId,
      stageIds: [stages[0].id],
    });
    expect(partial.ok).toBe(false);

    // A foreign stage id must not be able to move another pipeline's stage.
    const foreign = await db.stage.findFirstOrThrow({
      where: { pipeline: { organizationId: other.org.id } },
      select: { id: true },
    });
    const injected = await reorderStages(org.ctx, {
      pipelineId,
      stageIds: [...stages.slice(1).map((s) => s.id), foreign.id],
    });
    expect(injected.ok).toBe(false);
  });

  it("will not delete a stage that still holds deals", async () => {
    const stage = await db.stage.findFirstOrThrow({
      where: { pipelineId, isWon: false, isLost: false },
    });
    const deal = await createDeal(org.ctx, {
      title: "Blocking deal",
      value: 100,
      currency: "USD",
      pipelineId,
      stageId: stage.id,
    });
    if (!deal.ok) throw new Error(deal.error);

    const result = await deleteStage(org.ctx, stage.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/still holds 1 deal/i);

    // And it really is still there.
    expect(await db.stage.count({ where: { id: stage.id } })).toBe(1);
  });

  it("deletes an empty stage", async () => {
    const added = await addStage(org.ctx, pipelineId, {
      name: "Temporary",
      probability: 5,
      outcome: "open",
    });
    if (!added.ok) throw new Error(added.error);

    const result = await deleteStage(org.ctx, added.data.id);
    expect(result.ok).toBe(true);
    expect(await db.stage.count({ where: { id: added.data.id } })).toBe(0);
  });

  describe("tenant isolation", () => {
    it("does not list another org's pipelines", async () => {
      const theirs = await listPipelines(other.ctx);
      expect(theirs.map((p) => p.id)).not.toContain(pipelineId);
    });

    it("cannot rename another org's pipeline", async () => {
      const result = await renamePipeline(other.ctx, pipelineId, { name: "Hijacked" });
      expect(result.ok).toBe(false);

      const untouched = await db.pipeline.findUniqueOrThrow({ where: { id: pipelineId } });
      expect(untouched.name).toBe("Enterprise EMEA");
    });

    it("cannot reach a stage through another org", async () => {
      const stage = await db.stage.findFirstOrThrow({ where: { pipelineId } });
      const result = await updateStage(other.ctx, stage.id, {
        name: "Hijacked",
        probability: 0,
        outcome: "open",
      });
      expect(result.ok).toBe(false);

      const untouched = await db.stage.findUniqueOrThrow({ where: { id: stage.id } });
      expect(untouched.name).not.toBe("Hijacked");
    });

    it("cannot delete another org's stage", async () => {
      const stage = await db.stage.findFirstOrThrow({ where: { pipelineId } });
      const result = await deleteStage(other.ctx, stage.id);
      expect(result.ok).toBe(false);
      expect(await db.stage.count({ where: { id: stage.id } })).toBe(1);
    });
  });
});
