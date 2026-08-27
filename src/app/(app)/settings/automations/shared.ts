import type { AutomationAction, AutomationTrigger } from "@/generated/prisma/enums";
import type { Tone } from "@/components/ui/badge";

/**
 * The vocabulary the automation list, the editor and the run log all read.
 *
 * Deliberately free of any `@/server/services/*` import: every one of those
 * screens has a client half, and a service import drags Prisma — and with it
 * `fs`/`net`/`tls` — into the browser bundle.
 *
 * `TRIGGER_RECORD_KIND` is NOT re-derived here. The service exports it, the
 * server page imports it and passes it down as data, so there is exactly one
 * copy of that mapping in the codebase.
 */

/**
 * Mirrors `AutomationRecordKind` in `src/server/services/automation.ts`.
 *
 * A type alias rather than an import, because that module cannot cross into a
 * client bundle. It is three literals that are also written into the database
 * as `AutomationRun.recordKind`, so it does not drift silently.
 */
export type RecordKind = "LEAD" | "DEAL" | "TASK";

// ─────────────────────────── triggers ───────────────────────────

/** The opening half of the sentence a rule reads as. */
export const TRIGGER_LABEL: Record<AutomationTrigger, string> = {
  LEAD_CREATED: "When a lead is created",
  LEAD_STATUS_CHANGED: "When a lead's status changes",
  DEAL_STAGE_CHANGED: "When a deal moves to another stage",
  TASK_COMPLETED: "When a task is completed",
  SCHEDULE_DAILY: "Every day, for every lead",
};

/** What actually fires it, so nobody has to guess at the wording. */
export const TRIGGER_HINT: Record<AutomationTrigger, string> = {
  LEAD_CREATED:
    "Fires once, when the lead first arrives — from a webhook, an import or by hand. A status set during creation does not also count as a change.",
  LEAD_STATUS_CHANGED:
    "Fires when a lead moves between New, Working, Qualified, Converted or Junk. Not on creation.",
  DEAL_STAGE_CHANGED: "Fires when a deal is moved to a different stage of its pipeline.",
  TASK_COMPLETED: "Fires when someone ticks a task off.",
  SCHEDULE_DAILY:
    "Sweeps every lead once a day. Without conditions it will touch the whole lead table, so give it some.",
};

export const TRIGGERS: AutomationTrigger[] = [
  "LEAD_CREATED",
  "LEAD_STATUS_CHANGED",
  "DEAL_STAGE_CHANGED",
  "TASK_COMPLETED",
  "SCHEDULE_DAILY",
];

/** "lead" / "deal" / "task", for prose. */
export const KIND_NOUN: Record<RecordKind, string> = {
  LEAD: "lead",
  DEAL: "deal",
  TASK: "task",
};

/** Conditions are the lead filter vocabulary, so only lead rules can carry them. */
export function supportsConditions(kind: RecordKind): boolean {
  return kind === "LEAD";
}

// ─────────────────────────── actions ───────────────────────────

export const ACTION_LABEL: Record<AutomationAction, string> = {
  ASSIGN_OWNER: "Assign an owner",
  SET_FIELD: "Set a field",
  ADD_TAG: "Add a tag",
  CREATE_TASK: "Create a task",
  NOTIFY: "Notify someone",
};

/** The trailing half of the sentence, lower case so it reads as one line. */
export const ACTION_PHRASE: Record<AutomationAction, string> = {
  ASSIGN_OWNER: "assign an owner",
  SET_FIELD: "set a field",
  ADD_TAG: "add a tag",
  CREATE_TASK: "create a task",
  NOTIFY: "notify someone",
};

/**
 * Which actions a rule about this kind of record may use.
 *
 * This mirrors `configSchemaFor` in `src/server/services/automation.ts`, which
 * is module-private and is the authority — it rejects an illegal pair at save
 * time. This list exists so the editor never *offers* a pair the service would
 * then refuse, because a form that offers a choice and then refuses it is a
 * broken form.
 *
 *   - ADD_TAG is LEAD-only: `Tagging` has no deal or task column.
 *   - ASSIGN_OWNER is LEAD/DEAL-only: a task is assigned, not owned.
 *   - SET_FIELD has no writable fields at all for a task.
 */
export const ACTIONS_FOR_KIND: Record<RecordKind, AutomationAction[]> = {
  LEAD: ["ASSIGN_OWNER", "SET_FIELD", "ADD_TAG", "CREATE_TASK", "NOTIFY"],
  DEAL: ["ASSIGN_OWNER", "SET_FIELD", "CREATE_TASK", "NOTIFY"],
  TASK: ["CREATE_TASK", "NOTIFY"],
};

