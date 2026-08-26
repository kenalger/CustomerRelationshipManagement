import { db } from "@/lib/db";
import { taskCreateSchema, taskListFilterSchema } from "@/lib/validation/tasks";
import { type Ctx, assignedTo, requireWrite, visibleTo } from "@/server/authz";
import { type Result, err, ok } from "@/server/result";
import { notify } from "@/server/services/notifications";

/** Buckets a due date the way a rep actually thinks about their day. */
export type TaskBucket = "overdue" | "today" | "upcoming" | "someday";

/**
 * "Today" is the *server's* calendar day.
 *
 * KNOWN LIMITATION: a rep in a different timezone to the server will see a
 * task roll into "Today" at the wrong local hour. Fixing it properly means
 * carrying the viewer's timezone (or bucketing in the browser), which is a
 * change to how tasks are fetched — tracked in plan/04-features/tasks/plan.md.
 * The tests below are written relative to `now` so they hold in any timezone.
 */
export function bucketFor(dueAt: Date | null, now = new Date()): TaskBucket {
  if (!dueAt) return "someday";

  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  if (dueAt < now) return "overdue";
  if (dueAt <= endOfToday) return "today";
  return "upcoming";
}

export async function listTasks(ctx: Ctx, rawFilter: unknown) {
  const filter = taskListFilterSchema.parse(rawFilter);

  const tasks = await db.task.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(filter.scope === "mine" ? { assigneeId: ctx.userId } : {}),
      ...(filter.state === "open" ? { completedAt: null } : { completedAt: { not: null } }),
      // Visibility last: a rep asking for scope "all" still only gets the
      // tasks assigned to them — the rule outranks the requested scope.
      ...assignedTo(ctx),
    },
    // Nulls last: an undated task is a someday, not the most urgent thing.
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: 200,
    select: {
      id: true,
      title: true,
      notes: true,
      dueAt: true,
      completedAt: true,
      createdAt: true,
      assignee: { select: { id: true, name: true, email: true } },
      contactId: true,
      dealId: true,
      leadId: true,
    },
  });

  /*
   * The record each task is about, resolved in three batched queries.
   *
   * `Task` carries bare `contactId`/`dealId`/`leadId` columns with no relation
   * fields — the same shape as `Activity` — so these cannot be `include`d.
   * Three queries for the whole page beats one per row, and without them the
   * list reads "Call Samir about pricing" with no way to know which Samir or
   * to open him. On a CRM that link is most of the value of the row.
   */
  const ids = (key: "contactId" | "dealId" | "leadId") =>
    [...new Set(tasks.map((t) => t[key]).filter((v): v is string => v !== null))];

  const [contacts, deals, leads] = await Promise.all([
    ids("contactId").length
      ? db.contact.findMany({
          where: { id: { in: ids("contactId") }, organizationId: ctx.organizationId },
          select: { id: true, firstName: true, lastName: true, company: { select: { name: true } } },
        })
      : [],
    ids("dealId").length
      ? db.deal.findMany({
          where: { id: { in: ids("dealId") }, organizationId: ctx.organizationId },
          select: { id: true, title: true },
        })
      : [],
    ids("leadId").length
      ? db.lead.findMany({
          where: { id: { in: ids("leadId") }, organizationId: ctx.organizationId },
          select: { id: true, firstName: true, lastName: true, companyName: true },
        })
      : [],
  ]);

  type Link = { kind: "contact" | "deal" | "lead"; id: string; label: string; sub: string | null };
  const linkFor = (task: (typeof tasks)[number]): Link | null => {
    if (task.contactId) {
      const c = contacts.find((row) => row.id === task.contactId);
      if (!c) return null;
      return {
        kind: "contact",
        id: c.id,
        label: [c.firstName, c.lastName].filter(Boolean).join(" "),
        sub: c.company?.name ?? null,
      };
    }
    if (task.dealId) {
      const d = deals.find((row) => row.id === task.dealId);
      return d ? { kind: "deal", id: d.id, label: d.title, sub: null } : null;
    }
    if (task.leadId) {
      const l = leads.find((row) => row.id === task.leadId);
      if (!l) return null;
      return {
        kind: "lead",
        id: l.id,
        label: [l.firstName, l.lastName].filter(Boolean).join(" ") || "Lead",
        sub: l.companyName,
      };
    }
    return null;
  };

  const now = new Date();
  return tasks.map((task) => ({
    ...task,
    bucket: bucketFor(task.dueAt, now),
    link: linkFor(task),
  }));
}

