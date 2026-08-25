import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { NotificationType, Role } from "@/generated/prisma/enums";
import type { Ctx } from "@/server/authz";
import { type Result, err, ok } from "@/server/result";

/**
 * Notifications are written from unauthenticated contexts — the Facebook
 * webhook and the cron sweeper have no session — so every function here takes
 * explicit ids. Reading is session-scoped and lives at the bottom.
 *
 * In-app only for now. `notify()` is the single choke point, so adding email
 * or Slack later is one function to change, not a scatter of call sites.
 */

export type NotifyInput = {
  organizationId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  entity?: string | null;
  entityId?: string | null;
  /**
   * When set, no new notification is created while an UNREAD one with the same
   * key exists for this user. Reading it re-arms the alert.
   */
  dedupeKey?: string | null;
};

type Client = Prisma.TransactionClient | typeof db;

/** Returns the notification id, or null when suppressed as a duplicate. */
export async function notify(input: NotifyInput, client: Client = db): Promise<string | null> {
  if (input.dedupeKey) {
    const outstanding = await client.notification.findFirst({
      where: {
        organizationId: input.organizationId,
        userId: input.userId,
        dedupeKey: input.dedupeKey,
        readAt: null,
      },
      select: { id: true },
    });
    if (outstanding) return null;
  }

  const created = await client.notification.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      entity: input.entity ?? null,
      entityId: input.entityId ?? null,
      dedupeKey: input.dedupeKey ?? null,
    },
    select: { id: true },
  });

  return created.id;
}

const ADMIN_ROLES: Role[] = ["OWNER", "ADMIN"];

/**
 * Fans a notification out to everyone who can actually act on it.
 *
 * Used for integration failures: telling a rep their Facebook token expired is
 * noise, because they cannot fix it.
 */
export async function notifyAdmins(
  input: Omit<NotifyInput, "userId">,
  client: Client = db,
): Promise<number> {
  const admins = await client.user.findMany({
    where: { organizationId: input.organizationId, deletedAt: null, role: { in: ADMIN_ROLES } },
    select: { id: true },
  });

  let sent = 0;
  for (const admin of admins) {
    const id = await notify({ ...input, userId: admin.id }, client);
    if (id) sent++;
  }
  return sent;
}

// ─────────────────────────── reading (session-scoped) ───────────────────────────

export async function unreadCount(ctx: Ctx): Promise<number> {
  return db.notification.count({
    where: { organizationId: ctx.organizationId, userId: ctx.userId, readAt: null },
  });
}

export async function listNotifications(ctx: Ctx, limit = 50) {
  return db.notification.findMany({
    // Scoped by BOTH org and user: a notification is addressed to one person,
    // and org scoping alone would leak a colleague's alerts.
    where: { organizationId: ctx.organizationId, userId: ctx.userId },
    orderBy: [{ readAt: "asc" }, { createdAt: "desc" }],
    take: limit,
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      entity: true,
      entityId: true,
      readAt: true,
      createdAt: true,
    },
  });
}

export async function markRead(ctx: Ctx, id: string): Promise<Result<{ id: string }>> {
  const updated = await db.notification.updateMany({
    where: { id, organizationId: ctx.organizationId, userId: ctx.userId, readAt: null },
    data: { readAt: new Date() },
  });
  if (updated.count === 0) return err("Notification not found");
  return ok({ id });
}

export async function markAllRead(ctx: Ctx): Promise<Result<{ count: number }>> {
  const updated = await db.notification.updateMany({
    where: { organizationId: ctx.organizationId, userId: ctx.userId, readAt: null },
    data: { readAt: new Date() },
  });
  return ok({ count: updated.count });
}
