import Link from "next/link";
import { notFound } from "next/navigation";

import { ActivityTimeline } from "@/components/crm/activity-timeline";
import { EditableField } from "@/components/crm/editable-field";
import { TaskList } from "@/components/crm/task-list";
import { Panel } from "@/components/ui/panel";
import { RecordComposer } from "@/components/crm/record-composer";
import { PageHeader } from "@/components/page-header";
import { formatMoney } from "@/lib/money";
import { requireCtx } from "@/server/context";
import { listActivities } from "@/server/services/activities";
import { listTasksFor } from "@/server/services/tasks";
import { getDeal } from "@/server/services/deals";
import { StagePicker } from "./stage-picker";

export default async function DealDetailPage({ params }: PageProps<"/deals/[id]">) {
  const ctx = await requireCtx();
  const { id } = await params;

  const deal = await getDeal(ctx, id);
  if (!deal) notFound();

  const [activities, tasks] = await Promise.all([
    listActivities(ctx, { dealId: deal.id }),
    listTasksFor(ctx, { dealId: deal.id }),
  ]);
  const weighted = Number(deal.value) * (deal.stage.probability / 100);
  const canEdit = ctx.role !== "READ_ONLY";

  return (
    <>
      <PageHeader
        title={deal.title}
        description={`${formatMoney(Number(deal.value), deal.currency)} · ${deal.stage.name}`}
      />

      <div className="grid gap-4 p-6 lg:grid-cols-[20rem_1fr]">
        <div className="space-y-4">
          <Panel title="Stage">
            <StagePicker
              dealId={deal.id}
              currentStageId={deal.stageId}
              stages={deal.pipeline.stages.map((s) => ({
                id: s.id,
                name: s.name,
                isLost: s.isLost,
              }))}
              currentLostReason={deal.lostReason}
            />
          </Panel>

          <Panel title="Details">
            <dl className="divide-y divide-border-subtle">
              <EditableField
                entity="deal"
                id={deal.id}
                field="title"
                label="Name"
                value={deal.title}
                canEdit={canEdit}
              />
              <EditableField
                entity="deal"
                id={deal.id}
                field="value"
                label="Value"
                type="number"
                display="money"
                currency={deal.currency}
                value={deal.value.toString()}
                canEdit={canEdit}
              />
              <EditableField
                entity="deal"
                id={deal.id}
                field="expectedCloseDate"
                label="Expected close"
                type="date"
                display="date"
                value={deal.expectedCloseDate?.toISOString().slice(0, 10) ?? null}
                canEdit={canEdit}
              />
              <div className="flex items-baseline justify-between gap-4 py-1.5">
                <dt className="shrink-0 text-[12px] text-muted">Days in stage</dt>
                <dd className="min-w-0 truncate text-right text-[12px] tabular-nums">
                  {deal.daysInStage}
                  {deal.daysInStage >= 30 ? (
                    <span className="ml-1 text-danger">stalled</span>
                  ) : deal.daysInStage >= 14 ? (
                    <span className="ml-1 text-warning">slow</span>
                  ) : null}
                </dd>
              </div>
              {deal.lostReason ? (
                <div className="flex items-baseline justify-between gap-4 py-1.5">
                  <dt className="shrink-0 text-[12px] text-muted">Lost because</dt>
                  <dd className="min-w-0 text-right text-[12px]">{deal.lostReason}</dd>
                </div>
              ) : null}
              <div className="flex items-baseline justify-between gap-4 py-1.5">
                <dt className="shrink-0 text-[12px] text-muted">Weighted</dt>
                <dd className="min-w-0 truncate text-right text-[12px] tabular-nums">
                  {formatMoney(weighted, deal.currency)}{" "}
                  <span className="text-muted">@ {deal.stage.probability}%</span>
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 py-1.5">
                <dt className="shrink-0 text-[12px] text-muted">Company</dt>
                <dd className="min-w-0 truncate text-right text-[12px]">
                  {deal.company ? (
                    <Link href={`/companies/${deal.company.id}`} className="text-accent hover:underline">
                      {deal.company.name}
                    </Link>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 py-1.5">
                <dt className="shrink-0 text-[12px] text-muted">Contact</dt>
                <dd className="min-w-0 truncate text-right text-[12px]">
                  {deal.contact ? (
                    <Link href={`/contacts/${deal.contact.id}`} className="text-accent hover:underline">
                      {[deal.contact.firstName, deal.contact.lastName].filter(Boolean).join(" ")}
                    </Link>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 py-1.5">
                <dt className="shrink-0 text-[12px] text-muted">Sales rep</dt>
                <dd className="min-w-0 truncate text-right text-[12px]">
                  {deal.owner?.name ?? deal.owner?.email ?? <span className="text-muted">—</span>}
                </dd>
              </div>
            </dl>
          </Panel>
        </div>

        <div className="space-y-4">
          <section className="rounded-lg bg-surface">
            <header className="flex items-center justify-between border-b border-border-subtle px-4 py-2.5">
              <h2 className="text-[14px] font-semibold">
                Tasks{" "}
                <span className="text-muted tabular-nums">
                  ({tasks.filter((t) => !t.completedAt).length} open)
                </span>
              </h2>
            </header>
            <TaskList tasks={tasks} emptyHint="No follow-ups yet — add one from the composer below." />
          </section>

          <RecordComposer link={{ dealId: deal.id }} canWrite={canEdit} />
          <Panel title="Activity">
            <ActivityTimeline activities={activities} />
          </Panel>
        </div>
      </div>
    </>
  );
}
