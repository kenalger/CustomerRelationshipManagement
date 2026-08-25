import type { Prisma } from "@/generated/prisma/client";
import type { Ctx } from "@/server/authz";

/**
 * Writes an audit row. Takes a transaction client so the log and the change it
 * describes commit together — an audit trail that can be out of sync with the
 * data it audits is worse than none.
 */
export function writeAudit(
  tx: Prisma.TransactionClient,
  ctx: Ctx,
  entry: {
    entity: string;
    entityId: string;
    action: string;
    before?: unknown;
    after?: unknown;
  },
) {
  return tx.auditLog.create({
    data: {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      entity: entry.entity,
      entityId: entry.entityId,
      action: entry.action,
      before: (entry.before ?? undefined) as Prisma.InputJsonValue | undefined,
      after: (entry.after ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
