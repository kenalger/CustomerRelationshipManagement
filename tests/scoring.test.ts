import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { ForbiddenError } from "@/server/authz";
import {
  DEFAULT_SCORING_RULES,
  type ScorableLead,
  type ScoringRules,
  getScoringRules,
  parseScoringRules,
  rescoreLead,
  rescoreOrganization,
  scoreLead,
  updateScoringRules,
} from "@/server/services/scoring";
import { dropOrg, makeOrg } from "./factories";

/*
 * The pure half of this suite runs without a database on purpose. `scoreLead`
 * is where the product decision lives; if the arithmetic is wrong, persisting
 * it faithfully is worthless.
 */

/** A fixed instant, so "fresh" and "stale" never depend on when the suite runs. */
const NOW = new Date("2026-06-15T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

/**
 * Every weight zeroed. Isolating one rule means starting from a document where
 * nothing else can contribute — otherwise a passing assertion only proves the
 * sum, not the rule.
 */
const ZERO: ScoringRules = {
  base: 0,
  sourceWeights: {
    FACEBOOK_LEAD_ADS: 0,
    FACEBOOK_MESSENGER: 0,
    FACEBOOK_COMMENT: 0,
    EMAIL: 0,
    CSV_IMPORT: 0,
    WEB_FORM: 0,
    MANUAL: 0,
  },
  hasEmail: 0,
  hasPhone: 0,
  hasCompanyName: 0,
  statusWeights: { NEW: 0, WORKING: 0, QUALIFIED: 0, CONVERTED: 0, JUNK: 0 },
  recency: { freshHours: 24, freshPoints: 0, staleDays: 30, stalePenalty: 0 },
};

/** A lead that scores nothing under ZERO: no contact details, mid-age. */
function bareLead(overrides: Partial<ScorableLead> = {}): ScorableLead {
  return {
    source: "MANUAL",
    status: "NEW",
    email: null,
    phone: null,
    companyName: null,
    createdAt: daysAgo(5),
    ...overrides,
  };
}

describe("scoreLead — the rule document", () => {
  it("scores a bare lead at zero when every weight is zero", () => {
    expect(scoreLead(bareLead(), ZERO, NOW)).toBe(0);
  });

  it("applies the base score", () => {
    expect(scoreLead(bareLead(), { ...ZERO, base: 42 }, NOW)).toBe(42);
  });

  describe("source", () => {
    it("credits the lead's own source and no other", () => {
      const rules: ScoringRules = {
        ...ZERO,
        sourceWeights: { ...ZERO.sourceWeights, WEB_FORM: 30, CSV_IMPORT: 5 },
      };
      expect(scoreLead(bareLead({ source: "WEB_FORM" }), rules, NOW)).toBe(30);
      expect(scoreLead(bareLead({ source: "CSV_IMPORT" }), rules, NOW)).toBe(5);
      expect(scoreLead(bareLead({ source: "EMAIL" }), rules, NOW)).toBe(0);
    });
  });

  describe("contactability", () => {
    it("credits an email only when one is present", () => {
      const rules = { ...ZERO, hasEmail: 15 };
      expect(scoreLead(bareLead({ email: "a@b.test" }), rules, NOW)).toBe(15);
      expect(scoreLead(bareLead({ email: null }), rules, NOW)).toBe(0);
    });

    it("credits a phone only when one is present", () => {
      const rules = { ...ZERO, hasPhone: 15 };
      expect(scoreLead(bareLead({ phone: "+15551234567" }), rules, NOW)).toBe(15);
      expect(scoreLead(bareLead({ phone: null }), rules, NOW)).toBe(0);
    });

    it("credits a company name only when one is present", () => {
      const rules = { ...ZERO, hasCompanyName: 10 };
      expect(scoreLead(bareLead({ companyName: "Acme" }), rules, NOW)).toBe(10);
      expect(scoreLead(bareLead({ companyName: null }), rules, NOW)).toBe(0);
    });

    it("does not count whitespace as a contact detail", () => {
      const rules = { ...ZERO, hasEmail: 15, hasPhone: 15, hasCompanyName: 10 };
      const blank = bareLead({ email: "   ", phone: "", companyName: "\t" });
      expect(scoreLead(blank, rules, NOW)).toBe(0);
    });
  });

  describe("status", () => {
    it("credits the lead's own status and no other", () => {
      const rules: ScoringRules = {
        ...ZERO,
        statusWeights: { ...ZERO.statusWeights, QUALIFIED: 25, JUNK: -100 },
      };
      expect(scoreLead(bareLead({ status: "QUALIFIED" }), rules, NOW)).toBe(25);
      expect(scoreLead(bareLead({ status: "NEW" }), rules, NOW)).toBe(0);
      // Floors rather than going negative.
      expect(scoreLead(bareLead({ status: "JUNK" }), rules, NOW)).toBe(0);
    });
  });

  describe("recency", () => {
    const rules: ScoringRules = {
      ...ZERO,
      base: 50,
      recency: { freshHours: 24, freshPoints: 15, staleDays: 30, stalePenalty: -20 },
    };

    it("boosts a lead inside the fresh window", () => {
      expect(scoreLead(bareLead({ createdAt: hoursAgo(1) }), rules, NOW)).toBe(65);
      expect(scoreLead(bareLead({ createdAt: hoursAgo(24) }), rules, NOW)).toBe(65);
    });

    it("leaves a lead between the thresholds alone", () => {
      expect(scoreLead(bareLead({ createdAt: hoursAgo(25) }), rules, NOW)).toBe(50);
      expect(scoreLead(bareLead({ createdAt: daysAgo(29) }), rules, NOW)).toBe(50);
    });

    it("penalises a lead past the stale threshold", () => {
      expect(scoreLead(bareLead({ createdAt: daysAgo(30) }), rules, NOW)).toBe(30);
      expect(scoreLead(bareLead({ createdAt: daysAgo(365) }), rules, NOW)).toBe(30);
    });

    it("treats a future-dated lead as fresh rather than erroring", () => {
      expect(scoreLead(bareLead({ createdAt: hoursAgo(-3) }), rules, NOW)).toBe(65);
    });
  });

  describe("the 0-100 clamp", () => {
    it("clamps a total above 100", () => {
      const rules: ScoringRules = {
        ...ZERO,
        base: 100,
        hasEmail: 50,
        hasPhone: 50,
        recency: { freshHours: 24, freshPoints: 100, staleDays: 30, stalePenalty: 0 },
      };
      const lead = bareLead({ email: "a@b.test", phone: "+1555", createdAt: hoursAgo(1) });
      expect(scoreLead(lead, rules, NOW)).toBe(100);
    });

    it("clamps a total below 0", () => {
      const rules: ScoringRules = {
        ...ZERO,
        base: 10,
        statusWeights: { ...ZERO.statusWeights, JUNK: -100 },
        recency: { freshHours: 24, freshPoints: 0, staleDays: 30, stalePenalty: -20 },
      };
      const lead = bareLead({ status: "JUNK", createdAt: daysAgo(90) });
      expect(scoreLead(lead, rules, NOW)).toBe(0);
    });
  });

  describe("with the shipped defaults", () => {
    /** Everything the rules reward, all at once. */
    const best = bareLead({
      source: "FACEBOOK_LEAD_ADS",
      status: "QUALIFIED",
      email: "buyer@acme.test",
      phone: "+15551234567",
      companyName: "Acme",
      createdAt: hoursAgo(2),
    });

    /** Nothing the rules reward: a stale, contact-less spreadsheet row. */
    const worst = bareLead({
      source: "CSV_IMPORT",
      status: "JUNK",
      createdAt: daysAgo(120),
    });

    it("scores a perfect lead at the top of the scale", () => {
      // 10 base + 20 source + 15 email + 15 phone + 10 company + 25 status
      // + 15 fresh = 110, clamped. The clamp is exercised by the DEFAULTS,
      // not only by contrived weights.
      expect(scoreLead(best, DEFAULT_SCORING_RULES, NOW)).toBe(100);
    });

    it("scores a worthless lead at the bottom of the scale", () => {
      expect(scoreLead(worst, DEFAULT_SCORING_RULES, NOW)).toBe(0);
    });

    it("puts an ordinary lead somewhere in between", () => {
      const ordinary = bareLead({
        source: "EMAIL",
        status: "NEW",
        email: "someone@test.local",
        createdAt: daysAgo(5),
      });
      // 10 base + 12 source + 15 email + 10 status = 47.
      const score = scoreLead(ordinary, DEFAULT_SCORING_RULES, NOW);
      expect(score).toBe(47);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(100);
    });

    it("uses the defaults when no rules are passed at all", () => {
      expect(scoreLead(best, undefined, NOW)).toBe(scoreLead(best, DEFAULT_SCORING_RULES, NOW));
    });
  });
});

describe("parseScoringRules", () => {
  it("falls back to the defaults when the org has stored nothing", () => {
    expect(parseScoringRules(null)).toEqual(DEFAULT_SCORING_RULES);
    expect(parseScoringRules(undefined)).toEqual(DEFAULT_SCORING_RULES);
  });

  it("falls back to the defaults rather than throwing on a stored document it cannot read", () => {
    expect(parseScoringRules({ base: "not a number" })).toEqual(DEFAULT_SCORING_RULES);
    expect(parseScoringRules("nonsense")).toEqual(DEFAULT_SCORING_RULES);
  });

  it("fills the gaps in a partial document from the defaults", () => {
    const rules = parseScoringRules({ hasEmail: 40, sourceWeights: { WEB_FORM: 1 } });

    expect(rules.hasEmail).toBe(40);
    expect(rules.sourceWeights.WEB_FORM).toBe(1);
    // Untouched fields keep their shipped values.
    expect(rules.base).toBe(DEFAULT_SCORING_RULES.base);
    expect(rules.hasPhone).toBe(DEFAULT_SCORING_RULES.hasPhone);
    expect(rules.sourceWeights.EMAIL).toBe(DEFAULT_SCORING_RULES.sourceWeights.EMAIL);
    expect(rules.statusWeights).toEqual(DEFAULT_SCORING_RULES.statusWeights);
    expect(rules.recency).toEqual(DEFAULT_SCORING_RULES.recency);
  });
});

// ─────────────────────────── persistence ───────────────────────────

async function seedLead(
  organizationId: string,
  key: string,
  data: Partial<ScorableLead> & { ownerId?: string } = {},
) {
  const lead = await db.lead.create({
    data: {
      organizationId,
      dedupeKey: key,
      source: data.source ?? "WEB_FORM",
      status: data.status ?? "NEW",
      email: data.email ?? null,
      phone: data.phone ?? null,
      companyName: data.companyName ?? null,
      ownerId: data.ownerId,
      ...(data.createdAt ? { createdAt: data.createdAt } : {}),
    },
    select: { id: true },
  });
  return lead.id;
}

describe("scoring persistence", () => {
  let a: Awaited<ReturnType<typeof makeOrg>>;
  let b: Awaited<ReturnType<typeof makeOrg>>;
  let bLeadId: string;

  beforeAll(async () => {
    a = await makeOrg();
    b = await makeOrg();
    bLeadId = await seedLead(b.org.id, "b-lead-1", { email: "bee@org-b.test" });
  });

  afterAll(async () => {
    await dropOrg(a.org.id);
    await dropOrg(b.org.id);
  });

  describe("getScoringRules", () => {
    it("returns the defaults for an organization that has stored none", async () => {
      await expect(getScoringRules(a.ctx)).resolves.toEqual(DEFAULT_SCORING_RULES);
    });

    it("refuses a non-ADMIN", async () => {
      const manager = { ...a.ctx, role: "MANAGER" as const };
      await expect(getScoringRules(manager)).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("updateScoringRules", () => {
    it("refuses a MANAGER", async () => {
      const manager = { ...a.ctx, role: "MANAGER" as const };
      await expect(updateScoringRules(manager, { hasEmail: 20 })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });

    it("refuses a REP", async () => {
      const rep = { ...a.ctx, role: "REP" as const };
      await expect(updateScoringRules(rep, { hasEmail: 20 })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });

    it("rejects a document with an out-of-range weight", async () => {
      const result = await updateScoringRules(a.ctx, { hasEmail: 5000 });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.fieldErrors?.hasEmail).toBeTruthy();
    });

    it("persists a valid document and reads it back", async () => {
      const result = await updateScoringRules(a.ctx, { hasEmail: 20 });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error);
      expect(result.data.hasEmail).toBe(20);

      const reloaded = await getScoringRules(a.ctx);
      expect(reloaded.hasEmail).toBe(20);
    });

    it("does not leak one group's rules into another", async () => {
      await updateScoringRules(a.ctx, { hasEmail: 31 });
      const other = await getScoringRules(b.ctx);
      expect(other.hasEmail).not.toBe(31);
    });
  });

  describe("rescoreLead", () => {
    it("writes score and scoredAt", async () => {
      const leadId = await seedLead(a.org.id, "a-rescore-1", {
        source: "FACEBOOK_LEAD_ADS",
        status: "QUALIFIED",
        email: "hot@org-a.test",
        phone: "+15551234567",
        companyName: "Acme",
      });

      const before = await db.lead.findUniqueOrThrow({
        where: { id: leadId },
        select: { score: true, scoredAt: true },
      });
      expect(before.score).toBe(0);
      expect(before.scoredAt).toBeNull();

      const result = await rescoreLead(a.ctx, leadId);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error);
      expect(result.data.score).toBe(100);

      const after = await db.lead.findUniqueOrThrow({
        where: { id: leadId },
        select: { score: true, scoredAt: true },
      });
      expect(after.score).toBe(100);
      expect(after.scoredAt).toBeInstanceOf(Date);
    });

    it("scores a thin lead low", async () => {
      const leadId = await seedLead(a.org.id, "a-rescore-2", {
        source: "CSV_IMPORT",
        status: "JUNK",
        createdAt: new Date(Date.now() - 200 * 86_400_000),
      });

      const result = await rescoreLead(a.ctx, leadId);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error);
      expect(result.data.score).toBe(0);
    });

    it("does not rescore another organization's lead", async () => {
      const result = await rescoreLead(a.ctx, bLeadId);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("org A reached org B's lead");
      expect(result.error).toBe("Lead not found");

      // And nothing was written to it.
      const untouched = await db.lead.findUniqueOrThrow({
        where: { id: bLeadId },
        select: { score: true, scoredAt: true },
      });
      expect(untouched.score).toBe(0);
      expect(untouched.scoredAt).toBeNull();
    });

    it("does not let a REP rescore a lead they do not own", async () => {
      const leadId = await seedLead(a.org.id, "a-rescore-3", { email: "someone@org-a.test" });
      const rep = { ...a.ctx, role: "REP" as const };

      const result = await rescoreLead(rep, leadId);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("a REP rescored a lead they do not own");
      expect(result.error).toBe("Lead not found");
    });

    it("refuses a READ_ONLY caller", async () => {
      const readOnly = { ...a.ctx, role: "READ_ONLY" as const };
      await expect(rescoreLead(readOnly, bLeadId)).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("rescoreOrganization", () => {
    it("rescores the tenant's leads and leaves other tenants alone", async () => {
      const result = await rescoreOrganization(a.org.id);

      const scored = await db.lead.findMany({
        where: { organizationId: a.org.id },
        select: { id: true, scoredAt: true },
      });
      expect(scored.length).toBeGreaterThan(0);
      expect(result.scanned).toBe(scored.length);
      expect(scored.every((lead) => lead.scoredAt !== null)).toBe(true);

      const other = await db.lead.findUniqueOrThrow({
        where: { id: bLeadId },
        select: { score: true, scoredAt: true },
      });
      expect(other.score).toBe(0);
      expect(other.scoredAt).toBeNull();
    });

    it("honours the limit", async () => {
      const result = await rescoreOrganization(a.org.id, 1);
      expect(result.scanned).toBe(1);
    });

    it("reports nothing changed on a second pass over settled scores", async () => {
      await rescoreOrganization(a.org.id);
      const second = await rescoreOrganization(a.org.id);
      expect(second.changed).toBe(0);
      // …but every row is still stamped, so the cursor keeps moving.
      expect(second.scanned).toBeGreaterThan(0);
    });
  });
});
