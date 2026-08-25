"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";

import { Avatar } from "@/components/ui/avatar";
import { formatMoney, formatTotal, sumByCurrency } from "@/lib/money";
import { cn } from "@/lib/utils";
import { moveDealToStage } from "@/server/actions/crm";

export type BoardDeal = {
  id: string;
  title: string;
  value: string;
  currency: string;
  companyName: string | null;
  ownerName: string | null;
  /** Days since it entered this stage — computed server-side to stay pure. */
  daysInStage: number;
};

export type BoardStage = {
  id: string;
  name: string;
  isWon: boolean;
  isLost: boolean;
  deals: BoardDeal[];
};

function DealCard({ deal, dragging = false }: { deal: BoardDeal; dragging?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-md border border-border-subtle bg-surface p-4",
        dragging && "shadow-[var(--shadow-pop)]",
      )}
    >
      <p className="truncate text-[15px] font-[510] leading-snug">{deal.title}</p>
      {deal.companyName ? (
        <p className="mt-1 truncate text-[13px] text-muted">{deal.companyName}</p>
      ) : null}
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-[15px] font-[590] tabular-nums">
          {formatMoney(Number(deal.value), deal.currency)}
        </span>
        <span className="flex items-center gap-1.5">
          {/* A deal sitting too long is the thing a manager scans for. Amber
              at two weeks, red at a month — colour is backed by the number. */}
          {deal.daysInStage >= 14 ? (
            <span
              title={`${deal.daysInStage} days in this stage`}
              className={cn(
                "text-[12px] font-[510] tabular-nums",
                deal.daysInStage >= 30 ? "text-danger" : "text-warning",
              )}
            >
              {deal.daysInStage}d
            </span>
          ) : null}
          <Avatar name={deal.ownerName} size={22} />
        </span>
      </div>
    </div>
  );
}

function DraggableCard({ deal }: { deal: BoardDeal }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: deal.id });

  return (
    <li
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      // The source keeps its slot at low opacity so columns do not reflow
      // under the cursor mid-drag.
      className={cn(
        "cursor-grab touch-none rounded-md transition-opacity active:cursor-grabbing",
        isDragging && "opacity-30",
      )}
    >
      <DealCard deal={deal} />
    </li>
  );
}

function Column({
  stage,
  openValue,
  children,
}: {
  stage: BoardStage;
  openValue: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const stageTotal = sumByCurrency(stage.deals);
  // Share is computed within the dominant currency only — a percentage across
  // unlike units is meaningless.
  const share =
    openValue > 0 && !stage.isWon && !stage.isLost
      ? Math.round(((stageTotal.dominant?.amount ?? 0) / openValue) * 100)
      : 0;

  return (
    <section
      ref={setNodeRef}
      aria-label={stage.name}
      className={cn(
        "flex w-[320px] shrink-0 flex-col rounded-md border transition-colors duration-100",
        // Sunken ground so the cards read as sitting IN a column rather than
        // floating next to each other.
        isOver ? "border-accent bg-accent-soft" : "border-border-subtle bg-sunken",
      )}
    >
      <header className="border-b border-border-subtle px-4 py-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="flex items-center gap-2 text-[15px] font-[560]">
            <span
              aria-hidden
              className={cn(
                "size-1.5 rounded-full",
                stage.isWon ? "bg-success" : stage.isLost ? "bg-danger" : "bg-accent",
              )}
            />
            {stage.name}
          </h2>
          <span className="text-[13px] text-muted tabular-nums">{stage.deals.length}</span>
        </div>
        <p className="mt-2 text-[17px] font-[590] tabular-nums">{formatTotal(stageTotal)}</p>
        <div className="mt-1.5 h-0.5 w-full overflow-hidden rounded-full bg-border-subtle">
          <div className="h-full rounded-full bg-accent" style={{ width: `${share}%` }} />
        </div>
      </header>
      <ul className="flex-1 space-y-2.5 p-3">{children}</ul>
    </section>
  );
}

export function PipelineBoard({ stages }: { stages: BoardStage[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [activeId, setActiveId] = useState<string | null>(null);

  // Optimistic move: a rep dragging a card must see it land instantly. The
  // server result either confirms it or the revalidate snaps it back.
  const [optimisticStages, applyMove] = useOptimistic(
    stages,
    (current: BoardStage[], move: { dealId: string; toStageId: string }) => {
      const deal = current.flatMap((s) => s.deals).find((d) => d.id === move.dealId);
      if (!deal) return current;
      return current.map((stage) => ({
        ...stage,
        deals:
          stage.id === move.toStageId
            ? [deal, ...stage.deals.filter((d) => d.id !== move.dealId)]
            : stage.deals.filter((d) => d.id !== move.dealId),
      }));
    },
  );

  const sensors = useSensors(
    // 6px of slop so a click on a card is still a click, not a micro-drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const allDeals = optimisticStages.flatMap((s) => s.deals);
  const activeDeal = allDeals.find((d) => d.id === activeId) ?? null;
  const openTotal = sumByCurrency(
    optimisticStages.filter((s) => !s.isWon && !s.isLost).flatMap((s) => s.deals),
  );
  const openValue = openTotal.dominant?.amount ?? 0;

  function onDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const dealId = String(event.active.id);
    const toStageId = event.over ? String(event.over.id) : null;
    if (!toStageId) return;

    const from = optimisticStages.find((s) => s.deals.some((d) => d.id === dealId));
    if (!from || from.id === toStageId) return;

    const to = optimisticStages.find((s) => s.id === toStageId);
    const deal = from.deals.find((d) => d.id === dealId);

    // Marking a deal lost requires a reason, and a drag has nowhere to type
    // one. Sending the person to the deal page is honest; silently losing the
    // reason, or inventing a blank one, is not.
    if (to?.isLost) {
      toast.info("Open the deal to record why it was lost", {
        description: deal?.title,
        action: { label: "Open", onClick: () => router.push(`/deals/${dealId}`) },
      });
      return;
    }

    startTransition(async () => {
      applyMove({ dealId, toStageId });
      const result = await moveDealToStage(dealId, toStageId);
      if (result.ok) {
        toast.success(`${deal?.title ?? "Deal"} moved to ${to?.name ?? "stage"}`);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) => `Picked up ${active.id}. Use arrow keys to choose a stage.`,
          onDragOver: ({ over }) => (over ? `Over ${over.id}` : "Not over a stage"),
          onDragEnd: ({ over }) => (over ? `Dropped into ${over.id}` : "Cancelled"),
          onDragCancel: () => "Move cancelled",
        },
      }}
    >
      <div className="flex gap-4">
        {optimisticStages.map((stage) => (
          <Column key={stage.id} stage={stage} openValue={openValue}>
            {stage.deals.length === 0 ? (
              <li className="px-1 py-8 text-center text-[13px] text-muted">Drop a deal here</li>
            ) : (
              stage.deals.map((deal) => <DraggableCard key={deal.id} deal={deal} />)
            )}
          </Column>
        ))}
      </div>

      {/* The overlay follows the cursor so the card never clips its column. */}
      <DragOverlay dropAnimation={null}>
        {activeDeal ? (
          <div className="w-[296px] cursor-grabbing">
            <DealCard deal={activeDeal} dragging />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
