import type { Role } from "@/generated/prisma/enums";

/**
 * Pure authorization primitives — no Next.js, no Auth.js, no database.
 *
 * Services depend on this module, never on `context.ts`. That keeps the
 * business layer testable in plain Node and makes the tenant rules readable
 * without tracing through session plumbing.
 */

/**
 * The caller's identity and tenant. Every service function takes this as its
 * first argument and scopes every query by `organizationId`.
 *
 * organizationId originates from the signed session token — NEVER from a
 * request body, query string, or header.
 */
export type Ctx = {
  userId: string;
  organizationId: string;
  role: Role;
};

const RANK: Record<Role, number> = {
  READ_ONLY: 0,
  REP: 1,
  MANAGER: 2,
  ADMIN: 3,
  OWNER: 4,
};

export function hasRole(ctx: Ctx, minimum: Role): boolean {
  return RANK[ctx.role] >= RANK[minimum];
}

export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to do that") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Throws unless the caller meets the minimum role. Server-side only. */
export function requireRole(ctx: Ctx, minimum: Role): void {
  if (!hasRole(ctx, minimum)) throw new ForbiddenError();
}

/** Read-only roles must never reach a mutation. */
export function requireWrite(ctx: Ctx): void {
  requireRole(ctx, "REP");
}

/**
 * Deleting records is a MANAGER-and-above action.
 *
 * A rep can create, edit and work their own records but cannot remove one.
 * Applies to single and bulk deletes alike — a rule that a rep can dodge by
 * deleting one at a time is not a rule.
 */
export function requireDelete(ctx: Ctx): void {
  requireRole(ctx, "MANAGER");
}

/**
 * Whether this role sees every record in the organization.
 *
 * REP is the only role scoped to its own records. READ_ONLY is deliberately
 * NOT scoped: it is an oversight role — a manager, exec or auditor who should
 * see everything and change nothing — and scoping it to "records you own"
 * would make it useless, since such a user owns nothing.
 *
 * This is a capability, not a rank, which is why it is not expressed as a
 * `RANK` comparison.
 */
export function seesAllRecords(ctx: Ctx): boolean {
  return ctx.role !== "REP";
}

/**
 * A Prisma `where` fragment restricting a query to what the caller may see.
 *
 * Spread it alongside the tenant filter — it NEVER replaces `organizationId`,
 * which stays mandatory on every query.
 *
 *   where: { organizationId: ctx.organizationId, ...visibleTo(ctx) }
 */
export function visibleTo(ctx: Ctx): { ownerId?: string } {
  return seesAllRecords(ctx) ? {} : { ownerId: ctx.userId };
}

/**
 * Same rule for tasks, which are assigned rather than owned.
 */
export function assignedTo(ctx: Ctx): { assigneeId?: string } {
  return seesAllRecords(ctx) ? {} : { assigneeId: ctx.userId };
}
