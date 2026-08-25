import { CheckSquare } from "lucide-react";
import Link from "next/link";

import { AddTaskForm } from "@/components/crm/add-task-form";
import { TaskList } from "@/components/crm/task-list";
import { PageHeader } from "@/components/page-header";
import { db } from "@/lib/db";
import { cn } from "@/lib/utils";
import { requireCtx } from "@/server/context";
import { listTasks } from "@/server/services/tasks";

export const metadata = { title: "Tasks · CRM" };

const TABS = [
  { label: "Mine", scope: "mine", state: "open" },
  { label: "Everyone", scope: "all", state: "open" },
  { label: "Done", scope: "mine", state: "done" },
] as const;

export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const scope = sp.scope === "all" ? "all" : "mine";
  const state = sp.state === "done" ? "done" : "open";

  const [tasks, team] = await Promise.all([
    listTasks(ctx, { scope, state }),
    db.user.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true, name: true, email: true },
      orderBy: { email: "asc" },
    }),
  ]);

  // Grouped the way a rep works a day, rather than one flat list.
  const groups = (
    [
      ["Overdue", "overdue"],
      ["Today", "today"],
      ["Upcoming", "upcoming"],
      ["No date", "someday"],
    ] as const
  )
    .map(([label, bucket]) => ({ label, tasks: tasks.filter((t) => t.bucket === bucket) }))
    .filter((group) => group.tasks.length > 0);

  return (
    <>
      <PageHeader
        title="Tasks"
        description={
          state === "done"
            ? `${tasks.length} completed`
            : `${tasks.length} open${tasks.filter((t) => t.bucket === "overdue").length > 0 ? ` · ${tasks.filter((t) => t.bucket === "overdue").length} overdue` : ""}`
        }
      />

      <div className="mx-auto w-full max-w-4xl space-y-6 p-8">
        <div className="flex items-center gap-1 rounded-lg border border-border-subtle bg-surface p-0.5">
          {TABS.map((tab) => {
            const active = scope === tab.scope && state === tab.state;
            return (
              <Link
                key={tab.label}
                href={`/tasks?scope=${tab.scope}&state=${tab.state}`}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[12px] transition-colors duration-100",
                  active
                    ? "bg-accent-soft font-medium text-accent"
                    : "text-secondary hover:text-foreground",
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>

        <div className="rounded-lg bg-surface">
          {groups.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-10 text-center">
              <span className="mb-3 flex size-9 items-center justify-center rounded-lg bg-success-muted text-success">
                <CheckSquare size={17} strokeWidth={1.75} aria-hidden />
              </span>
              <p className="text-[13px] font-medium">
                {state === "done" ? "Nothing completed yet" : "Nothing on your list"}
              </p>
              <p className="mt-1 text-[12px] text-muted">
                {state === "done"
                  ? "Completed tasks will collect here."
                  : "Add a follow-up below, or from any contact or deal."}
              </p>
            </div>
          ) : (
            groups.map((group) => (
              <section key={group.label}>
                <h2 className="border-b border-border-subtle bg-sunken px-4 py-1.5 text-[12px] font-medium uppercase tracking-[0.06em] text-muted">
                  {group.label}{" "}
                  <span className="tabular-nums">({group.tasks.length})</span>
                </h2>
                <TaskList tasks={group.tasks} showAssignee={scope === "all"} />
              </section>
            ))
          )}

          {state === "open" ? (
            <AddTaskForm
              assignees={team.map((u) => ({ id: u.id, name: u.name ?? u.email }))}
            />
          ) : null}
        </div>
      </div>
    </>
  );
}
