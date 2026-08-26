import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import { AutomationAction, AutomationTrigger, LeadStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { leadFilterSchema } from "@/lib/validation/segments";
import { type Ctx, requireRole } from "@/server/authz";
import { type Result, err, ok } from "@/server/result";
import { writeAudit } from "@/server/services/audit";
import { notify } from "@/server/services/notifications";
import { segmentWhere } from "@/server/services/segments";
import { applyTag } from "@/server/services/tags";
import { createTask } from "@/server/services/tasks";

/**
 * The automation engine — rules, their steps, and the dispatcher that runs
 * them when something happens.
 *
 * Schemas live in this file rather than `lib/validation/` because a step's
 * config is only ever read by the engine: unlike a segment filter, which is a
 * wire format shared by three editors, there is no boundary here worth naming.
 *
 * Four decisions carry the whole module, and each of them is structural:
 *
 * 1. **Conditions are the segment vocabulary, evaluated by re-querying.** A
 *    rule's condition is the same question a segment asks, aimed at one
 *    record, so it is answered by building `segmentWhere` and adding
 *    `id: recordId`. There is deliberately no in-memory evaluator — a second
 *    implementation of "no activity in 21 days" that disagreed with the first
 *    would be worse than no feature at all.
 * 2. **A run acts as the system, not as a user** — see `systemCtx`.
 * 3. **Loop protection is three independent guards**, all mandatory — see the
 *    "loop protection" section.
 * 4. **A run never throws out of `dispatch`.** One tenant's broken rule must
 *    not stop everyone else's, and the service that raised the event (lead
 *    ingestion, a stage move) must not fail because a rule did.
 */

// ─────────────────────────── the event ───────────────────────────

/**
 * The three kinds of record an automation can be about.
 *
 * Not `SegmentEntity`: that enum is LEAD/CONTACT/COMPANY, which is the set of
 * things you can *filter*, while this is the set of things that *emit events*.
 * They overlap on LEAD only, and conflating them would imply a deal filter
 * vocabulary that does not exist.
 */
export type AutomationRecordKind = "LEAD" | "DEAL" | "TASK";

/**
 * One occurrence of something a rule can listen for.
 *
 * `triggerEventId` is the identity of THIS occurrence — an ingestion event id,
 * an audit row id, or a uuid minted at the call site. It is what the unique
 * index keys on, so it must be stable across a retry of the same occurrence
 * and different between two genuine occurrences. Getting that backwards is the
 * difference between "runs once" and "runs never" / "runs forever".
 *
 * `now` is explicit so tests can pin the clock — the daily cap and
 * `dueInDays` both depend on it.
 */
export type AutomationEvent = {
  organizationId: string;
  trigger: AutomationTrigger;
  recordKind: AutomationRecordKind;
  recordId: string;
  triggerEventId: string;
  now?: Date;
};

export type DispatchTotals = {
  /** Enabled automations listening to this trigger in this organization. */
  matched: number;
  /** Ran every step to completion. */
  ran: number;
  /** Conditions did not match, the event had already run, or the cap was hit. */
  skipped: number;
  /** A step threw. Recorded on the run, never rethrown. */
  failed: number;
};

/**
 * Which record kind each trigger is about.
 *
 * `SCHEDULE_DAILY` is a lead sweep. That is a real narrowing and it is
 * deliberate: conditions are the *lead* filter vocabulary, so a scheduled rule
 * over deals could not express a condition anyway, and a trigger whose record
 * kind depended on the caller would make save-time validation of steps
 * impossible.
 */
export const TRIGGER_RECORD_KIND: Record<AutomationTrigger, AutomationRecordKind> = {
  LEAD_CREATED: "LEAD",
  LEAD_STATUS_CHANGED: "LEAD",
  DEAL_STAGE_CHANGED: "DEAL",
  TASK_COMPLETED: "TASK",
  SCHEDULE_DAILY: "LEAD",
};

// ─────────────────────────── the system context ───────────────────────────

/**
 * The actor id a run carries. Deliberately NOT a cuid.
 *
 * It never reaches a foreign key: the only things a run persists are
 * `AutomationRun` rows (which have no actor column), tasks and taggings
 * (whose writers do not store `ctx.userId`), and notifications addressed to a
 * real member. If a future action does try to write an `AuditLog`, whose
 * `actorId` IS a real FK, this value fails loudly on insert rather than
 * silently attaching an automation's writes to whichever user happens to hold
 * that id.
 */
const SYSTEM_ACTOR_ID = "system:automation";

/**
 * The context a run acts under.
 *
 * **This is the single most important line in the module.** `segmentWhere`
 * spreads `visibleTo(ctx)`, which narrows every query to `ownerId` for a REP.
 * An automation has no user behind it — nobody is "running" a rule that fires
 * at 3am on a webhook — so it is given a role that sees every record in the
 * organization. A rule that quietly only fired for records owned by whoever
 * happened to create it would be a silent, awful bug: the rule would look
 * correct, the run log would look correct, and two thirds of the pipeline
 * would never be touched.
 *
 * ADMIN rather than OWNER because that is the lowest role that both sees
 * everything (`seesAllRecords`) and may write (`requireWrite`); nothing here
 * needs owner-only powers. The tenant scope is NOT relaxed — `organizationId`
 * is still mandatory on every query the ctx reaches.
 */
function systemCtx(organizationId: string): Ctx {
  return { userId: SYSTEM_ACTOR_ID, organizationId, role: "ADMIN" };
}

// ─────────────────────────── loop protection ───────────────────────────

/**
 * Guard (b): the "we are inside a run" marker.
 *
 * `AsyncLocalStorage` rather than a module-level flag, because two dispatches
 * can be in flight at once and a shared boolean would have one run suppress
 * the other's unrelated events. The store follows the async call tree of one
 * run and nothing else.
 *
 * Everything a run does happens inside `runContext.run(...)`, so any event
 * raised by an action — directly, or by a service the action calls — reaches
 * `dispatch` with the marker set and is dropped. "When status changes → set
 * status" is the first rule a new user writes, and without this it is an
 * infinite loop that neither the unique index nor the daily cap can stop,
 * because every turn of it mints a fresh `triggerEventId`.
 */
const runContext = new AsyncLocalStorage<{ automationId: string }>();

/**
 * Whether the caller is executing inside an automation run.
 *
 * Exported so a service can cheaply skip work it only does for human-driven
 * changes. `dispatch` consults it itself, so a caller does not have to.
 */
export function insideAutomationRun(): boolean {
  return runContext.getStore() !== undefined;
}

/** Guard (c): the prefix every capped run is recorded under. */
const LIMIT_ERROR_PREFIX = "Daily run limit";

/**
 * The organization's calendar day, as the server sees it.
 *
 * Same known limitation as `bucketFor` in `services/tasks.ts`: a tenant in a
 * different timezone to the server rolls over at the wrong local hour. It is
 * recorded here rather than fixed here because the fix is a per-organization
 * timezone column, and a cap that resets an hour early is a far smaller
 * problem than a cap that does not exist.
 */
function startOfDay(now: Date): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start;
}

