import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { createContact } from "@/server/services/contacts";
import { createDeal } from "@/server/services/deals";
import {
  bucketFor,
  countOverdue,
  createTask,
  deleteTask,
  listTasks,
  listTasksFor,
  setTaskDone,
} from "@/server/services/tasks";
import { dropOrg, makeOrg } from "./factories";

describe("due-date bucketing", () => {
  // Anchored to local noon and expressed as offsets, so these hold in any
  // timezone — `bucketFor` uses the server's calendar day, and UTC literals
  // would straddle midnight differently depending on where it runs.
  const now = new Date();
  now.setHours(12, 0, 0, 0);

  const offset = (ms: number) => new Date(now.getTime() + ms);
  const HOUR = 3_600_000;
  const DAY = 86_400_000;

  it("sorts a date into the bucket a rep would expect", () => {
    expect(bucketFor(offset(-DAY), now)).toBe("overdue");
    expect(bucketFor(offset(6 * HOUR), now)).toBe("today");
    expect(bucketFor(offset(2 * DAY), now)).toBe("upcoming");
    expect(bucketFor(null, now)).toBe("someday");
  });

  it("treats a time earlier today as overdue, not today", () => {
    // 9am when it is noon has already been missed.
    expect(bucketFor(offset(-3 * HOUR), now)).toBe("overdue");
  });

  it("keeps the last minute of today out of upcoming", () => {
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 0, 0);
    expect(bucketFor(endOfDay, now)).toBe("today");
  });
});