/** Tasks attached to one record, for its detail page. */
export async function listTasksFor(
  ctx: Ctx,
  link: { contactId?: string; dealId?: string; leadId?: string },
) {
  const tasks = await db.task.findMany({
    where: { organizationId: ctx.organizationId, ...link },
    orderBy: [{ completedAt: "asc" }, { dueAt: { sort: "asc", nulls: "last" } }],
    take: 50,
    select: {
      id: true,
      title: true,
      dueAt: true,
      completedAt: true,
      assignee: { select: { name: true, email: true } },
    },
  });

  const now = new Date();
  return tasks.map((task) => ({ ...task, bucket: bucketFor(task.dueAt, now) }));
}

export async function countOverdue(ctx: Ctx): Promise<number> {
  return db.task.count({
    where: {
      organizationId: ctx.organizationId,
      assigneeId: ctx.userId,
      completedAt: null,
      dueAt: { lt: new Date() },
    },
  });
}

export async function createTask(ctx: Ctx, raw: unknown): Promise<Result<{ id: string }>> {
  requireWrite(ctx);

  const parsed = taskCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return err("Check the highlighted fields", parsed.error.flatten().fieldErrors);
  }
  const input = parsed.data;

  // At most one linked record, and it has to be one of ours.
  const links = [input.contactId, input.dealId, input.leadId].filter(Boolean);
  if (links.length > 1) return err("A task can only be attached to one record");

  // Visibility as well as tenancy: attaching a task to a record you cannot
  // see would let a rep write into another rep's record.
  const scope = { organizationId: ctx.organizationId, deletedAt: null, ...visibleTo(ctx) };
  if (input.contactId) {
    const found = await db.contact.findFirst({ where: { id: input.contactId, ...scope }, select: { id: true } });
    if (!found) return err("That contact does not exist");
  }
  if (input.dealId) {
    const found = await db.deal.findFirst({ where: { id: input.dealId, ...scope }, select: { id: true } });
    if (!found) return err("That deal does not exist");
  }
  if (input.leadId) {
    const found = await db.lead.findFirst({ where: { id: input.leadId, ...scope }, select: { id: true } });
    if (!found) return err("That lead does not exist");
  }

  const assigneeId = input.assigneeId ?? ctx.userId;
  if (input.assigneeId) {
    const member = await db.user.findFirst({
      where: { id: input.assigneeId, organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!member) return err("That person is not on this team");
  }

  const task = await db.$transaction(async (tx) => {
    const created = await tx.task.create({
      data: {
        organizationId: ctx.organizationId,
        title: input.title,
        notes: input.notes,
        dueAt: input.dueAt ?? null,
        assigneeId,
        contactId: input.contactId ?? null,
        dealId: input.dealId ?? null,
        leadId: input.leadId ?? null,
      },
      select: { id: true, title: true },
    });

    // Only tell someone when it is not their own task — a notification for a
    // task you just wrote yourself is noise.
    if (assigneeId !== ctx.userId) {
      await notify(
        {
          organizationId: ctx.organizationId,
          userId: assigneeId,
          type: "LEAD_ASSIGNED",
          title: `Task assigned: ${created.title}`,
          body: input.dueAt ? `Due ${input.dueAt.toLocaleDateString()}` : null,
          entity: "Task",
          entityId: created.id,
        },
        tx,
      );
    }

    return created;
  });

  return ok({ id: task.id });
}

export async function setTaskDone(
  ctx: Ctx,
  taskId: string,
  done: boolean,
): Promise<Result<{ id: string }>> {
  requireWrite(ctx);

  const updated = await db.task.updateMany({
    where: { id: taskId, organizationId: ctx.organizationId },
    data: { completedAt: done ? new Date() : null },
  });
  if (updated.count === 0) return err("Task not found");

  return ok({ id: taskId });
}

export async function deleteTask(ctx: Ctx, taskId: string): Promise<Result<{ id: string }>> {
  requireWrite(ctx);

  const deleted = await db.task.deleteMany({
    where: { id: taskId, organizationId: ctx.organizationId },
  });
  if (deleted.count === 0) return err("Task not found");

  return ok({ id: taskId });
}
