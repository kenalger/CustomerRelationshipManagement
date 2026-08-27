import { SectionHeader } from "@/components/section-header";
import { hasRole } from "@/server/authz";
import { requireCtx } from "@/server/context";
import {
  TRIGGER_RECORD_KIND,
  getAutomation,
  listAutomations,
  listRuns,
} from "@/server/services/automation";
import { listTags } from "@/server/services/tags";
import { AutomationsClient } from "./automations-client";
import {
  TRIGGER_HINT,
  TRIGGER_LABEL,
  TRIGGERS,
  type LeadConditions,
  describeConditions,
  sentenceFor,
} from "./shared";

export const metadata = { title: "Automations · CRM" };

/**
 * How far back the "last ran" column can see.
 *
 * `listRuns` is the only read of the run table available here and it returns a
 * flat, newest-first page across the whole organization. A rule whose last run
 * is older than this window is reported as "not in the recent log" rather than
 * as "never" — a rule that has run 4,000 times must never be described as one
 * that has never fired.
 */
const RUN_WINDOW = 200;

export default async function AutomationsSettingsPage() {
  const ctx = await requireCtx();

  const summaries = await listAutomations(ctx);

  /*
   * One extra read per automation, to get its steps.
   *
   * `listAutomations` returns a step COUNT, and "3 steps" is not a sentence
   * anybody can check before arming a rule. This screen is a handful of rows
   * behind a settings tab, so the honest line is worth the reads.
   */
  const [details, runs, tags] = await Promise.all([
    Promise.all(summaries.map((automation) => getAutomation(ctx, automation.id))),
    listRuns(ctx, { limit: RUN_WINDOW }),
    listTags(ctx),
  ]);

  // Newest first, so the first row seen for an automation is its latest run.
  const lastRun = new Map<string, (typeof runs)[number]>();
  for (const run of runs) {
    if (!lastRun.has(run.automationId)) lastRun.set(run.automationId, run);
  }

  const tagOptions = tags.map((tag) => ({ id: tag.id, name: tag.name }));

  const rows = summaries.map((automation, index) => {
    const detail = details[index];
    const steps = detail.ok ? detail.data.steps : [];
    const kind = TRIGGER_RECORD_KIND[automation.trigger];
    const clause =
      kind === "LEAD"
        ? describeConditions((automation.conditions as LeadConditions | null) ?? null, tagOptions)
        : null;
    const latest = lastRun.get(automation.id);

    return {
      id: automation.id,
      name: automation.name,
      description: automation.description,
      trigger: automation.trigger,
      triggerLabel: TRIGGER_LABEL[automation.trigger],
      enabled: automation.enabled,
      stepCount: automation.stepCount,
      runCount: automation.runCount,
      sentence: sentenceFor(automation.trigger, steps, clause),
      lastRunAt: latest?.startedAt ?? null,
      lastRunStatus: latest?.status ?? null,
    };
  });

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-8">
      <SectionHeader
        title="Automations"
        description="A rule is one sentence: when something happens, do these things. Rules arrive as drafts — turning one on is a separate act, with a higher bar."
      />

      <AutomationsClient
        rows={rows}
        triggerOptions={TRIGGERS.map((trigger) => ({
          value: trigger,
          label: TRIGGER_LABEL[trigger],
          hint: TRIGGER_HINT[trigger],
          // Read from the service's own map. The client never re-derives it.
          kind: TRIGGER_RECORD_KIND[trigger],
        }))}
        canWrite={hasRole(ctx, "MANAGER")}
        canArm={hasRole(ctx, "ADMIN")}
      />
    </div>
  );
}
