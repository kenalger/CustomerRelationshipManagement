"use client";

import { Building2, Sparkles, Trash2, User } from "lucide-react";
import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";

import { Avatar } from "@/components/ui/avatar";
import { cn, timeAgo, timeUntil } from "@/lib/utils";
import { deleteTaskAction, toggleTaskAction } from "@/server/actions/tasks";

export type TaskLink = {
  kind: "contact" | "deal" | "lead";
  id: string;
  label: string;
  sub: string | null;
};

export type TaskItem = {
  id: string;
  title: string;
  dueAt: Date | null;
  completedAt: Date | null;
  bucket: "overdue" | "today" | "upcoming" | "someday";
  assignee?: { name: string | null; email: string } | null;
  link?: TaskLink | null;
};

/** Where a linked record lives, and the icon that says which kind it is. */
const LINK_KIND = {
  contact: { href: (id: string) => `/contacts/${id}`, Icon: User },
  deal: { href: (id: string) => `/deals/${id}`, Icon: Building2 },
  // Leads have no detail page of their own yet, so this lands on the queue.
  lead: { href: () => `/leads`, Icon: Sparkles },
} as const;

/**
 * When a task is due, in words.
 *
 * Relative rather than a locale date, because the question a person is asking
 * of this list is "how late am I", and "2 days ago" answers it where
 * "17/08/2026" makes them do the arithmetic. Overdue reads backwards, upcoming
 * forwards, so the two are never confusable.
 */
function dueLabel(task: TaskItem): { text: string; cls: string } {
  if (!task.dueAt) return { text: "No date", cls: "text-muted" };
  if (task.bucket === "overdue") {
    return { text: `Due ${timeAgo(task.dueAt)}`, cls: "text-danger font-[560]" };
  }
  if (task.bucket === "today") return { text: "Due today", cls: "text-warning font-[560]" };
  return { text: timeUntil(task.dueAt).replace(/^in /, "Due in "), cls: "text-secondary" };
}

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
    return <p className="px-5 py-6 text-center text-[13px] text-muted">{emptyHint}</p>;
  }

  return (
    <ul className="divide-y divide-border-subtle">
      {optimistic.map((task) => {
        const done = Boolean(task.completedAt);
        const due = dueLabel(task);
        const kind = task.link ? LINK_KIND[task.link.kind] : null;

        return (
          <li
            key={task.id}
            className={cn(
              "group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-hover",
              // A left edge rather than a tinted row: it marks the group
              // without washing the text behind a colour, and it pairs with
              // the word "Due 2 days ago" beside it rather than carrying the
              // meaning alone.
              !done && task.bucket === "overdue" && "border-l-2 border-l-danger",
            )}
          >
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
              className="size-4 shrink-0 cursor-pointer accent-[var(--accent)]"
            />

            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  "block truncate text-[14px]",
                  done ? "text-muted line-through" : "text-foreground",
                )}
              >
                {task.title}
              </span>

              {/* Who the task is about. On a CRM this is most of the row:
                  "Call Samir about pricing" is not actionable until you can
                  see which Samir and open him. */}
              {task.link && kind ? (
                <Link
                  href={kind.href(task.link.id)}
                  className="mt-0.5 inline-flex max-w-full items-center gap-1 text-[12px] text-muted transition-colors hover:text-accent"
                >
                  <kind.Icon size={11} strokeWidth={2} aria-hidden className="shrink-0" />
                  <span className="truncate">
                    {task.link.label}
                    {task.link.sub ? ` · ${task.link.sub}` : ""}
                  </span>
                </Link>
              ) : null}
            </span>

            {showAssignee && task.assignee ? (
              <span
                className="hidden shrink-0 items-center gap-1.5 sm:flex"
                title={task.assignee.name ?? task.assignee.email}
              >
                <Avatar name={task.assignee.name ?? task.assignee.email} size={20} />
              </span>
            ) : null}

            {!done ? (
              <span className={cn("shrink-0 text-[12px] tabular-nums", due.cls)}>{due.text}</span>
            ) : (
              <span className="shrink-0 text-[12px] text-muted">
                Done {timeAgo(task.completedAt!)}
              </span>
            )}

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
              // Hidden until the row is hovered or the button is focused, so a
              // destructive control is not sitting on every row at rest —
              // still keyboard reachable, which opacity-0 alone would break.
              className="shrink-0 rounded-sm p-1 text-muted opacity-0 transition-opacity hover:bg-danger-muted hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
            >
              <Trash2 size={13} strokeWidth={1.75} aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