/** A lost race on a unique index is an outcome here, not a 500. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ─────────────────────────── validation ───────────────────────────

const recordId = z.string().cuid();

export const automationNameSchema = z
  .string()
  .trim()
  .min(1, "Give the automation a name")
  .max(80, "Automation names are 80 characters or fewer");

/**
 * The cap is bounded on both ends.
 *
 * A rule capped at 0 is just a disabled rule written confusingly, and an
 * uncapped one is the runaway this field exists to prevent — so there is no
 * way to express either.
 */
const dailyRunLimitSchema = z.number().int().min(1).max(50_000);

export const automationCreateSchema = z
  .object({
    name: automationNameSchema,
    description: z.string().trim().max(500).nullish(),
    trigger: z.enum(AutomationTrigger),
    // Checked against the segment vocabulary by `parseConditions`, which needs
    // the trigger to know which record kind — and therefore which schema — is
    // in play. `unknown` here, never `any`: nothing reads it untyped.
    conditions: z.unknown().optional(),
    dailyRunLimit: dailyRunLimitSchema.optional(),
  })
  .strict();

/**
 * The update payload — a patch.
 *
 * `trigger` is deliberately not updatable. Both halves of an automation are
 * validated against the trigger's record kind: the conditions are a lead
 * filter, and the steps are the actions that record kind supports. Changing
 * the trigger would leave stored steps describing a record they can no longer
 * be applied to, and a stored condition document aimed at the wrong table.
 * Deleting and recreating is the honest way to do that.
 *
 * `conditions: null` clears them, which is why this cannot be a plain
 * `.optional()` — see the `Prisma.DbNull` note in `updateAutomation`.
 */
export const automationUpdateSchema = z
  .object({
    name: automationNameSchema.optional(),
    description: z.string().trim().max(500).nullish(),
    conditions: z.unknown().optional(),
    dailyRunLimit: dailyRunLimitSchema.optional(),
  })
  .strict();

/**
 * The fields an automation may write, per record kind. **This list is the
 * whole security boundary of `SET_FIELD`.**
 *
 * Without it, a saved config is an arbitrary write primitive: `{ field:
 * "dedupeKey" }` would break deduplication for a whole tenant,
 * `{ field: "organizationId" }` would move a record between tenants, and
 * `{ field: "convertedAt" }` would forge a conversion. The rule for admission
 * is narrow — a field is here only if a human could set it from the record's
 * own UI and nothing else derives from it:
 *
 *   - `Lead.status` and `Lead.score` are working state a rep already edits.
 *   - `Deal.expectedCloseDate` is a forecast date, likewise.
 *   - Ownership is excluded on purpose: `ASSIGN_OWNER` owns that, and it also
 *     checks that the new owner is on the team.
 *   - `Deal.stageId` is excluded because a stage move maintains
 *     `stageEnteredAt`, `closedAt`, `lostReason` and an activity row (see
 *     `moveDealToStage`), and a raw column write would silently skip all four.
 *   - `Lead.source`, `email`, `phone` and `dedupeKey` are provenance and
 *     identity. Nothing derived should be rewritable by a rule.
 *   - TASK has no writable fields at all, so `SET_FIELD` is not offered for
 *     task automations.
 */
const setFieldConfigSchemas: Record<AutomationRecordKind, z.ZodTypeAny | null> = {
  LEAD: z.union([
    z.object({ field: z.literal("status"), value: z.enum(LeadStatus) }).strict(),
    z.object({ field: z.literal("score"), value: z.number().int().min(0).max(100) }).strict(),
  ]),
  DEAL: z
    .object({ field: z.literal("expectedCloseDate"), value: z.coerce.date().nullable() })
    .strict(),
  TASK: null,
};

/**
 * `{ userId }` or `{ strategy: "ROUND_ROBIN" }`, and never both.
 *
 * `.strict()` on each member is what enforces "exactly one" — a config
 * carrying both keys matches neither member and is rejected at save time,
 * rather than quietly taking whichever branch is checked first.
 */
const assignOwnerConfigSchema = z.union([
  z.object({ userId: recordId }).strict(),
  z.object({ strategy: z.literal("ROUND_ROBIN") }).strict(),
]);

const addTagConfigSchema = z.object({ tagId: recordId }).strict();

