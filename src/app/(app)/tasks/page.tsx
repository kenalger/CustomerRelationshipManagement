import { CalendarClock, CalendarDays, CheckCircle2, CheckSquare, Flame } from "lucide-react";
import Link from "next/link";

import { AddTaskForm } from "@/components/crm/add-task-form";
import { TaskList } from "@/components/crm/task-list";
import { PageHeader } from "@/components/page-header";
import { PageToolbar } from "@/components/page-toolbar";
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

/**
 * The buckets, in the order a day is actually worked.
 *
 * Each carries its own icon and tone, so the page has a shape you can read
 * from across the desk rather than one undifferentiated list where a task due
 * in three weeks sits directly under one that is four days late.
 */
const GROUPS = [
  {
    bucket: "overdue",
    label: "Overdue",
    hint: "Late. These come first.",
    Icon: Flame,
    tone: "border-danger/30 bg-danger-muted text-danger",
  },
  {
    bucket: "today",
    label: "Today",
    hint: "Due before the day is out.",
    Icon: CalendarClock,
    tone: "border-warning/30 bg-warning-muted text-warning",
  },
  {
    bucket: "upcoming",
    label: "Upcoming",
    hint: "Scheduled, not yet urgent.",
    Icon: CalendarDays,
    tone: "border-border-subtle bg-sunken text-secondary",
  },
  {
    bucket: "someday",
    label: "No date",
    hint: "Nothing is chasing these.",
    Icon: CheckSquare,
    tone: "border-border-subtle bg-sunken text-secondary",
  },
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

  const count = (bucket: string) => tasks.filter((t) => t.bucket === bucket).length;
  const groups = GROUPS.map((group) => ({
    ...group,
    tasks: tasks.filter((t) => t.bucket === group.bucket),
  })).filter((group) => group.tasks.length > 0);

  /*
   * The strip is counts, not decoration. Each number is the same figure the
   * group header below shows, so the top of the page answers "what does today
   * look like" without scrolling, and nothing on it can disagree with the list.
   */
  const summary = [
    { label: "Overdue", value: count("overdue"), Icon: Flame, alert: count("overdue") > 0 },
    { label: "Due today", value: count("today"), Icon: CalendarClock, alert: false },
    { label: "Upcoming", value: count("upcoming"), Icon: CalendarDays, alert: false },
    { label: "No date", value: count("someday"), Icon: CheckSquare, alert: false },
  ];

  return (
    <>
      <PageHeader
        title="Tasks"
        description={
          state === "done"
            ? `${tasks.length} completed`
            : count("overdue") > 0
              ? `${tasks.length} open · ${count("overdue")} late`
              : `${tasks.length} open`
        }
      />

      <div className="mx-auto w-full max-w-4xl space-y-6 p-8">
        <PageToolbar
          filters={
            <div className="flex items-center gap-1 rounded-lg border border-border-subtle bg-surface p-0.5">
              {TABS.map((tab) => {
                const active = scope === tab.scope && state === tab.state;
                return (
                  <Link
                    key={tab.label}
                    href={`/tasks?scope=${tab.scope}&state=${tab.state}`}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-[13px] transition-colors duration-100",
                      active
                        ? "bg-accent-soft font-[560] text-accent"
                        : "text-secondary hover:text-foreground",
                    )}
                  >
                    {tab.label}
                  </Link>
                );
              })}
            </div>
          }
        />

        {state === "open" ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {summary.map((tile) => (
              <div
                key={tile.label}
                className={cn(
                  "rounded-md border bg-surface px-4 py-3",
                  tile.alert ? "border-danger/30" : "border-border-subtle",
                )}
              >
                <span className="flex items-center gap-1.5">
                  <tile.Icon
                    size={13}
                    strokeWidth={2}
                    aria-hidden
                    className={tile.alert ? "text-danger" : "text-muted"}
                  />
                  <span className="t-caps text-muted">{tile.label}</span>
                </span>
                <p
                  className={cn(
                    "mt-1 text-[24px] font-[590] leading-8 tabular-nums",
                    tile.alert ? "text-danger" : "text-foreground",
                  )}
                >
                  {tile.value}
                </p>
              </div>
            ))}
          </div>
        ) : null}

        {state === "open" ? (
          <div className="rounded-md border border-border-subtle bg-surface">
            <AddTaskForm assignees={team.map((u) => ({ id: u.id, name: u.name ?? u.email }))} />
          </div>
        ) : null}

        {groups.length === 0 ? (
          <div className="flex flex-col items-center rounded-md border border-dashed border-border-subtle-strong bg-surface px-6 py-14 text-center">
            <span className="mb-3 flex size-10 items-center justify-center rounded-lg bg-success-muted text-success">
              <CheckCircle2 size={19} strokeWidth={1.75} aria-hidden />
            </span>
            <p className="text-[14px] font-[560]">
              {state === "done" ? "Nothing completed yet" : "Nothing on your list"}
            </p>
            <p className="mt-1 max-w-sm text-[13px] text-muted">
              {state === "done"
                ? "Completed tasks collect here, newest first."
                : "Add one above, or from any contact, lead or deal — a task made there stays attached to the record."}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <section
                key={group.bucket}
                className="overflow-hidden rounded-md border border-border-subtle bg-surface"
              >
                <header
                  className={cn(
                    "flex items-center justify-between gap-3 border-b px-5 py-2.5",
                    group.tone,
                  )}
                >
                  <span className="flex items-center gap-2">
                    <group.Icon size={14} strokeWidth={2} aria-hidden />
                    <span className="text-[13px] font-[590]">{group.label}</span>
                    <span className="text-[12px] opacity-70">{group.hint}</span>
                  </span>
                  <span className="text-[13px] font-[590] tabular-nums">{group.tasks.length}</span>
                </header>
                <TaskList tasks={group.tasks} showAssignee={scope === "all"} />
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
