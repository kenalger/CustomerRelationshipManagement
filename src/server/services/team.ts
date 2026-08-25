import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import bcrypt from "bcryptjs";

import { db } from "@/lib/db";
import { acceptInviteSchema, changeRoleSchema, inviteSchema } from "@/lib/validation/team";
import { type Ctx, requireRole } from "@/server/authz";
import { type Result, err, ok } from "@/server/result";
import { writeAudit } from "@/server/services/audit";

const INVITE_TTL_DAYS = 7;

/** Tokens are stored hashed. The raw value is shown to the admin exactly once. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function listTeam(ctx: Ctx) {
  const [members, invitations] = await Promise.all([
    db.user.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      orderBy: [{ role: "asc" }, { email: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        _count: { select: { ownedLeads: true, ownedDeals: true } },
      },
    }),
    db.invitation.findMany({
      where: { organizationId: ctx.organizationId, acceptedAt: null, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        role: true,
        expiresAt: true,
        createdAt: true,
        invitedBy: { select: { name: true, email: true } },
      },
    }),
  ]);

  return { members, invitations };
}

/**
 * Invites someone into the organization.
 *
 * Returns the raw token once. There is no email delivery yet, so the admin
 * copies the link — see plan/04-features/team/plan.md.
 */
export async function inviteMember(
  ctx: Ctx,
  raw: unknown,
): Promise<Result<{ id: string; token: string; email: string }>> {
  requireRole(ctx, "ADMIN");

  const parsed = inviteSchema.safeParse(raw);
  if (!parsed.success) {
    return err("Check the highlighted fields", parsed.error.flatten().fieldErrors);
  }
  const email = parsed.data.email.toLowerCase();

  const existing = await db.user.findFirst({
    where: { organizationId: ctx.organizationId, email, deletedAt: null },
    select: { id: true },
  });
  if (existing) return err("That person is already on the team");

  const token = randomBytes(32).toString("base64url");

  // Re-inviting replaces the outstanding invitation rather than erroring, and
  // invalidates the old link in the same step.
  const invitation = await db.$transaction(async (tx) => {
    const created = await tx.invitation.upsert({
      where: { organizationId_email: { organizationId: ctx.organizationId, email } },
      create: {
        organizationId: ctx.organizationId,
        email,
        role: parsed.data.role,
        tokenHash: hashToken(token),
        invitedById: ctx.userId,
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
      },
      update: {
        role: parsed.data.role,
        tokenHash: hashToken(token),
        invitedById: ctx.userId,
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
        acceptedAt: null,
        revokedAt: null,
      },
      select: { id: true },
    });

    await writeAudit(tx, ctx, {
      entity: "Invitation",
      entityId: created.id,
      action: "invite",
      after: { email, role: parsed.data.role },
    });

    return created;
  });

  return ok({ id: invitation.id, token, email });
}

export async function revokeInvitation(ctx: Ctx, id: string): Promise<Result<{ id: string }>> {
  requireRole(ctx, "ADMIN");

  const invitation = await db.invitation.findFirst({
    where: { id, organizationId: ctx.organizationId, acceptedAt: null, revokedAt: null },
    select: { id: true, email: true },
  });
  if (!invitation) return err("Invitation not found");

  await db.$transaction(async (tx) => {
    await tx.invitation.update({ where: { id }, data: { revokedAt: new Date() } });
    await writeAudit(tx, ctx, {
      entity: "Invitation",
      entityId: id,
      action: "revoke",
      before: { email: invitation.email },
    });
  });

  return ok({ id });
}

/** Shown on the accept page before the person commits to signing up. */
export async function describeInvitation(token: string) {
  if (!token) return null;

  const invitation = await db.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      email: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      organization: { select: { name: true } },
    },
  });

  if (!invitation) return null;
  if (invitation.acceptedAt || invitation.revokedAt) return null;
  if (invitation.expiresAt < new Date()) return null;

  return invitation;
}

/**
 * Redeems an invitation into a real user. Unauthenticated by nature — the
 * token IS the authorization, so it is single-use and time-limited, and the
 * organization comes from the invitation row rather than from any input.
 */