const createTaskConfigSchema = z
  .object({
    title: z.string().trim().min(1, "What should the task say?").max(200),
    // 0 means "due today". Capped at a year: a task due in 2033 is a task
    // nobody will ever see.
    dueInDays: z.number().int().min(0).max(365).optional(),
    assignTo: recordId.optional(),
  })
  .strict();

const notifyConfigSchema = z
  .object({
    userId: recordId.optional(),
    message: z.string().trim().min(1, "What should the notification say?").max(200),
  })
  .strict();

/**
 * Which actions make sense for which record kind, and the schema for each.
 *
 * `null` means "this action cannot be used by an automation on this kind of
 * record", and it is a save-time rejection rather than a run-time surprise:
 *
 *   - `ADD_TAG` is LEAD-only because `Tagging` carries `contactId`,
 *     `companyId` and `leadId` and has no deal or task column.
 *   - `ASSIGN_OWNER` is LEAD/DEAL-only: a task is *assigned*, not owned, and
 *     silently treating `assigneeId` as an owner would let a rule written for
 *     leads do something subtly different on tasks.
 *   - `CREATE_TASK` and `NOTIFY` work for all three.
 */
function configSchemaFor(
  kind: AutomationRecordKind,
  action: AutomationAction,
): z.ZodTypeAny | null {
  switch (action) {
    case "ASSIGN_OWNER":
      return kind === "TASK" ? null : assignOwnerConfigSchema;
    case "SET_FIELD":
      return setFieldConfigSchemas[kind];
    case "ADD_TAG":
      return kind === "LEAD" ? addTagConfigSchema : null;
    case "CREATE_TASK":
      return createTaskConfigSchema;
    case "NOTIFY":
      return notifyConfigSchema;
  }
}

/**
 * The steps payload — an ordered array, position taken from the index.
 *
 * Position is derived rather than accepted so a payload cannot carry two steps
 * at position 3 (which `@@unique([automationId, position])` would reject with
 * a Prisma error nobody can act on) or a gap at position 1 (which is legal in
 * the database and meaningless to a reader).
 *
 * Capped at 10: this engine has no branching and no delays, so a rule that
 * needs eleven steps is a rule that needs a feature we deliberately did not
 * build, and letting it be expressed as a long chain hides that.
 */
const stepsSchema = z
  .array(
    z
      .object({
        action: z.enum(AutomationAction),
        // Validated per action, per record kind, by `parseSteps`.
        config: z.unknown().optional(),
      })
      .strict(),
  )
  .max(10, "An automation runs at most 10 steps");

type ParsedStep = { position: number; action: AutomationAction; config: Prisma.InputJsonValue };

/**
 * Validates every step's config against BOTH its action and the record kind
 * the automation's trigger is about.
 *
 * A step whose config does not match its action is rejected here, at save
 * time — not discovered at 3am when the rule fires and a run is recorded
 * FAILED against a record nobody was watching.
 */
function parseSteps(
  kind: AutomationRecordKind,
  raw: unknown,
): Result<ParsedStep[]> {
  const parsed = stepsSchema.safeParse(raw);
  if (!parsed.success) {
    // No `fieldErrors` here: the payload is an array, so Zod keys them by
    // index and a form has nothing to attach them to. The first issue's own
    // message is the readable half.
    return err(parsed.error.issues[0]?.message ?? "That is not a list of steps");
  }

  const steps: ParsedStep[] = [];
  for (const [index, step] of parsed.data.entries()) {
    const schema = configSchemaFor(kind, step.action);
    if (!schema) {
      return err(
        `Step ${index + 1}: ${step.action} is not available for ${kind.toLowerCase()} automations`,
      );
    }
    const config = schema.safeParse(step.config ?? {});
    if (!config.success) {
      return err(
        `Step ${index + 1}: ${step.action} settings are not valid`,
        config.error.flatten().fieldErrors,
      );
    }
    steps.push({ position: index + 1, action: step.action, config: config.data as Prisma.InputJsonValue });
  }
  return ok(steps);
}

/**
 * Validates a condition document against the segment vocabulary.
 *
 * Only LEAD automations can carry conditions, because
 * `lib/validation/segments.ts` has a lead, contact and company vocabulary and
 * no deal or task one. The alternative — inventing a deal filter language
 * here — is exactly the second condition language this whole design exists to
 * avoid, so a deal or task rule with conditions is refused with a message that
 * says so rather than being half-supported.
 */
function parseConditions(
  kind: AutomationRecordKind,
  raw: unknown,
): Result<Prisma.InputJsonValue | null> {
  if (raw === undefined || raw === null) return ok(null);

  if (kind !== "LEAD") {
    return err(`Conditions are only available for lead automations, not ${kind.toLowerCase()} ones`);
  }

  const parsed = leadFilterSchema.safeParse(raw);
  if (!parsed.success) {
    return err("Check the highlighted fields", parsed.error.flatten().fieldErrors);
  }
  return ok(parsed.data as Prisma.InputJsonValue);
}

// ─────────────────────────── row access ───────────────────────────

const AUTOMATION_SELECT = {
  id: true,
  name: true,
  description: true,
  enabled: true,
  trigger: true,
  conditions: true,
  dailyRunLimit: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Tenant scope, always. An automation is org property; there is no owner rule. */
function findAutomation(ctx: Ctx, id: string) {
  return db.automation.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: AUTOMATION_SELECT,
  });
}

/**
 * Case-insensitive name lookup within the org.
 *
 * `@@unique([organizationId, name])` is a plain Postgres index, so it happily
 * holds both "Route hot leads" and "route hot leads" — two rows a user reads
 * as one rule. This lookup enforces the rule we actually want; the constraint
 * is only the backstop for an exact-case race.
 */
