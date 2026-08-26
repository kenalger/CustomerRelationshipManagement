import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { slaSnapshot, sweepSlaBreaches } from "@/server/services/sla";
import { convertLead, ingestLead, markLeadTouched } from "@/server/services/leads";
import { dropOrg, makeOrg } from "./factories";

/** Backdates a lead so the SLA clock has already run, without waiting. */
async function age(leadId: string, minutes: number) {
  await db.lead.update({
    where: { id: leadId },
    data: { createdAt: new Date(Date.now() - minutes * 60_000) },
  });
}

async function seedLead(organizationId: string, externalId: string, email: string) {
  const outcome = await ingestLead({
    organizationId,
    provider: "GOOGLE",
    source: "EMAIL",
    externalId,
    rawPayload: {},
    normalized: { firstName: "Slow", lastName: "Lead", email },
  });
  if (outcome.kind !== "created") throw new Error(`expected created, got ${outcome.kind}`);
  return outcome.leadId;
}

describe("speed-to-lead SLA", () => {
  let org: Awaited<ReturnType<typeof makeOrg>>;
  let managerId: string;

  beforeAll(async () => {
    org = await makeOrg();

    /*
     * Business hours OFF for these tests.
     *
     * They exercise the escalation MECHANICS — who is notified, once, and in
     * what order — by backdating `createdAt`. With business hours on (the
     * product default) a lead backdated 45 minutes only breaches if the suite
     * happens to run inside 09:00-17:00 on a weekday, which would make every
     * assertion here depend on the clock.
     *
     * The working-time arithmetic itself is covered deterministically in
     * tests/business-hours.test.ts against fixed instants.
     */
    await db.organization.update({
      where: { id: org.org.id },
      data: { businessHoursEnabled: false },
    });
    const manager = await db.user.create({
      data: {
        organizationId: org.org.id,
        email: `manager-${org.org.id}@test.local`,
        role: "MANAGER",
        passwordHash: "x",
      },
    });
    managerId = manager.id;
  });

  afterAll(async () => {
    await dropOrg(org.org.id);
    await db.$disconnect();
  });

  it("leaves a fresh lead alone", async () => {
    const leadId = await seedLead(org.org.id, "sla-fresh", "fresh@test.local");

    const results = await sweepSlaBreaches({ organizationId: org.org.id });
    expect(results.nudged).toBe(0);

    const nudges = await db.notification.count({
      where: { organizationId: org.org.id, type: "LEAD_UNWORKED", entityId: leadId },
    });
    expect(nudges).toBe(0);
  });

  it("nudges the owner once the first-touch target passes", async () => {
    const leadId = await seedLead(org.org.id, "sla-stale", "stale@test.local");
    await age(leadId, 45); // default target is 30 minutes

    await sweepSlaBreaches({ organizationId: org.org.id });

    // Round-robin picks whoever has the fewest open leads, so read the owner
    // off the lead rather than assuming it is the org owner.
    const { ownerId } = await db.lead.findUniqueOrThrow({
      where: { id: leadId },
      select: { ownerId: true },
    });

    const nudge = await db.notification.findFirstOrThrow({
      where: {
        organizationId: org.org.id,
        entityId: leadId,
        userId: ownerId!,
        type: "LEAD_UNWORKED",
      },
    });
    expect(nudge.title).toMatch(/waiting \d+ minutes/);
  });

  it("does not nudge the same lead twice", async () => {
    const before = await db.notification.count({
      where: { organizationId: org.org.id, type: "LEAD_UNWORKED" },
    });

    await sweepSlaBreaches({ organizationId: org.org.id });

    const after = await db.notification.count({
      where: { organizationId: org.org.id, type: "LEAD_UNWORKED" },
    });
    expect(after).toBe(before);
  });

  it("keeps quiet after the owner reads the nudge but has not acted", async () => {
    // The lead-level marker, not the notification dedupe key, is what stops
    // this — reading an alert must not re-arm it.
    await db.notification.updateMany({
      where: { organizationId: org.org.id, type: "LEAD_UNWORKED" },
      data: { readAt: new Date() },
    });

    const before = await db.notification.count({
      where: { organizationId: org.org.id, type: "LEAD_UNWORKED" },
    });
    await sweepSlaBreaches({ organizationId: org.org.id });
    const after = await db.notification.count({
      where: { organizationId: org.org.id, type: "LEAD_UNWORKED" },
    });

    expect(after).toBe(before);
  });

  it("escalates past the owner once the escalation window passes", async () => {
    const leadId = await seedLead(org.org.id, "sla-escalate", "escalate@test.local");
    await age(leadId, 180); // default escalation is 120 minutes

    // Pin the owner so round-robin cannot hand this lead to the manager and
    // make the assertion below depend on assignment order.
    await db.lead.update({ where: { id: leadId }, data: { ownerId: org.user.id } });

    await sweepSlaBreaches({ organizationId: org.org.id });

    const toManager = await db.notification.findFirst({
      where: { organizationId: org.org.id, entityId: leadId, userId: managerId },
    });
    expect(toManager?.title).toMatch(/^Escalation:/);
  });

  it("reports leads escalated separately from alerts actually sent", async () => {
    // A solo org has nobody to escalate to. The counters must show that
    // rather than implying someone was warned.
    const solo = await makeOrg();
    try {
      await db.organization.update({
        where: { id: solo.org.id },
        data: { businessHoursEnabled: false },
      });
      const leadId = await seedLead(solo.org.id, "sla-solo", "solo@test.local");
      await age(leadId, 180);

      const results = await sweepSlaBreaches({ organizationId: solo.org.id });
      expect(results.escalated).toBe(1);
      expect(results.escalationAlerts).toBe(0);
    } finally {
      await dropOrg(solo.org.id);
    }
  });

  it("does not escalate a lead to the person sitting on it", async () => {
    const lead = await db.lead.findFirstOrThrow({
      where: { organizationId: org.org.id, slaEscalatedAt: { not: null } },
      select: { id: true, ownerId: true },
    });

    const selfEscalation = await db.notification.count({
      where: {
        organizationId: org.org.id,
        entityId: lead.id,
        userId: lead.ownerId!,
        title: { startsWith: "Escalation:" },
      },
    });
    expect(selfEscalation).toBe(0);
  });

  it("stops the clock when a rep marks the lead worked", async () => {
    const leadId = await seedLead(org.org.id, "sla-worked", "worked@test.local");
    await age(leadId, 45);

    const touched = await markLeadTouched(org.ctx, leadId);
    expect(touched.ok).toBe(true);

    await sweepSlaBreaches({ organizationId: org.org.id });

    // Only SLA alerts should be absent — the lead-assigned notification from
    // ingestion is expected and unrelated.
    const nudge = await db.notification.count({
      where: { organizationId: org.org.id, entityId: leadId, type: "LEAD_UNWORKED" },
    });
    expect(nudge).toBe(0);

    const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.slaNotifiedAt).toBeNull();
  });

  it("stops the clock when a lead is converted", async () => {
    const leadId = await seedLead(org.org.id, "sla-converted", "converted@test.local");
    await age(leadId, 45);

    const converted = await convertLead(org.ctx, leadId);
    expect(converted.ok).toBe(true);

    await sweepSlaBreaches({ organizationId: org.org.id });
    const nudge = await db.notification.count({
      where: { organizationId: org.org.id, entityId: leadId, type: "LEAD_UNWORKED" },
    });
    expect(nudge).toBe(0);
  });

  it("honours a per-organization policy", async () => {
    const strict = await makeOrg();
    try {
      await db.organization.update({
        where: { id: strict.org.id },
        data: { slaFirstTouchMinutes: 5, slaEscalateMinutes: 10, businessHoursEnabled: false },
      });

      const leadId = await seedLead(strict.org.id, "sla-strict", "strict@test.local");
      await age(leadId, 7); // past 5, not past 10

      await sweepSlaBreaches({ organizationId: strict.org.id });

      const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId } });
      expect(lead.slaNotifiedAt).not.toBeNull();
      expect(lead.slaEscalatedAt).toBeNull();
    } finally {
      await dropOrg(strict.org.id);
    }
  });

  it("reports a snapshot scoped to the caller's tenant", async () => {
    const snapshot = await slaSnapshot(org.ctx);
    expect(snapshot.slaFirstTouchMinutes).toBe(30);
    expect(snapshot.breaching).toBeGreaterThan(0);
    expect(snapshot.unworked).toBeGreaterThanOrEqual(snapshot.breaching);

    const other = await makeOrg();
    try {
      const clean = await slaSnapshot(other.ctx);
      expect(clean.unworked).toBe(0);
      expect(clean.breaching).toBe(0);
    } finally {
      await dropOrg(other.org.id);
    }
  });
});