/**
 * The fields `SET_FIELD` may write, per record kind — the UI half of the
 * allow-list in `setFieldConfigSchemas`. Ownership, stage, source and identity
 * are all absent on purpose; see the service for why each one is excluded.
 */
export const SET_FIELD_OPTIONS: Record<RecordKind, { value: string; label: string }[]> = {
  LEAD: [
    { value: "status", label: "Status" },
    { value: "score", label: "Score" },
  ],
  DEAL: [{ value: "expectedCloseDate", label: "Expected close date" }],
  TASK: [],
};

export const LEAD_STATUSES = [
  { value: "NEW", label: "New" },
  { value: "WORKING", label: "Working" },
  { value: "QUALIFIED", label: "Qualified" },
  { value: "CONVERTED", label: "Converted" },
  { value: "JUNK", label: "Junk" },
] as const;

export const LEAD_SOURCES = [
  { value: "FACEBOOK_LEAD_ADS", label: "Facebook lead ad" },
  { value: "FACEBOOK_MESSENGER", label: "Messenger" },
  { value: "FACEBOOK_COMMENT", label: "Facebook comment" },
  { value: "WEB_FORM", label: "Web form" },
  { value: "EMAIL", label: "Email" },
  { value: "CSV_IMPORT", label: "CSV import" },
  { value: "MANUAL", label: "Entered by hand" },
] as const;

const STATUS_LABEL: Record<string, string> = Object.fromEntries(
  LEAD_STATUSES.map((s) => [s.value, s.label]),
);
const SOURCE_LABEL: Record<string, string> = Object.fromEntries(
  LEAD_SOURCES.map((s) => [s.value, s.label]),
);

// ─────────────────────────── the shapes the editor edits ───────────────────────────

export type StepDraft = { action: AutomationAction; config: Record<string, unknown> };

/** The subset of `leadFilterSchema` this editor offers. */
export type LeadConditions = {
  status?: string[];
  source?: string[];
  scoreMin?: number;
  scoreMax?: number;
  tagIds?: string[];
};

export type Member = { id: string; name: string | null; email: string; role: string };
export type TagOption = { id: string; name: string };

export function memberLabel(member: Member | undefined, fallback: string): string {
  if (!member) return fallback;
  return member.name?.trim() || member.email;
}

/** A blank config that already satisfies the action's schema where it can. */
export function defaultConfigFor(kind: RecordKind, action: AutomationAction): Record<string, unknown> {
  switch (action) {
    case "ASSIGN_OWNER":
      return { strategy: "ROUND_ROBIN" };
    case "SET_FIELD":
      return kind === "DEAL"
        ? { field: "expectedCloseDate", value: null }
        : { field: "status", value: "WORKING" };
    case "ADD_TAG":
      return {};
    case "CREATE_TASK":
      return { title: "" };
    case "NOTIFY":
      return { message: "" };
  }
}

// ─────────────────────────── prose ───────────────────────────

function quoted(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text === "" ? fallback : `“${text}”`;
}

/**
 * One step as a sentence.
 *
 * Used in three places — the read-only step list, the editor's own summary and
 * the run log — so a rule reads the same however you arrive at it.
 */