function findAutomationByName(ctx: Ctx, name: string, excludeId?: string) {
  return db.automation.findFirst({
    where: {
      organizationId: ctx.organizationId,
      name: { equals: name, mode: "insensitive" },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, name: true },
  });
}

// ─────────────────────────── automation lifecycle ───────────────────────────

/**
 * Every automation in the organization, with its step count and whether it has
 * ever run.
 *
 * A read, so it returns rows rather than a `Result`, and it is open to every
 * role including READ_ONLY — an auditor who cannot see which rules are live is
 * an auditor who cannot audit anything.
 */
export async function listAutomations(ctx: Ctx) {
  const rows = await db.automation.findMany({
    where: { organizationId: ctx.organizationId }, // tenant scope — non-negotiable
    // Stable tiebreak on id, so two automations differing only by case cannot
    // swap places between reads.
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { ...AUTOMATION_SELECT, _count: { select: { steps: true, runs: true } } },
  });

  return rows.map(({ _count, ...automation }) => ({
    ...automation,
    stepCount: _count.steps,
    runCount: _count.runs,
  }));
}

export async function getAutomation(ctx: Ctx, id: string) {
  const automation = await db.automation.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: {
      ...AUTOMATION_SELECT,
      steps: {
        orderBy: { position: "asc" },
        select: { id: true, position: true, action: true, config: true },
      },
    },
  });
  // "Not found", not "forbidden": another org's id must be indistinguishable
  // from an id that never existed.
  if (!automation) return err("Automation not found");
  return ok(automation);
}

/**
 * Creates a rule. MANAGER+.
 *
 * Always disabled: `enabled` is not in the create payload at all, because
 * writing a rule and turning it loose on live records are different acts with
 * different blast radii and different roles. A rule that could arrive live
 * would make `setAutomationEnabled`'s ADMIN check decorative.
 */
export async function createAutomation(ctx: Ctx, raw: unknown): Promise<Result<{ id: string }>> {
  requireRole(ctx, "MANAGER");

  const parsed = automationCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return err("Check the highlighted fields", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  const conditions = parseConditions(TRIGGER_RECORD_KIND[input.trigger], input.conditions);
  if (!conditions.ok) return conditions;

  const clash = await findAutomationByName(ctx, input.name);
  if (clash) return err(`An automation called "${clash.name}" already exists`);

  try {
    const created = await db.$transaction(async (tx) => {
      const automation = await tx.automation.create({
        data: {
          organizationId: ctx.organizationId,
          name: input.name,
          description: input.description ?? null,
          trigger: input.trigger,
          enabled: false,
          conditions: conditions.data ?? Prisma.DbNull,
          dailyRunLimit: input.dailyRunLimit,
          // From the session, never the payload.
          createdById: ctx.userId,
        },
        select: { id: true },
      });
      await writeAudit(tx, ctx, {
        entity: "Automation",
        entityId: automation.id,
        action: "create",
        after: input,
      });
      return automation;
    });

    return ok({ id: created.id });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    return err(`An automation called "${input.name}" already exists`);
  }
}

export async function updateAutomation(
  ctx: Ctx,
  id: string,
  raw: unknown,
): Promise<Result<{ id: string }>> {
  requireRole(ctx, "MANAGER");

  // Loaded inside the tenant scope first: this is what turns a cross-tenant
  // edit attempt into 'not found' rather than a silent write.
  const before = await findAutomation(ctx, id);
  if (!before) return err("Automation not found");

  const parsed = automationUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return err("Check the highlighted fields", parsed.error.flatten().fieldErrors);
  }
  const patch = parsed.data;

  // The STORED trigger decides which conditions are legal — the payload does
  // not get a say, or a deal rule could be handed a lead filter.
  const kind = TRIGGER_RECORD_KIND[before.trigger];
  const conditions =
    "conditions" in patch ? parseConditions(kind, patch.conditions) : ok(undefined);
  if (!conditions.ok) return conditions;

  if (patch.name) {
    // Excluding the automation itself, so re-casing your own name is allowed
    // rather than colliding with itself.
    const clash = await findAutomationByName(ctx, patch.name, id);
    if (clash) return err(`An automation called "${clash.name}" already exists`);
  }

  try {
    await db.$transaction(async (tx) => {
      await tx.automation.update({
        where: { id },
        data: {
          // Prisma reads `undefined` as "leave this column alone", which is
          // exactly patch semantics. `conditions` is nullable Json, so
          // clearing it needs `Prisma.DbNull` — a plain `null` would be read
          // as JSON null, which is a *value*, not an absent one.
          name: patch.name,
          description: patch.description === undefined ? undefined : patch.description,
          dailyRunLimit: patch.dailyRunLimit,
          conditions:
            conditions.data === undefined
              ? undefined
              : (conditions.data ?? Prisma.DbNull),
        },
      });
      await writeAudit(tx, ctx, {
        entity: "Automation",
        entityId: id,
        action: "update",
        before,
        after: patch,
      });
    });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    return err(`An automation called "${patch.name}" already exists`);
  }

  return ok({ id });
}

/**
 * Turns a rule on or off. **ADMIN+, unlike writing one.**
 *
 * This is the act with the blast radius — a rule nobody enabled has never
 * touched a record — so it is the act with the higher bar. HubSpot splits
 * exactly these two permissions for exactly this reason.
 *
 * Enabling a rule with no steps is refused rather than allowed: it would
 * consume the daily cap writing SUCCEEDED runs that did nothing, and its run
 * log would read as a working rule.
 */