export async function acceptInvitation(
  raw: unknown,
): Promise<Result<{ email: string; organizationId: string }>> {
  const parsed = acceptInviteSchema.safeParse(raw);
  if (!parsed.success) {
    return err("Check the highlighted fields", parsed.error.flatten().fieldErrors);
  }

  const tokenHash = hashToken(parsed.data.token);
  const invitation = await db.invitation.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      organizationId: true,
      email: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
    },
  });

  if (!invitation) return err("That invitation link is not valid");
  if (invitation.revokedAt) return err("That invitation was revoked");
  if (invitation.acceptedAt) return err("That invitation has already been used");
  if (invitation.expiresAt < new Date()) return err("That invitation has expired");

  const alreadyMember = await db.user.findFirst({
    where: { organizationId: invitation.organizationId, email: invitation.email, deletedAt: null },
    select: { id: true },
  });
  if (alreadyMember) return err("That person is already on the team");

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);

  await db.$transaction(async (tx) => {
    await tx.user.create({
      data: {
        organizationId: invitation.organizationId,
        email: invitation.email,
        name: parsed.data.name,
        passwordHash,
        role: invitation.role,
      },
    });

    // Single-use: marked accepted in the same transaction that creates the
    // user, so a replayed link cannot create a second account.
    await tx.invitation.update({
      where: { id: invitation.id, acceptedAt: null },
      data: { acceptedAt: new Date() },
    });
  });

  return ok({ email: invitation.email, organizationId: invitation.organizationId });
}

export async function changeMemberRole(ctx: Ctx, raw: unknown): Promise<Result<{ id: string }>> {
  requireRole(ctx, "ADMIN");

  const parsed = changeRoleSchema.safeParse(raw);
  if (!parsed.success) return err("Pick a valid role");

  const target = await db.user.findFirst({
    where: { id: parsed.data.userId, organizationId: ctx.organizationId, deletedAt: null },
    select: { id: true, role: true },
  });
  if (!target) return err("Member not found");

  // Nobody demotes themselves out of the ability to undo it.
  if (target.id === ctx.userId) return err("You cannot change your own role");
  // An OWNER outranks an ADMIN; only another OWNER may act on one.
  if (target.role === "OWNER" && ctx.role !== "OWNER") {
    return err("Only an owner can change an owner's role");
  }

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: target.id }, data: { role: parsed.data.role } });
    await writeAudit(tx, ctx, {
      entity: "User",
      entityId: target.id,
      action: "change_role",
      before: { role: target.role },
      after: { role: parsed.data.role },
    });
  });

  return ok({ id: target.id });
}

export async function deactivateMember(ctx: Ctx, userId: string): Promise<Result<{ id: string }>> {
  requireRole(ctx, "ADMIN");

  const target = await db.user.findFirst({
    where: { id: userId, organizationId: ctx.organizationId, deletedAt: null },
    select: { id: true, role: true },
  });
  if (!target) return err("Member not found");
  if (target.id === ctx.userId) return err("You cannot deactivate yourself");
  if (target.role === "OWNER" && ctx.role !== "OWNER") {
    return err("Only an owner can deactivate an owner");
  }

  // An organization with no owner cannot be administered back to health.
  if (target.role === "OWNER") {
    const owners = await db.user.count({
      where: { organizationId: ctx.organizationId, deletedAt: null, role: "OWNER" },
    });
    if (owners <= 1) return err("Promote another owner before deactivating the last one");
  }

  await db.$transaction(async (tx) => {
    // Soft delete: their name still resolves on the records they touched.
    await tx.user.update({ where: { id: target.id }, data: { deletedAt: new Date() } });
    await writeAudit(tx, ctx, { entity: "User", entityId: target.id, action: "deactivate" });
  });

  return ok({ id: target.id });
}

/** Constant-time compare, exported for the tests that prove tokens are hashed. */
export function tokenMatches(raw: string, hash: string): boolean {
  const computed = hashToken(raw);
  if (computed.length !== hash.length) return false;
  return timingSafeEqual(Buffer.from(computed), Buffer.from(hash));
}
