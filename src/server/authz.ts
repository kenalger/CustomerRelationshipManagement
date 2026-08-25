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