export async function setAutomationEnabled(
  ctx: Ctx,
  id: string,
  enabled: boolean,
): Promise<Result<{ id: string }>> {
  requireRole(ctx, "ADMIN");

  const before = await findAutomation(ctx, id);
  if (!before) return err("Automation not found");

  if (enabled) {
    const steps = await db.automationStep.count({ where: { automationId: id } });
    if (steps === 0) return err("Add at least one step before turning this automation on");
  }

  await db.$transaction(async (tx) => {
    await tx.automation.update({ where: { id }, data: { enabled } });
    await writeAudit(tx, ctx, {
      entity: "Automation",
      entityId: id,
      action: enabled ? "enable" : "disable",
      before: { enabled: before.enabled },
      after: { enabled },
    });
  });

  return ok({ id });
}

/**
 * Deletes a rule outright. ADMIN+, for the same reason as enabling it.
 *
 * Steps and runs cascade. The runs going with it is a real loss — the evidence
 * of what the rule did to which records disappears — which is precisely why
 * this is not a REP action, and why disabling is the normal way to stop a rule.
 */
export async function deleteAutomation(ctx: Ctx, id: string): Promise<Result<{ id: string }>> {
  requireRole(ctx, "ADMIN");

  const existing = await findAutomation(ctx, id);
  if (!existing) return err("Automation not found");

  await db.$transaction(async (tx) => {
    await tx.automation.delete({ where: { id } });
    await writeAudit(tx, ctx, {
      entity: "Automation",
      entityId: id,
      action: "delete",
      before: existing,
    });
  });

  return ok({ id });
}

/**
 * Replaces the whole step list. MANAGER+.
 *
 * Replace rather than patch: steps are positional and run in order, so
 * "insert one at position 2" and "delete position 2" both renumber everything
 * after them. One authoritative array is the only version of this that a user
 * can predict, and it is why `@@unique([automationId, position])` never has to
 * be worked around.
 *
 * One transaction — a rule that half-saved would run its first three steps and
 * silently drop the fourth.
 */
export async function setSteps(
  ctx: Ctx,
  automationId: string,
  raw: unknown,
): Promise<Result<{ count: number }>> {
  requireRole(ctx, "MANAGER");

  const automation = await findAutomation(ctx, automationId);
  if (!automation) return err("Automation not found");

  const steps = parseSteps(TRIGGER_RECORD_KIND[automation.trigger], raw);
  if (!steps.ok) return steps;

  await db.$transaction(async (tx) => {
    await tx.automationStep.deleteMany({ where: { automationId } });
    if (steps.data.length > 0) {
      await tx.automationStep.createMany({
        data: steps.data.map((step) => ({ automationId, ...step })),
      });
    }
    await writeAudit(tx, ctx, {
      entity: "Automation",
      entityId: automationId,
      action: "set_steps",
      after: steps.data,
    });
  });

  return ok({ count: steps.data.length });
}

/**
 * The run log — "why did my rule not fire" is the question this table exists
 * to answer, so a read is open to every role including READ_ONLY.
 */
export async function listRuns(ctx: Ctx, opts?: { automationId?: string; limit?: number }) {
  const requested = opts?.limit;
  const limit =
    typeof requested === "number" && Number.isFinite(requested)
      ? Math.min(Math.max(Math.floor(requested), 1), 500)
      : 100;

  return db.automationRun.findMany({
    where: {
      organizationId: ctx.organizationId, // tenant scope — non-negotiable
      ...(opts?.automationId ? { automationId: opts.automationId } : {}),
    },
    // Newest first with a stable tiebreak, so two reads under a limit return
    // the same page rather than a reshuffled one.
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      id: true,
      automationId: true,
      recordKind: true,
      recordId: true,
      triggerEventId: true,
      status: true,
      error: true,
      log: true,
      startedAt: true,
      finishedAt: true,
      automation: { select: { name: true } },
    },
  });
}

// ─────────────────────────── conditions ───────────────────────────

/**
 * Does this one record match the rule's conditions?
 *
 * Answered by re-querying, never by an in-memory evaluator: build the same
 * `where` a segment would, pin it to this record's id, and count. One query,
 * and it inherits the tenant scope, the soft-delete filter and the
 * injection-safe translation for free — none of which a hand-written
 * evaluator would have, and all of which it would eventually get wrong.
 *
 * The id goes in an `AND` member rather than as a spread sibling, for the same
 * reason `segments.ts` nests the document under `AND`: a member can only ever
 * intersect with the scope, never replace a key in it.
 */
async function recordMatches(
  event: AutomationEvent,
  conditions: Prisma.JsonValue | null,
): Promise<boolean> {
  // A rule with no conditions matches every record the trigger fires for.
  if (conditions === null || conditions === undefined) return true;
  if (typeof conditions === "object" && !Array.isArray(conditions) && Object.keys(conditions).length === 0) {
    return true;
  }

  if (event.recordKind !== "LEAD") {
    // Unreachable through the service — `parseConditions` refuses to save
    // this — so it is a data-integrity failure, recorded as a FAILED run
    // rather than silently treated as "matches".
    throw new Error(`Conditions cannot be evaluated for a ${event.recordKind} record`);
  }

  // Throws on a stored document that no longer parses; the caller turns that
  // into a FAILED run carrying the reason.
  const where = segmentWhere(systemCtx(event.organizationId), "LEAD", conditions);
  const count = await db.lead.count({
    where: { AND: [where as Prisma.LeadWhereInput], id: event.recordId },
  });
  return count > 0;
}

// ─────────────────────────── actions ───────────────────────────

type StepConfig = Record<string, unknown>;

type ActionScope = {
  event: AutomationEvent;
  now: Date;
  ctx: Ctx;
  /** The record's owner (a task's assignee), resolved once per run. */
  ownerId: string | null;
};