export function describeStep(
  kind: RecordKind,
  step: StepDraft,
  lookup: { members: Member[]; tags: TagOption[] },
): string {
  const config = step.config ?? {};
  const person = (id: unknown, fallback: string) =>
    typeof id === "string"
      ? memberLabel(
          lookup.members.find((m) => m.id === id),
          "someone who has since left the team",
        )
      : fallback;

  switch (step.action) {
    case "ASSIGN_OWNER":
      return typeof config.userId === "string"
        ? `Give the ${KIND_NOUN[kind]} to ${person(config.userId, "")}`
        : `Give the ${KIND_NOUN[kind]} to whoever has the fewest open records`;

    case "SET_FIELD": {
      if (kind === "DEAL") {
        const value = config.value;
        return typeof value === "string" && value !== ""
          ? `Set the expected close date to ${value.slice(0, 10)}`
          : "Clear the expected close date";
      }
      if (config.field === "score") {
        return typeof config.value === "number"
          ? `Set the score to ${config.value}`
          : "Set the score";
      }
      const status = typeof config.value === "string" ? config.value : "";
      return `Set the status to ${STATUS_LABEL[status] ?? "a status"}`;
    }

    case "ADD_TAG": {
      const tag = lookup.tags.find((t) => t.id === config.tagId);
      return tag ? `Add the tag ${tag.name}` : "Add a tag — none chosen yet";
    }

    case "CREATE_TASK": {
      const parts = [`Create a task ${quoted(config.title, "with no title yet")}`];
      if (typeof config.dueInDays === "number") {
        parts.push(config.dueInDays === 0 ? "due today" : `due in ${config.dueInDays} days`);
      } else {
        parts.push("with no due date");
      }
      parts.push(`for ${person(config.assignTo, `the ${KIND_NOUN[kind]}'s owner`)}`);
      return parts.join(", ");
    }

    case "NOTIFY":
      return `Notify ${person(config.userId, `the ${KIND_NOUN[kind]}'s owner`)}: ${quoted(
        config.message,
        "with no message yet",
      )}`;
  }
}

/** The conditions as a readable clause, or null when there are none. */
export function describeConditions(
  conditions: LeadConditions | null,
  tags: TagOption[],
): string | null {
  if (!conditions) return null;
  const parts: string[] = [];

  if (conditions.status?.length) {
    parts.push(`status is ${conditions.status.map((s) => STATUS_LABEL[s] ?? s).join(" or ")}`);
  }
  if (conditions.source?.length) {
    parts.push(`source is ${conditions.source.map((s) => SOURCE_LABEL[s] ?? s).join(" or ")}`);
  }
  if (conditions.scoreMin !== undefined && conditions.scoreMax !== undefined) {
    parts.push(`score is between ${conditions.scoreMin} and ${conditions.scoreMax}`);
  } else if (conditions.scoreMin !== undefined) {
    parts.push(`score is at least ${conditions.scoreMin}`);
  } else if (conditions.scoreMax !== undefined) {
    parts.push(`score is at most ${conditions.scoreMax}`);
  }
  if (conditions.tagIds?.length) {
    const names = conditions.tagIds.map((id) => tags.find((t) => t.id === id)?.name ?? "a deleted tag");
    parts.push(`tagged ${names.join(" and ")}`);
  }

  return parts.length === 0 ? null : parts.join(", and ");
}

/**
 * The whole rule as one line a person can check before arming it.
 *
 * "When a lead is created, and score is at least 70 → create a task, notify
 * someone". A rule with no steps says so rather than trailing off, because a
 * rule with no steps is exactly the one that cannot be turned on.
 */
export function sentenceFor(
  trigger: AutomationTrigger,
  steps: { action: AutomationAction }[],
  conditionClause?: string | null,
): string {
  const when = conditionClause
    ? `${TRIGGER_LABEL[trigger]}, and ${conditionClause}`
    : TRIGGER_LABEL[trigger];
  const then =
    steps.length === 0
      ? "do nothing — no steps yet"
      : steps.map((step) => ACTION_PHRASE[step.action]).join(", then ");
  return `${when} → ${then}`;
}

// ─────────────────────────── runs ───────────────────────────

export type LogEntry = {
  position: number;
  action: AutomationAction;
  outcome: "ok" | "failed";
  detail: string;
};

export type RunRow = {
  id: string;
  recordKind: string;
  recordId: string;
  status: string;
  error: string | null;
  log: LogEntry[] | null;
  startedAt: Date;
  finishedAt: Date | null;
};

/** The prefix the engine writes on a run it stopped because of the daily cap. */
const DAILY_LIMIT_PREFIX = "Daily run limit";

export const RUN_TONE: Record<string, Tone> = {
  SUCCEEDED: "success",
  SKIPPED: "neutral",
  FAILED: "danger",
};

/** A word beside every tone — colour never carries the meaning on its own. */
export const RUN_LABEL: Record<string, string> = {
  SUCCEEDED: "Ran",
  SKIPPED: "Skipped",
  FAILED: "Failed",
};

/**
 * Why this run ended the way it did.
 *
 * A SKIPPED row with no explanation is the single most useless row this table
 * could hold — "why did my rule not fire" is the question it exists to answer —
 * so every skip is traced back to which of the engine's three outcomes produced
 * it: the daily cap (which stamps its own message), a run that was claimed and
 * then interrupted (no finish time), or conditions that did not match.
 */
export function explainRun(run: RunRow): string {
  if (run.status === "SUCCEEDED") return "Every step ran.";
  if (run.status === "FAILED") {
    return run.error ?? "A step failed and the engine did not record why.";
  }
  if (run.error?.startsWith(DAILY_LIMIT_PREFIX)) return run.error;
  if (run.finishedAt === null) {
    return "Claimed but never finished — the run was interrupted before it could act. Nothing was changed.";
  }
  return "The conditions did not match this record, so no step ran.";
}