describe("tasks", () => {
  let org: Awaited<ReturnType<typeof makeOrg>>;
  let other: Awaited<ReturnType<typeof makeOrg>>;
  let contactId: string;
  let colleagueId: string;

  beforeAll(async () => {
    org = await makeOrg();
    other = await makeOrg();

    const contact = await createContact(org.ctx, { firstName: "Task", lastName: "Target" });
    if (!contact.ok) throw new Error(contact.error);
    contactId = contact.data.id;

    const colleague = await db.user.create({
      data: {
        organizationId: org.org.id,
        email: `colleague-${org.org.id}@test.local`,
        role: "REP",
        passwordHash: "x",
      },
    });
    colleagueId = colleague.id;
  });

  afterAll(async () => {
    await dropOrg(org.org.id);
    await dropOrg(other.org.id);
    await db.$disconnect();
  });

  it("assigns to the creator by default", async () => {
    const result = await createTask(org.ctx, { title: "Call them back" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const task = await db.task.findUniqueOrThrow({ where: { id: result.data.id } });
    expect(task.assigneeId).toBe(org.user.id);
  });

  it("does not notify you about your own task", async () => {
    const before = await db.notification.count({ where: { userId: org.user.id } });
    await createTask(org.ctx, { title: "My own reminder" });
    const after = await db.notification.count({ where: { userId: org.user.id } });

    // A notification for a task you just wrote yourself is pure noise.
    expect(after).toBe(before);
  });

  it("notifies the assignee when the task is for somebody else", async () => {
    const result = await createTask(org.ctx, {
      title: "Chase the proposal",
      assigneeId: colleagueId,
    });
    expect(result.ok).toBe(true);

    const notification = await db.notification.findFirst({
      where: { userId: colleagueId, entity: "Task" },
    });
    expect(notification?.title).toBe("Task assigned: Chase the proposal");
  });

  it("attaches to a record and shows up on it", async () => {
    const result = await createTask(org.ctx, { title: "Send the deck", contactId });
    expect(result.ok).toBe(true);

    const onRecord = await listTasksFor(org.ctx, { contactId });
    expect(onRecord.map((t) => t.title)).toContain("Send the deck");
  });

  it("refuses more than one linked record", async () => {
    const deal = await createDeal(org.ctx, { title: "Linked deal", value: 1, currency: "USD" });
    if (!deal.ok) throw new Error(deal.error);

    const result = await createTask(org.ctx, {
      title: "Ambiguous",
      contactId,
      dealId: deal.data.id,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/only be attached to one/i);
  });

  it("rejects a record from another organization", async () => {
    const theirContact = await createContact(other.ctx, { firstName: "Theirs" });
    if (!theirContact.ok) throw new Error(theirContact.error);

    const result = await createTask(org.ctx, {
      title: "Crafted",
      contactId: theirContact.data.id,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/does not exist/i);
  });

  it("rejects an assignee who is not on the team", async () => {
    const result = await createTask(org.ctx, {
      title: "Crafted assignee",
      assigneeId: other.user.id,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not on this team/i);
  });

  it("completes and reopens", async () => {
    const created = await createTask(org.ctx, { title: "Toggle me" });
    if (!created.ok) throw new Error(created.error);

    await setTaskDone(org.ctx, created.data.id, true);
    let task = await db.task.findUniqueOrThrow({ where: { id: created.data.id } });
    expect(task.completedAt).not.toBeNull();

    await setTaskDone(org.ctx, created.data.id, false);
    task = await db.task.findUniqueOrThrow({ where: { id: created.data.id } });
    expect(task.completedAt).toBeNull();
  });

  it("counts only my own overdue tasks", async () => {
    const mine = await createTask(org.ctx, { title: "Late one" });
    if (!mine.ok) throw new Error(mine.error);
    await db.task.update({
      where: { id: mine.data.id },
      data: { dueAt: new Date(Date.now() - 86_400_000) },
    });

    const theirs = await createTask(org.ctx, { title: "Their late one", assigneeId: colleagueId });
    if (!theirs.ok) throw new Error(theirs.error);
    await db.task.update({
      where: { id: theirs.data.id },
      data: { dueAt: new Date(Date.now() - 86_400_000) },
    });

    expect(await countOverdue(org.ctx)).toBe(1);
  });

  it("puts undated tasks last, not first", async () => {
    const open = await listTasks(org.ctx, { scope: "mine", state: "open" });
    const lastDated = open.findLastIndex((t) => t.dueAt !== null);
    const firstUndated = open.findIndex((t) => t.dueAt === null);
    if (lastDated !== -1 && firstUndated !== -1) {
      expect(firstUndated).toBeGreaterThan(lastDated);
    }
  });

  it("separates mine from everyone", async () => {
    const mine = await listTasks(org.ctx, { scope: "mine", state: "open" });
    const all = await listTasks(org.ctx, { scope: "all", state: "open" });
    expect(all.length).toBeGreaterThan(mine.length);
    expect(mine.every((t) => t.assignee?.id === org.user.id)).toBe(true);
  });

  describe("tenant isolation", () => {
    it("does not list another org's tasks", async () => {
      const theirs = await listTasks(other.ctx, { scope: "all", state: "open" });
      expect(theirs).toHaveLength(0);
    });

    it("cannot complete another org's task", async () => {
      const created = await createTask(org.ctx, { title: "Protected" });
      if (!created.ok) throw new Error(created.error);

      const result = await setTaskDone(other.ctx, created.data.id, true);
      expect(result.ok).toBe(false);

      const task = await db.task.findUniqueOrThrow({ where: { id: created.data.id } });
      expect(task.completedAt).toBeNull();
    });

    it("cannot delete another org's task", async () => {
      const created = await createTask(org.ctx, { title: "Also protected" });
      if (!created.ok) throw new Error(created.error);

      const result = await deleteTask(other.ctx, created.data.id);
      expect(result.ok).toBe(false);
      expect(await db.task.count({ where: { id: created.data.id } })).toBe(1);
    });
  });

  it("a READ_ONLY user cannot create a task", async () => {
    const readOnly = { ...org.ctx, role: "READ_ONLY" as const };
    await expect(createTask(readOnly, { title: "Nope" })).rejects.toThrow(/permission/i);
  });
});
