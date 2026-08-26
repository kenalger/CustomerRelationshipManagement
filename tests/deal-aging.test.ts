import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { logActivity } from "@/server/services/activities";
import { createContact } from "@/server/services/contacts";
import { createDeal, moveDealToStage } from "@/server/services/deals";
import { dropOrg, makeOrg } from "./factories";

describe("deal aging and loss reasons", () => {
  let org: Awaited<ReturnType<typeof makeOrg>>;
  let dealId: string;
  let wonStageId: string;
  let lostStageId: string;
  let openStageId: string;

  beforeAll(async () => {
    org = await makeOrg();

    const lost = await db.stage.create({
      data: { pipelineId: org.pipeline.id, name: "Lost", order: 3, probability: 0, isLost: true },
    });
    lostStageId = lost.id;
    wonStageId = (
      await db.stage.findFirstOrThrow({ where: { pipelineId: org.pipeline.id, isWon: true } })
    ).id;
    openStageId = (
      await db.stage.findFirstOrThrow({
        where: { pipelineId: org.pipeline.id, isWon: false, isLost: false },
      })
    ).id;

    const deal = await createDeal(org.ctx, { title: "Aging deal", value: 5000, currency: "USD" });
    if (!deal.ok) throw new Error(deal.error);
    dealId = deal.data.id;
  });

  afterAll(async () => {
    await dropOrg(org.org.id);
    await db.$disconnect();
  });

  it("stamps stageEnteredAt on creation", async () => {
    const deal = await db.deal.findUniqueOrThrow({ where: { id: dealId } });
    expect(deal.stageEnteredAt).not.toBeNull();
  });

  it("resets the days-in-stage clock on every move", async () => {
    // Backdate so the reset is unambiguous.
    const old = new Date(Date.now() - 30 * 86_400_000);
    await db.deal.update({ where: { id: dealId }, data: { stageEnteredAt: old } });

    const result = await moveDealToStage(org.ctx, dealId, wonStageId);
    expect(result.ok).toBe(true);

    const deal = await db.deal.findUniqueOrThrow({ where: { id: dealId } });
    expect(deal.stageEnteredAt.getTime()).toBeGreaterThan(old.getTime());
  });

  it("refuses to mark a deal lost without a reason", async () => {
    const result = await moveDealToStage(org.ctx, dealId, lostStageId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/why this deal was lost/i);

    // And the deal did not move.
    const deal = await db.deal.findUniqueOrThrow({ where: { id: dealId } });
    expect(deal.stageId).not.toBe(lostStageId);
  });

  it("rejects a whitespace-only reason", async () => {
    const result = await moveDealToStage(org.ctx, dealId, lostStageId, "   ");
    expect(result.ok).toBe(false);
  });

  it("stores the reason and puts it on the timeline", async () => {
    const result = await moveDealToStage(org.ctx, dealId, lostStageId, "Went with a cheaper vendor");
    expect(result.ok).toBe(true);

    const deal = await db.deal.findUniqueOrThrow({ where: { id: dealId } });
    expect(deal.lostReason).toBe("Went with a cheaper vendor");
    expect(deal.closedAt).not.toBeNull();

    const activity = await db.activity.findFirstOrThrow({
      where: { dealId, type: "STAGE_CHANGE" },
      orderBy: { occurredAt: "desc" },
    });
    expect(activity.body).toContain("Went with a cheaper vendor");
  });

  it("clears the reason when the deal comes back out of lost", async () => {
    const result = await moveDealToStage(org.ctx, dealId, openStageId);
    expect(result.ok).toBe(true);

    const deal = await db.deal.findUniqueOrThrow({ where: { id: dealId } });
    expect(deal.lostReason).toBeNull();
    expect(deal.closedAt).toBeNull();
  });

  it("does not require a reason to mark a deal won", async () => {
    const result = await moveDealToStage(org.ctx, dealId, wonStageId);
    expect(result.ok).toBe(true);
  });
});

describe("derived activity recency", () => {
  let org: Awaited<ReturnType<typeof makeOrg>>;
  let contactId: string;

  beforeAll(async () => {
    org = await makeOrg();
    const contact = await createContact(org.ctx, { firstName: "Recency", lastName: "Target" });
    if (!contact.ok) throw new Error(contact.error);
    contactId = contact.data.id;
  });

  afterAll(async () => {
    await dropOrg(org.org.id);
  });

  it("starts null — never contacted is not the same as contacted long ago", async () => {
    const contact = await db.contact.findUniqueOrThrow({ where: { id: contactId } });
    expect(contact.lastActivityAt).toBeNull();
  });

  it("advances when an activity is logged", async () => {
    const result = await logActivity(org.ctx, { type: "CALL", subject: "Intro", contactId });
    expect(result.ok).toBe(true);

    const contact = await db.contact.findUniqueOrThrow({ where: { id: contactId } });
    expect(contact.lastActivityAt).not.toBeNull();
  });

  it("advances on a lead too, so a lead queue can be filtered on staleness", async () => {
    const lead = await db.lead.create({
      data: {
        organizationId: org.org.id,
        source: "WEB_FORM",
        status: "NEW",
        firstName: "Recency",
        email: "recency-lead@test.local",
        dedupeKey: `recency-lead-${org.org.id}`,
      },
      select: { id: true, lastActivityAt: true },
    });
    expect(lead.lastActivityAt).toBeNull();

    const result = await logActivity(org.ctx, { type: "CALL", subject: "Dial", leadId: lead.id });
    expect(result.ok).toBe(true);

    const after = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(after.lastActivityAt).not.toBeNull();
  });

  it("never moves backwards when an older activity is backdated in", async () => {
    const before = await db.contact.findUniqueOrThrow({ where: { id: contactId } });

    await logActivity(org.ctx, {
      type: "NOTE",
      subject: "Logged late",
      contactId,
      occurredAt: new Date(Date.now() - 90 * 86_400_000),
    });

    const after = await db.contact.findUniqueOrThrow({ where: { id: contactId } });
    // Backfilling an old call must not make the record look staler than it is.
    expect(after.lastActivityAt?.getTime()).toBe(before.lastActivityAt?.getTime());
  });

  it("answers 'not touched in 30 days' with one indexed query", async () => {
    const stale = await createContact(org.ctx, { firstName: "Stale", lastName: "One" });
    if (!stale.ok) throw new Error(stale.error);
    await db.contact.update({
      where: { id: stale.data.id },
      data: { lastActivityAt: new Date(Date.now() - 45 * 86_400_000) },
    });

    const cutoff = new Date(Date.now() - 30 * 86_400_000);
    const rows = await db.contact.findMany({
      where: {
        organizationId: org.org.id,
        deletedAt: null,
        lastActivityAt: { lt: cutoff },
      },
      select: { id: true },
    });

    expect(rows.map((r) => r.id)).toEqual([stale.data.id]);
  });
});
