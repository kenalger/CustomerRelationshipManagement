import { z } from "zod";

import { db } from "@/lib/db";
import type { LeadSource, LeadStatus } from "@/generated/prisma/enums";
import { type Ctx, requireRole, requireWrite, visibleTo } from "@/server/authz";
import { writeAudit } from "@/server/services/audit";
import { type Result, err, ok } from "@/server/result";

/**
 * Lead scoring.
 *
 * A priority number, 0-100, so the queue can be sorted in SQL rather than in
 * the browser. It is deliberately NOT a rules engine: a small fixed set of
 * weights over the columns a `Lead` actually has, so the whole document fits
 * on one settings screen and the arithmetic is auditable by the admin who
 * changed it.
 *
 * The scoring itself (`scoreLead`) is pure — no database, no clock unless you
 * pass one — which is what makes the weights testable against fixed inputs.
 * Everything below it is thin persistence around that one function.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * BLOCKED — per-organization rules cannot be persisted yet.
 *
 * `Organization.scoringRules` does not exist. It is absent from
 * `prisma/schema.prisma`, from every migration (including
 * `20260826110505_tags_and_lead_scoring`, which added only `Lead.score` and
 * `Lead.scoredAt`), and from the live database. Adding it is a schema change
 * plus a migration, which is outside this change's remit.
 *
 * Until it lands, `loadScoringRules` returns `DEFAULT_SCORING_RULES` for every
 * tenant and `updateScoringRules` validates but refuses to save. Both spots
 * The rules are stored on `Organization.scoringRules`; null means the tenant
 * has never configured them and the defaults apply.
 * ─────────────────────────────────────────────────────────────────────────
 */

// ─────────────────────────── the rule document ───────────────────────────

/**
 * Every weight is bounded. A single rule worth more than the whole scale is
 * indistinguishable from a bug, and negative weights past -100 cannot make a
 * lead any more worthless than the floor already does.
 */
const points = z.coerce.number().int().min(-100).max(100);

/**
 * Where the lead came from.
 *
 * A hand-raiser (a web form, a Meta lead ad) is worth more than a row someone
 * pasted in from a spreadsheet, which is why CSV_IMPORT sits at the bottom.
 */
const DEFAULT_SOURCE_WEIGHTS: Record<LeadSource, number> = {
  FACEBOOK_LEAD_ADS: 20,
  WEB_FORM: 20,
  FACEBOOK_MESSENGER: 12,
  EMAIL: 12,
  MANUAL: 10,
  FACEBOOK_COMMENT: 8,
  CSV_IMPORT: 5,
};

/**
 * How far along the lead is.
 *
 * JUNK is a large negative rather than zero on purpose: it has to outweigh
 * every positive rule so a well-formed lead someone marked as junk still
 * clamps to 0 and drops off the queue.
 */
const DEFAULT_STATUS_WEIGHTS: Record<LeadStatus, number> = {
  NEW: 10,
  WORKING: 15,
  QUALIFIED: 25,
  CONVERTED: 0,
  JUNK: -100,
};

/**
 * Recency, as two thresholds rather than a curve.
 *
 * Speed-to-lead is the whole reason this product exists, so an hours-old lead
 * gets a boost; a lead nobody touched in a month is not going to convert and
 * should stop crowding out today's arrivals. Anything between the two is
 * scored on its merits alone.
 */
const DEFAULT_RECENCY = {
  freshHours: 24,
  freshPoints: 15,
  staleDays: 30,
  stalePenalty: -20,
};

const sourceWeightsSchema = z
  .object({
    FACEBOOK_LEAD_ADS: points.default(DEFAULT_SOURCE_WEIGHTS.FACEBOOK_LEAD_ADS),
    FACEBOOK_MESSENGER: points.default(DEFAULT_SOURCE_WEIGHTS.FACEBOOK_MESSENGER),
    FACEBOOK_COMMENT: points.default(DEFAULT_SOURCE_WEIGHTS.FACEBOOK_COMMENT),
    EMAIL: points.default(DEFAULT_SOURCE_WEIGHTS.EMAIL),
    CSV_IMPORT: points.default(DEFAULT_SOURCE_WEIGHTS.CSV_IMPORT),
    WEB_FORM: points.default(DEFAULT_SOURCE_WEIGHTS.WEB_FORM),
    MANUAL: points.default(DEFAULT_SOURCE_WEIGHTS.MANUAL),
  })
  .default(DEFAULT_SOURCE_WEIGHTS);

