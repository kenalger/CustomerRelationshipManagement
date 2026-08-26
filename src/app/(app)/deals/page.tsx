import { KanbanSquare, Plus } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { PageToolbar } from "@/components/page-toolbar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { formatTotal, sumByCurrency } from "@/lib/money";
import { requireCtx } from "@/server/context";
import { getPipelineBoard } from "@/server/services/deals";
import { PipelineBoard } from "./pipeline-board";

export const metadata = { title: "Pipeline · CRM" };

export default async function DealsPage() {
  const ctx = await requireCtx();
  const pipeline = await getPipelineBoard(ctx);

  if (!pipeline) {
    return (
      <>
        <PageHeader title="Pipeline" />
        <div className="p-8">
          <EmptyState
            icon={KanbanSquare}
            title="No pipeline configured"
            hint="An admin needs to create a pipeline and its stages before deals can exist."
          />
        </div>
      </>
    );
  }

  const open = pipeline.stages.filter((s) => !s.isWon && !s.isLost);
  const openTotal = sumByCurrency(open.flatMap((s) => s.deals));
  const openCount = open.reduce((sum, s) => sum + s.deals.length, 0);

  return (
    <>
      <PageHeader
        title={pipeline.name}
        description={`${formatTotal(openTotal)} across ${openCount} open ${openCount === 1 ? "deal" : "deals"}`}
      />

      <div className="px-8 pt-8">
        <PageToolbar
          actions={
            <Link href="/deals/new">
              <Button size="sm">
                <Plus size={14} strokeWidth={2} aria-hidden />
                New deal
              </Button>
            </Link>
          }
        />
      </div>

      <div className="overflow-x-auto px-8 pb-8 pt-6">
        {/* Decimal is not serialisable across the RSC boundary — the value is
            stringified here and parsed back in the client component. */}
        <PipelineBoard
          stages={pipeline.stages.map((stage) => ({
            id: stage.id,
            name: stage.name,
            isWon: stage.isWon,
            isLost: stage.isLost,
            deals: stage.deals.map((deal) => ({
              id: deal.id,
              title: deal.title,
              value: deal.value.toString(),
              currency: deal.currency,
              companyName: deal.company?.name ?? null,
              ownerName: deal.owner?.name ?? deal.owner?.email ?? null,
              // Computed here, not in the component — reading the clock during
              // render is impure.
              daysInStage: Math.floor(
                (Date.now() - deal.stageEnteredAt.getTime()) / 86_400_000,
              ),
            })),
          }))}
        />
      </div>

      <p className="px-8 pb-8 text-[13px] text-muted">
        Drag a deal to change its stage, or tab to a card and use the arrow keys.
      </p>

    </>
  );
}
