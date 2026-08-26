import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import type { Ctx } from "@/server/authz";
import { createAutomation, setAutomationEnabled, setSteps } from "@/server/services/automation";
import { ingestLead } from "@/server/services/leads";
import { dropOrg, makeOrg } from "./factories";

/*
 * The engine has its own tests. This file asserts the WIRING: that the real
 * service call sites raise events at all.
 *
 * Worth its own file because the engine passed 34 tests while being completely
 * inert — nothing in the application called `dispatch`, and no engine test
 * could have noticed.
 */
describe("automation wiring", () => {
  let org: Awaited<ReturnType<typeof makeOrg>>;
  let ctx: Ctx;

  beforeAll(async () => {
    org = await makeOrg();
    ctx = { ...org.ctx, role: "OWNER" };

    const created = await createAutomation(ctx, {
      name: `Welcome ${randomUUID().slice(0, 8)}`,
      trigger: "LEAD_CREATED",
      conditions: null,
    });
    if (!created.ok) throw new Error(created.error);

    const steps = await setSteps(ctx, created.data.id, [
      { action: "CREATE_TASK", config: { title: "Call the new lead", dueInDays: 1 } },
    ]);
    if (!steps.ok) throw new Error(steps.error);

    const armed = await setAutomationEnabled(ctx, created.data.id, true);
    if (!armed.ok) throw new Error(armed.error);
  });

  afterAll(async () => {
    await dropOrg(org.org.id);
    await db.$disconnect();
  });

  it("fires LEAD_CREATED from a real ingestion, and the step actually runs", async () => {
    const outcome = await ingestLead({
      organizationId: org.org.id,
      provider: "FACEBOOK",
      source: "FACEBOOK_LEAD_ADS",
      externalId: `wiring-${randomUUID().slice(0, 8)}`,
      rawPayload: { seeded: true },
      normalized: { firstName: "Wired", lastName: "Up", email: `wired-${randomUUID().slice(0, 8)}@test.local` },
    });
    expect(outcome.kind).toBe("created");
    if (outcome.kind !== "created") throw new Error("unreachable");

    const runs = await db.automationRun.findMany({
      where: { organizationId: org.org.id, recordId: outcome.leadId },
      select: { status: true },
    });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("SUCCEEDED");

    // The step's effect, not just the run row: a run that "succeeded" without
    // doing anything is the failure this test exists to catch.
    const task = await db.task.findFirst({
      where: { organizationId: org.org.id, leadId: outcome.leadId },
      select: { title: true },
    });
    expect(task?.title).toBe("Call the new lead");
  });

  it("does not fire for a replayed webhook", async () => {
    const externalId = `replay-${randomUUID().slice(0, 8)}`;
    const normalized = { firstName: "Once", email: `once-${randomUUID().slice(0, 8)}@test.local` };
    const base = {
      organizationId: org.org.id,
      provider: "FACEBOOK" as const,
      source: "FACEBOOK_LEAD_ADS" as const,
      externalId,
      rawPayload: { seeded: true },
      normalized,
    };

    const first = await ingestLead(base);
    expect(first.kind).toBe("created");
    if (first.kind !== "created") throw new Error("unreachable");

    // Same externalId: the ingestion is replayed, not a new lead arriving.
    const second = await ingestLead(base);
    expect(second.kind).toBe("replayed");

    const runs = await db.automationRun.count({
      where: { organizationId: org.org.id, recordId: first.leadId },
    });
    expect(runs).toBe(1);
  });
});
