import { notFound } from "next/navigation";

import { hasRole } from "@/server/authz";
import { requireCtx } from "@/server/context";
import { TRIGGER_RECORD_KIND, getAutomation, listRuns } from "@/server/services/automation";
import { listTags } from "@/server/services/tags";
import { listTeam } from "@/server/services/team";
import {
  TRIGGER_HINT,
  TRIGGER_LABEL,
  type LeadConditions,
  type LogEntry,
} from "../shared";
import { AutomationEditor } from "./automation-editor";

/** The run log is an audit surface, not a browse surface — the recent past is what answers "why did it not fire". */
const RUN_LIMIT = 50;

export async function generateMetadata({ params }: PageProps<"/settings/automations/[id]">) {
  const ctx = await requireCtx();
  const { id } = await params;
  const automation = await getAutomation(ctx, id);
  return { title: automation.ok ? `${automation.data.name} · CRM` : "Automation · CRM" };
}

export default async function AutomationEditorPage({
  params,
}: PageProps<"/settings/automations/[id]">) {
  const ctx = await requireCtx();
  const { id } = await params;

  const result = await getAutomation(ctx, id);
  // Another organization's id is indistinguishable from one that never
  // existed, exactly as the service intends.
  if (!result.ok) notFound();
  const automation = result.data;

  // The service owns this mapping; the editor is handed the answer.
  const kind = TRIGGER_RECORD_KIND[automation.trigger];

  const [runs, tags, team] = await Promise.all([
    listRuns(ctx, { automationId: id, limit: RUN_LIMIT }),
    // Tags are only ever offered to a lead rule — for the ADD_TAG step and for
    // the tag condition — so there is nothing to load for the other two kinds.
    kind === "LEAD" ? listTags(ctx) : Promise.resolve([]),
    listTeam(ctx),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-8">
      <AutomationEditor
        automation={{
          id: automation.id,
          name: automation.name,
          description: automation.description,
          trigger: automation.trigger,
          triggerLabel: TRIGGER_LABEL[automation.trigger],
          triggerHint: TRIGGER_HINT[automation.trigger],
          enabled: automation.enabled,
          dailyRunLimit: automation.dailyRunLimit,
          conditions: (automation.conditions as LeadConditions | null) ?? null,
          steps: automation.steps.map((step) => ({
            action: step.action,
            config: (step.config ?? {}) as Record<string, unknown>,
          })),
        }}
        kind={kind}
        members={team.members.map((member) => ({
          id: member.id,
          name: member.name,
          email: member.email,
          role: member.role,
        }))}
        tags={tags.map((tag) => ({ id: tag.id, name: tag.name }))}
        runs={runs.map((run) => ({
          id: run.id,
          recordKind: run.recordKind,
          recordId: run.recordId,
          status: run.status,
          error: run.error,
          log: Array.isArray(run.log) ? (run.log as unknown as LogEntry[]) : null,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
        }))}
        canWrite={hasRole(ctx, "MANAGER")}
        canArm={hasRole(ctx, "ADMIN")}
      />
    </div>
  );
}