const statusWeightsSchema = z
  .object({
    NEW: points.default(DEFAULT_STATUS_WEIGHTS.NEW),
    WORKING: points.default(DEFAULT_STATUS_WEIGHTS.WORKING),
    QUALIFIED: points.default(DEFAULT_STATUS_WEIGHTS.QUALIFIED),
    CONVERTED: points.default(DEFAULT_STATUS_WEIGHTS.CONVERTED),
    JUNK: points.default(DEFAULT_STATUS_WEIGHTS.JUNK),
  })
  .default(DEFAULT_STATUS_WEIGHTS);

const recencySchema = z
  .object({
    // An hour is the tightest "fresh" window worth expressing; past 30 days
    // (720 hours) it is not a freshness bonus any more.
    freshHours: z.coerce.number().int().min(1).max(720).default(DEFAULT_RECENCY.freshHours),
    freshPoints: points.default(DEFAULT_RECENCY.freshPoints),
    staleDays: z.coerce.number().int().min(1).max(365).default(DEFAULT_RECENCY.staleDays),
    stalePenalty: points.default(DEFAULT_RECENCY.stalePenalty),
  })
  .default(DEFAULT_RECENCY);

/**
 * The whole document. Every field has a default, so a partial document — an
 * admin who only ever changed one weight — parses into a complete one.
 */
export const scoringRulesSchema = z.object({
  /** Everyone starts here, so the scale is not anchored at zero. */
  base: points.default(10),

  sourceWeights: sourceWeightsSchema,

  // Contactability. A lead with no email and no phone cannot be worked at all,
  // so these are the heaviest single rules after the source.
  hasEmail: points.default(15),
  hasPhone: points.default(15),
  hasCompanyName: points.default(10),

  statusWeights: statusWeightsSchema,
  recency: recencySchema,
});

export type ScoringRules = z.infer<typeof scoringRulesSchema>;

/** The document every organization scores on until it saves its own. */
export const DEFAULT_SCORING_RULES: ScoringRules = scoringRulesSchema.parse({});

/**
 * Turns whatever is stored on the organization into a usable document.
 *
 * Null (never configured) and invalid (configured under an older shape) both
 * fall back to the defaults rather than throwing. The cron sweeps every tenant
 * in one pass; one organization's stale JSON must not stop the other 99.
 */
export function parseScoringRules(raw: unknown): ScoringRules {
  if (raw === null || raw === undefined) return DEFAULT_SCORING_RULES;

  const parsed = scoringRulesSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_SCORING_RULES;
}

// ─────────────────────────── the pure function ───────────────────────────

/**
 * The subset of a `Lead` that scoring reads. Structural rather than the Prisma
 * model, so a test can score a literal and a caller can `select` four columns.
 */
export type ScorableLead = {
  source: LeadSource;
  status: LeadStatus;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  createdAt: Date;
};

/** Whitespace is not a phone number. */
function present(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Scores one lead. Pure: same inputs, same number, no database, no ambient
 * clock unless you let it default.
 *
 * Rules are additive and the total is clamped to 0-100 — the clamp is load
 * bearing, not a safety net, because the defaults deliberately sum past 100
 * for a perfect lead and past -100 for a junked one.
 */
export function scoreLead(
  lead: ScorableLead,
  rules: ScoringRules = DEFAULT_SCORING_RULES,
  now: Date = new Date(),
): number {
  let total = rules.base;

  total += rules.sourceWeights[lead.source] ?? 0;

  if (present(lead.email)) total += rules.hasEmail;
  if (present(lead.phone)) total += rules.hasPhone;
  if (present(lead.companyName)) total += rules.hasCompanyName;

  total += rules.statusWeights[lead.status] ?? 0;

  // A lead is fresh, stale, or neither. A clock skewed into the future counts
  // as fresh rather than as an error.
  const ageMs = now.getTime() - lead.createdAt.getTime();
  if (ageMs <= rules.recency.freshHours * HOUR_MS) {
    total += rules.recency.freshPoints;
  } else if (ageMs >= rules.recency.staleDays * DAY_MS) {
    total += rules.recency.stalePenalty;
  }

  return Math.max(0, Math.min(100, Math.round(total)));
}

// ─────────────────────────── stored rules ───────────────────────────

/**
 * Reads an organization's rules. No `Ctx` — the cron needs this too, so the
 * caller is responsible for having proven tenancy before calling it.
 */
async function loadScoringRules(organizationId: string): Promise<ScoringRules> {
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, scoringRules: true },
  });
  if (!organization) return DEFAULT_SCORING_RULES;

  // Null means "never configured", which parses to the defaults.
  return parseScoringRules(organization.scoringRules);
}