/** The owner of the triggering record, or null if it has none. */
async function loadOwnerId(event: AutomationEvent): Promise<string | null> {
  const scope = { id: event.recordId, organizationId: event.organizationId };
  switch (event.recordKind) {
    case "LEAD": {
      const row = await db.lead.findFirst({ where: scope, select: { ownerId: true } });
      return row?.ownerId ?? null;
    }
    case "DEAL": {
      const row = await db.deal.findFirst({ where: scope, select: { ownerId: true } });
      return row?.ownerId ?? null;
    }
    case "TASK": {
      const row = await db.task.findFirst({ where: scope, select: { assigneeId: true } });
      return row?.assigneeId ?? null;
    }
  }
}

/** Refuses a user id from another tenant before it can be written anywhere. */
async function requireTeamMember(organizationId: string, userId: string): Promise<string> {
  const member = await db.user.findFirst({
    where: { id: userId, organizationId, deletedAt: null },
    select: { id: true },
  });
  if (!member) throw new Error("That person is not on this team");
  return member.id;
}

/**
 * Round-robin: fewest open records wins, lowest id breaks the tie.
 *
 * Deterministic on purpose — "random" would be untestable and would make two
 * identical runs of a rule unreproducible, which is the opposite of what a run
 * log is for. "Open" means the records that represent outstanding work:
 * NEW/WORKING leads, and deals that have not closed.
 *
 * DUPLICATED FROM `pickOwnerRoundRobin` in `services/leads.ts`, which is
 * module-private and transaction-scoped. The two must not be allowed to drift;
 * the right fix is to export one of them, which is a change to a file this
 * module does not own.
 */
async function pickRoundRobinOwner(
  organizationId: string,
  kind: AutomationRecordKind,
): Promise<string> {
  // Everyone who can hold a record. READ_ONLY is excluded: it is an oversight
  // role, and handing an auditor a lead to work is not an assignment.
  const where: Prisma.UserWhereInput = {
    organizationId,
    deletedAt: null,
    role: { in: ["OWNER", "ADMIN", "MANAGER", "REP"] },
  };

  // Two queries rather than one with a conditional `select`, because the two
  // `_count` shapes are different types and merging them costs more in casts
  // than it saves in lines.
  const candidates: { id: string; load: number }[] =
    kind === "DEAL"
      ? (
          await db.user.findMany({
            where,
            select: {
              id: true,
              _count: { select: { ownedDeals: { where: { closedAt: null, deletedAt: null } } } },
            },
          })
        ).map((user) => ({ id: user.id, load: user._count.ownedDeals }))
      : (
          await db.user.findMany({
            where,
            select: {
              id: true,
              _count: {
                select: {
                  ownedLeads: { where: { status: { in: ["NEW", "WORKING"] }, deletedAt: null } },
                },
              },
            },
          })
        ).map((user) => ({ id: user.id, load: user._count.ownedLeads }));

  if (candidates.length === 0) throw new Error("Nobody on this team can be given records");

  candidates.sort((a, b) => a.load - b.load || a.id.localeCompare(b.id));
  return candidates[0].id;
}

async function runAssignOwner(scope: ActionScope, config: StepConfig): Promise<string> {
  const { event } = scope;
  const userId =
    typeof config.userId === "string"
      ? await requireTeamMember(event.organizationId, config.userId)
      : await pickRoundRobinOwner(event.organizationId, event.recordKind);

  // `updateMany` keeps the tenant filter in the `where`: a crafted recordId
  // from another org updates nothing rather than being trusted.
  const where = { id: event.recordId, organizationId: event.organizationId, deletedAt: null };
  const updated =
    event.recordKind === "DEAL"
      ? await db.deal.updateMany({ where, data: { ownerId: userId } })
      : await db.lead.updateMany({ where, data: { ownerId: userId } });
  if (updated.count === 0) throw new Error("The record this run was about no longer exists");

  // Deliberately silent: a rule that wants the new owner told adds a NOTIFY
  // step. Notifying here as well would double-notify every rule that has both.
  return `owner → ${userId}`;
}

async function runSetField(scope: ActionScope, config: StepConfig): Promise<string> {
  const { event } = scope;
  const field = String(config.field);
  const where = { id: event.recordId, organizationId: event.organizationId, deletedAt: null };

  if (event.recordKind === "DEAL") {
    const value = config.value === null ? null : new Date(config.value as string);
    const updated = await db.deal.updateMany({ where, data: { expectedCloseDate: value } });
    if (updated.count === 0) throw new Error("The record this run was about no longer exists");
    return `${field} → ${value ? value.toISOString() : "cleared"}`;
  }

  if (field === "score") {
    const updated = await db.lead.updateMany({
      where,
      // `scoredAt` moves with the score for the same reason the column exists:
      // `score` defaults to 0, so a lead nobody has scored is otherwise
      // indistinguishable from one an automation scored as worthless.
      data: { score: config.value as number, scoredAt: scope.now },
    });
    if (updated.count === 0) throw new Error("The record this run was about no longer exists");
    return `score → ${config.value}`;
  }

  const status = config.value as (typeof LeadStatus)[keyof typeof LeadStatus];
  const before = await db.lead.findFirst({ where, select: { status: true } });
  if (!before) throw new Error("The record this run was about no longer exists");
  if (before.status === status) return `status already ${status}`;

  await db.lead.updateMany({ where, data: { status } });

  /*
   * Raise the follow-on event, exactly as `setLeadStatus` would.
   *
   * This is the loop that guard (b) exists for, and it is deliberately real
   * rather than hypothetical: a fresh `triggerEventId` means neither the
   * unique index nor the daily cap could stop it. We are inside
   * `runContext.run(...)`, so `dispatch` drops it and returns zeros. Remove
   * the marker and "when status changes → set status" spins forever.
   */
  await dispatch({
    organizationId: event.organizationId,
    trigger: "LEAD_STATUS_CHANGED",
    recordKind: "LEAD",
    recordId: event.recordId,
    triggerEventId: randomUUID(),
    now: scope.now,
  });

  return `status ${before.status} → ${status}`;
}

