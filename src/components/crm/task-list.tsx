"use client";

import { Trash2 } from "lucide-react";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";

import { Badge, type Tone } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { deleteTaskAction, toggleTaskAction } from "@/server/actions/tasks";

export type TaskItem = {
  id: string;
  title: string;
  dueAt: Date | null;
  completedAt: Date | null;
  bucket: "overdue" | "today" | "upcoming" | "someday";
  assignee?: { name: string | null; email: string } | null;
};

const BUCKET: Record<TaskItem["bucket"], { label: string; tone: Tone }> = {
  overdue: { label: "overdue", tone: "danger" },
  today: { label: "today", tone: "warning" },
  upcoming: { label: "upcoming", tone: "neutral" },
  someday: { label: "no date", tone: "neutral" },
};

export function TaskList({
  tasks,
  showAssignee = false,
  emptyHint = "Nothing to do here.",
}: {
  tasks: TaskItem[];
  showAssignee?: boolean;
  emptyHint?: string;
}) {
  const [, start] = useTransition();

  // Ticking a checkbox must feel instant — the round trip happens behind it.
  const [optimistic, apply] = useOptimistic(
    tasks,
    (current: TaskItem[], change: { id: string; done?: boolean; removed?: boolean }) =>
      current
        .filter((t) => !(change.removed && t.id === change.id))
        .map((t) =>
          t.id === change.id && change.done !== undefined
            ? { ...t, completedAt: change.done ? new Date() : null }
            : t,
        ),
  );

  if (optimistic.length === 0) {
    return <p className="px-4 py-6 text-center text-[12px] text-muted">{emptyHint}</p>;
  }

  return (
    <ul className="divide-y divide-border-subtle">
      {optimistic.map((task) => {
        const done = Boolean(task.completedAt);
        const bucket = BUCKET[task.bucket];

        return (
          <li key={task.id} className="flex items-center gap-2.5 px-4 py-2">
            <input
              type="checkbox"
              checked={done}
              aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
              onChange={(e) => {
                const next = e.target.checked;
                start(async () => {
                  apply({ id: task.id, done: next });
                  const result = await toggleTaskAction(task.id, next);
                  if (!result.ok) toast.error(result.error ?? "Could not update the task");
                });
              }}
              className="size-3.5 shrink-0 cursor-pointer accent-[var(--accent)]"
            />

            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[12px]",
                done && "text-muted line-through",
              )}
            >
              {task.title}
            </span>

            {showAssignee && task.assignee ? (
              <span className="hidden shrink-0 text-[12px] text-muted sm:block">
                {task.assignee.name ?? task.assignee.email}
              </span>
            ) : null}

            {!done ? (
              <Badge tone={bucket.tone}>
                {task.dueAt ? new Date(task.dueAt).toLocaleDateString() : bucket.label}
              </Badge>
            ) : null}

            <button
              type="button"
              aria-label={`Delete ${task.title}`}
              onClick={() =>
                start(async () => {
                  apply({ id: task.id, removed: true });
                  const result = await deleteTaskAction(task.id);
                  if (!result.ok) toast.error(result.error ?? "Could not delete the task");
                })
              }
              className="shrink-0 rounded p-1 text-muted transition-colors hover:bg-danger-muted hover:text-danger"
            >
              <Trash2 size={12} strokeWidth={1.75} aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