/**
 * The organization's rules, for the settings screen.
 *
 * ADMIN, because seeing the weights is seeing how every rep's queue is
 * ordered. Returns the defaults when nothing has been saved.
 */
export async function getScoringRules(ctx: Ctx): Promise<ScoringRules> {
  requireRole(ctx, "ADMIN");
  return loadScoringRules(ctx.organizationId);
}

/**
 * Replaces the organization's rules.
 *
 * A partial document is merged onto the defaults by the schema, so a form that
 * only posts the weights it renders cannot silently blank the rest.
 */
export async function updateScoringRules(ctx: Ctx, raw: unknown): Promise<Result<ScoringRules>> {
  requireRole(ctx, "ADMIN");

  const parsed = scoringRulesSchema.safeParse(raw);
  if (!parsed.success) {
    return err("Check the highlighted fields", parsed.error.flatten().fieldErrors);
  }

  const before = await db.organization.findUnique({
    where: { id: ctx.organizationId },
    select: { scoringRules: true },
  });

  await db.$transaction(async (tx) => {
    await tx.organization.update({
      where: { id: ctx.organizationId },
      data: { scoringRules: parsed.data as never },
    });
    // Changing the weights reorders every queue in the workspace, so it is an
    // audited change rather than a silent preference.
    await writeAudit(tx, ctx, {
      entity: "Organization",
      entityId: ctx.organizationId,
      action: "update_scoring_rules",
      before: before?.scoringRules ?? null,
      after: parsed.data,
    });
  });

  return ok(parsed.data);
}

// ─────────────────────────── recompute + persist ───────────────────────────

/** The columns `scoreLead` reads, plus what the caller needs back. */
const SCORABLE_SELECT = {
  id: true,
  source: true,
  status: true,
  email: true,
  phone: true,
  companyName: true,
  createdAt: true,
  score: true,
} as const;

/**
 * Recomputes and stores one lead's score.
 *
 * Tenant-scoped and visibility-scoped: a REP can only rescore a lead they own,
 * for the same reason they can only read one.
 */
export async function rescoreLead(
  ctx: Ctx,
  leadId: string,
): Promise<Result<{ id: string; score: number }>> {
  requireWrite(ctx);

  const lead = await db.lead.findFirst({
    where: {
      id: leadId,
      organizationId: ctx.organizationId,
      deletedAt: null,
      ...visibleTo(ctx),
    },
    select: SCORABLE_SELECT,
  });
  if (!lead) return err("Lead not found");

  const rules = await loadScoringRules(ctx.organizationId);
  const score = scoreLead(lead, rules);

  // `updateMany` rather than `update`, so `organizationId` stays on the WHERE
  // of the write itself and not only on the read that found the row.
  await db.lead.updateMany({
    where: { id: leadId, organizationId: ctx.organizationId },
    data: { score, scoredAt: new Date() },
  });

  return ok({ id: leadId, score });
}

/**
 * Bulk recompute for the cron.
 *
 * No `Ctx` on purpose — this runs unattended, like the SLA and ingestion
 * sweepers, so the tenant is passed explicitly rather than derived from a
 * session that does not exist.
 *
 * Oldest scores first (never-scored leads lead the queue), so successive runs
 * advance through the tenant instead of rescoring the same page forever. Every
 * lead selected gets `scoredAt` written even when its score is unchanged —
 * that timestamp IS the cursor.
 *
 * SEQUENTIAL, not `Promise.all`. Concurrent interactive transactions against
 * one Postgres connection corrupt the wire protocol here — it surfaces as
 * `08P01: bind message supplies N parameters, but prepared statement ""
 * requires 0`, which reads like a schema bug and is not. See
 * plan/06-ops/local-development.md.
 */
export async function rescoreOrganization(
  organizationId: string,
  limit = 500,
): Promise<{ scanned: number; changed: number }> {
  const rules = await loadScoringRules(organizationId);

  const leads = await db.lead.findMany({
    where: { organizationId, deletedAt: null },
    orderBy: [{ scoredAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    take: limit,
    select: SCORABLE_SELECT,
  });

  const now = new Date();
  let changed = 0;

  for (const lead of leads) {
    const score = scoreLead(lead, rules, now);
    if (score !== lead.score) changed++;

    await db.lead.updateMany({
      where: { id: lead.id, organizationId },
      data: { score, scoredAt: now },
    });
  }

  return { scanned: leads.length, changed };
}