async function runAddTag(scope: ActionScope, config: StepConfig): Promise<string> {
  // The tagging service's own semantics, unchanged: it checks the tag belongs
  // to this org, and re-adding a tag already on the record is a silent no-op.
  const result = await applyTag(scope.ctx, config.tagId as string, {
    leadId: scope.event.recordId,
  });
  if (!result.ok) throw new Error(result.error);
  return result.data.applied ? "tag added" : "tag already present";
}

async function runCreateTask(scope: ActionScope, config: StepConfig): Promise<string> {
  const { event } = scope;

  const assigneeId =
    typeof config.assignTo === "string"
      ? await requireTeamMember(event.organizationId, config.assignTo)
      : scope.ownerId;
  // Not a silent unassigned task: an unassigned task appears on nobody's list,
  // so a rule that produces one has failed and should say so.
  if (!assigneeId) {
    throw new Error("Nobody to assign the task to — the record has no owner and the step names none");
  }

  const dueInDays = config.dueInDays;
  const dueAt =
    typeof dueInDays === "number" ? new Date(scope.now.getTime() + dueInDays * 86_400_000) : null;

  // Linked to the triggering record so the task opens onto the thing it is
  // about. A TASK-triggered rule has nothing to link to — `Task` has no
  // self-reference — so the new task stands alone.
  const link =
    event.recordKind === "LEAD"
      ? { leadId: event.recordId }
      : event.recordKind === "DEAL"
        ? { dealId: event.recordId }
        : {};

  const result = await createTask(scope.ctx, {
    title: config.title,
    dueAt,
    assigneeId,
    ...link,
  });
  if (!result.ok) throw new Error(result.error);
  return `task ${result.data.id} for ${assigneeId}`;
}

const NOTIFY_ENTITY: Record<AutomationRecordKind, string> = {
  LEAD: "Lead",
  DEAL: "Deal",
  TASK: "Task",
};

async function runNotify(scope: ActionScope, config: StepConfig): Promise<string> {
  const { event } = scope;

  const userId =
    typeof config.userId === "string"
      ? await requireTeamMember(event.organizationId, config.userId)
      : scope.ownerId;
  if (!userId) throw new Error("Nobody to notify — the record has no owner and the step names none");

  const id = await notify({
    organizationId: event.organizationId,
    userId,
    // KNOWN GAP: `NotificationType` has no AUTOMATION member, and the enum
    // lives in a schema this module does not own. LEAD_ASSIGNED is the
    // closest existing value; the title and `entity` carry the real meaning.
    type: "LEAD_ASSIGNED",
    title: config.message as string,
    entity: NOTIFY_ENTITY[event.recordKind],
    entityId: event.recordId,
  });

  return id ? `notified ${userId}` : `notification suppressed as duplicate`;
}

function runStep(
  scope: ActionScope,
  action: AutomationAction,
  config: StepConfig,
): Promise<string> {
  switch (action) {
    case "ASSIGN_OWNER":
      return runAssignOwner(scope, config);
    case "SET_FIELD":
      return runSetField(scope, config);
    case "ADD_TAG":
      return runAddTag(scope, config);
    case "CREATE_TASK":
      return runCreateTask(scope, config);
    case "NOTIFY":
      return runNotify(scope, config);
  }
}

// ─────────────────────────── the dispatcher ───────────────────────────

type LogEntry = {
  position: number;
  action: AutomationAction;
  outcome: "ok" | "failed";
  detail: string;
};

type RunnableAutomation = {
  id: string;
  conditions: Prisma.JsonValue | null;
  dailyRunLimit: number;
  steps: { position: number; action: AutomationAction; config: Prisma.JsonValue }[];
};

type RunOutcome = "ran" | "skipped" | "failed";

/** Writes the final status, the log and the finish time in one update. */
function finishRun(
  runId: string,
  status: "SUCCEEDED" | "SKIPPED" | "FAILED",
  error: string | null,
  log: LogEntry[],
  now: Date,
) {
  return db.automationRun.update({
    where: { id: runId },
    data: {
      status,
      // Truncated the same way ingestion truncates: a stack trace in a column
      // a UI renders inline is not an error message.
      error: error ? error.slice(0, 2000) : null,
      log: log as unknown as Prisma.InputJsonValue,
      finishedAt: now,
    },
  });
}

/**
 * Guard (c), recorded: one notice per automation per day, not one per event.
 *
 * The cap exists so a runaway rule stops rather than writing 40,000 rows —
 * writing 40,000 "I was capped" rows instead would miss the point entirely.
 * One row is enough to answer "why did my rule stop at 500 today".
 */
async function recordCapNotice(
  event: AutomationEvent,
  automation: RunnableAutomation,
  now: Date,
  dayStart: Date,
): Promise<void> {
  const existing = await db.automationRun.findFirst({
    where: {
      automationId: automation.id,
      startedAt: { gte: dayStart },
      error: { startsWith: LIMIT_ERROR_PREFIX },
    },
    select: { id: true },
  });
  if (existing) return;

  try {
    await db.automationRun.create({
      data: {
        organizationId: event.organizationId,
        automationId: automation.id,
        recordKind: event.recordKind,
        recordId: event.recordId,
        triggerEventId: event.triggerEventId,
        status: "SKIPPED",
        error: `${LIMIT_ERROR_PREFIX} of ${automation.dailyRunLimit} reached — this automation will resume tomorrow`,
        startedAt: now,
        finishedAt: now,
      },
      select: { id: true },
    });
  } catch (e) {
    // Lost a race with the run that claimed this same event. The cap still
    // held, which is all this row was recording.
    if (!isUniqueViolation(e)) throw e;
  }
}

/**
 * One automation against one event.
 *
 * The order is load-bearing: cap first (cheapest, and the point of the cap is
 * to do *less* work), then claim the unique row, then evaluate conditions,
 * then act. Claiming before evaluating is what makes two concurrent dispatches
 * of the same event run the steps once rather than twice.
 */
async function runAutomation(
  event: AutomationEvent,
  automation: RunnableAutomation,
  now: Date,
): Promise<RunOutcome> {
  // ── guard (c): the daily cap ──
  // Counts every run started today whatever its status: a rule that evaluated
  // 40,000 records and matched none is still a runaway, and the cap is a
  // budget on work done, not on records changed.
  const dayStart = startOfDay(now);
  const todaysRuns = await db.automationRun.count({
    where: { automationId: automation.id, startedAt: { gte: dayStart } },
  });
  if (todaysRuns >= automation.dailyRunLimit) {
    await recordCapNotice(event, automation, now, dayStart);
    return "skipped";
  }

  /*
   * ── guard (a): one run per record per automation per event ──
   *
   * The row IS the claim, so it is created before any work happens and
   * `@@unique([automationId, recordId, triggerEventId])` decides the race.
   * P2002 here means another dispatch of this same occurrence already has it:
   * that is "already ran", not an error, and treating it as one would turn
   * every webhook retry into a red run in the log.
   *
   * It starts as SKIPPED because that is the truthful status of a run that has
   * done nothing yet — a crash between the claim and `finishRun` leaves a row
   * that says "started, changed nothing", which is exactly what happened.
   */
  let runId: string;
  try {
    const run = await db.automationRun.create({
      data: {
        organizationId: event.organizationId,
        automationId: automation.id,
        recordKind: event.recordKind,
        recordId: event.recordId,
        triggerEventId: event.triggerEventId,
        status: "SKIPPED",
        startedAt: now,
      },
      select: { id: true },
    });
    runId = run.id;
  } catch (e) {
    if (isUniqueViolation(e)) return "skipped";
    throw e;
  }

  // ── guard (b): everything below runs inside the marker ──
  return runContext.run({ automationId: automation.id }, async () => {
    const log: LogEntry[] = [];
    try {
      if (!(await recordMatches(event, automation.conditions))) {
        await finishRun(runId, "SKIPPED", null, log, now);
        return "skipped";
      }

      const scope: ActionScope = {
        event,
        now,
        ctx: systemCtx(event.organizationId),
        ownerId: await loadOwnerId(event),
      };

      // Sequential, never `Promise.all`: steps are ordered by definition, and
      // concurrent interactive transactions on this pg adapter fail with
      // 08P01 regardless.
      for (const step of automation.steps) {
        try {
          const detail = await runStep(scope, step.action, (step.config ?? {}) as StepConfig);
          log.push({ position: step.position, action: step.action, outcome: "ok", detail });
        } catch (e) {
          const detail = messageOf(e);
          log.push({ position: step.position, action: step.action, outcome: "failed", detail });
          throw new Error(`Step ${step.position} (${step.action}): ${detail}`);
        }
      }

      await finishRun(runId, "SUCCEEDED", null, log, now);
      return "ran";
    } catch (e) {
      // A run that throws is recorded, never swallowed: the failure is the
      // single most useful row in this table.
      await finishRun(runId, "FAILED", messageOf(e), log, now);
      return "failed";
    }
  });
}

/**
 * The dispatcher. Called from services when something happens.
 *
 * Every enabled rule listening to this trigger gets a look at the event,
 * one at a time. Sequential rather than `Promise.all` for two reasons: this pg
 * adapter fails with `08P01` on concurrent interactive transactions, and the
 * daily cap is a running count that parallel runs would race past.
 *
 * It never throws. A service calling this has already committed the change the
 * event describes; failing the lead ingestion because someone's rule has a bad
 * tag id would be the automation engine breaking the CRM.
 */
export async function dispatch(event: AutomationEvent): Promise<DispatchTotals> {
  const totals: DispatchTotals = { matched: 0, ran: 0, skipped: 0, failed: 0 };

  // ── guard (b): actions taken by an automation do not re-trigger automations ──
  if (insideAutomationRun()) return totals;

  // The trigger decides the record kind (see TRIGGER_RECORD_KIND). A caller
  // disagreeing is a programming error, but the dispatcher's contract is that
  // it never throws into the service that raised the event, so a mismatched
  // event runs nothing rather than taking that service down with it.
  if (event.recordKind !== TRIGGER_RECORD_KIND[event.trigger]) return totals;

  const now = event.now ?? new Date();

  const automations = await db.automation.findMany({
    where: {
      organizationId: event.organizationId, // tenant scope — non-negotiable
      trigger: event.trigger,
      enabled: true,
    },
    // Oldest first with a stable tiebreak: when two rules touch the same
    // record, the order they apply in has to be the same on every event.
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      conditions: true,
      dailyRunLimit: true,
      steps: {
        orderBy: { position: "asc" },
        select: { position: true, action: true, config: true },
      },
    },
  });
  totals.matched = automations.length;

  for (const automation of automations) {
    try {
      totals[await runAutomation(event, automation, now)]++;
    } catch (e) {
      // The run row itself could not be written — the database is unhappy, not
      // the rule. Still counted and still not rethrown: one tenant's broken
      // rule must not stop everyone else's sweep.
      totals.failed++;
      void e;
    }
  }

  return totals;
}
