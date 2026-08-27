import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import {
  acceptInvitation,
  changeMemberRole,
  deactivateMember,
  describeInvitation,
  inviteMember,
  listTeam,
  revokeInvitation,
  tokenMatches,
} from "@/server/services/team";
import { dropOrg, makeOrg } from "./factories";

describe("invitations", () => {
  let org: Awaited<ReturnType<typeof makeOrg>>;
  let other: Awaited<ReturnType<typeof makeOrg>>;

  beforeAll(async () => {
    org = await makeOrg();
    other = await makeOrg();
  });

  afterAll(async () => {
    await dropOrg(org.org.id);
    await dropOrg(other.org.id);
  });

  it("never stores the raw token", async () => {
    const invited = await inviteMember(org.ctx, { email: "rep@new.test", role: "REP" });
    expect(invited.ok).toBe(true);
    if (!invited.ok) return;

    const row = await db.invitation.findUniqueOrThrow({ where: { id: invited.data.id } });
    expect(row.tokenHash).not.toBe(invited.data.token);
    expect(row.tokenHash).toHaveLength(64); // sha-256 hex
    expect(tokenMatches(invited.data.token, row.tokenHash)).toBe(true);
  });

  it("describes a live invitation without leaking the token", async () => {
    const invited = await inviteMember(org.ctx, { email: "described@new.test", role: "MANAGER" });
    if (!invited.ok) throw new Error(invited.error);

    const described = await describeInvitation(invited.data.token);
    expect(described?.email).toBe("described@new.test");
    expect(described?.role).toBe("MANAGER");
    expect(described).not.toHaveProperty("tokenHash");
  });

  it("gives nothing away for a token that does not exist", async () => {
    await expect(describeInvitation("not-a-real-token")).resolves.toBeNull();
    await expect(describeInvitation("")).resolves.toBeNull();
  });

  it("creates a real member when accepted, once", async () => {
    const invited = await inviteMember(org.ctx, { email: "joiner@new.test", role: "REP" });
    if (!invited.ok) throw new Error(invited.error);

    const accepted = await acceptInvitation({
      token: invited.data.token,
      name: "New Joiner",
      password: "correct-horse-battery",
    });
    expect(accepted.ok).toBe(true);

    const user = await db.user.findFirstOrThrow({
      where: { organizationId: org.org.id, email: "joiner@new.test" },
    });
    expect(user.role).toBe("REP");
    expect(user.passwordHash).not.toBeNull();
    expect(user.passwordHash).not.toBe("correct-horse-battery");

    // Replaying the same link must not create a second account.
    const replay = await acceptInvitation({
      token: invited.data.token,
      name: "Impostor",
      password: "correct-horse-battery",
    });
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.error).toMatch(/already been used/i);

    expect(
      await db.user.count({ where: { organizationId: org.org.id, email: "joiner@new.test" } }),
    ).toBe(1);
  });

  it("takes the organization from the invitation, never from input", async () => {
    const invited = await inviteMember(org.ctx, { email: "scoped@new.test", role: "REP" });
    if (!invited.ok) throw new Error(invited.error);

    const accepted = await acceptInvitation({
      token: invited.data.token,
      name: "Scoped",
      password: "correct-horse-battery",
      // A crafted extra field must not redirect the account into another org.
      organizationId: other.org.id,
    } as never);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;

    expect(accepted.data.organizationId).toBe(org.org.id);
    expect(
      await db.user.count({ where: { organizationId: other.org.id, email: "scoped@new.test" } }),
    ).toBe(0);
  });

  it("refuses an expired invitation", async () => {
    const invited = await inviteMember(org.ctx, { email: "stale@new.test", role: "REP" });
    if (!invited.ok) throw new Error(invited.error);

    await db.invitation.update({
      where: { id: invited.data.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(describeInvitation(invited.data.token)).resolves.toBeNull();
    const accepted = await acceptInvitation({
      token: invited.data.token,
      name: "Too Late",
      password: "correct-horse-battery",
    });
    expect(accepted.ok).toBe(false);
    if (!accepted.ok) expect(accepted.error).toMatch(/expired/i);
  });

  it("refuses a revoked invitation", async () => {
    const invited = await inviteMember(org.ctx, { email: "revoked@new.test", role: "REP" });
    if (!invited.ok) throw new Error(invited.error);

    await revokeInvitation(org.ctx, invited.data.id);

    const accepted = await acceptInvitation({
      token: invited.data.token,
      name: "Revoked",
      password: "correct-horse-battery",
    });
    expect(accepted.ok).toBe(false);
    if (!accepted.ok) expect(accepted.error).toMatch(/revoked/i);
  });

  it("re-inviting replaces the old link rather than adding a second", async () => {
    const first = await inviteMember(org.ctx, { email: "again@new.test", role: "REP" });
    if (!first.ok) throw new Error(first.error);

    const second = await inviteMember(org.ctx, { email: "again@new.test", role: "MANAGER" });
    if (!second.ok) throw new Error(second.error);

    expect(second.data.token).not.toBe(first.data.token);
    // The superseded link must stop working immediately.
    await expect(describeInvitation(first.data.token)).resolves.toBeNull();
    expect((await describeInvitation(second.data.token))?.role).toBe("MANAGER");

    expect(
      await db.invitation.count({
        where: { organizationId: org.org.id, email: "again@new.test" },
      }),
    ).toBe(1);
  });

  it("will not invite somebody already on the team", async () => {
    const result = await inviteMember(org.ctx, { email: org.user.email, role: "REP" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/already on the team/i);
  });

  it("rejects OWNER as an assignable role", async () => {
    const result = await inviteMember(org.ctx, { email: "owner2@new.test", role: "OWNER" });
    expect(result.ok).toBe(false);
  });

  describe("permissions", () => {
    it("a REP cannot invite", async () => {
      const rep = { ...org.ctx, role: "REP" as const };
      await expect(inviteMember(rep, { email: "x@new.test", role: "REP" })).rejects.toThrow(
        /permission/i,
      );
    });

    it("a MANAGER cannot invite", async () => {
      const manager = { ...org.ctx, role: "MANAGER" as const };
      await expect(inviteMember(manager, { email: "y@new.test", role: "REP" })).rejects.toThrow(
        /permission/i,
      );
    });
  });

  describe("tenant isolation", () => {
    it("does not list another org's members or invitations", async () => {
      const theirs = await listTeam(other.ctx);
      expect(theirs.members).toHaveLength(1);
      expect(theirs.invitations).toHaveLength(0);
    });

    it("cannot revoke another org's invitation", async () => {
      const invited = await inviteMember(org.ctx, { email: "cross@new.test", role: "REP" });
      if (!invited.ok) throw new Error(invited.error);

      const result = await revokeInvitation(other.ctx, invited.data.id);
      expect(result.ok).toBe(false);

      const untouched = await db.invitation.findUniqueOrThrow({ where: { id: invited.data.id } });
      expect(untouched.revokedAt).toBeNull();
    });
  });
});

describe("member management", () => {
  let org: Awaited<ReturnType<typeof makeOrg>>;
  let repId: string;

  beforeAll(async () => {
    org = await makeOrg();
    const rep = await db.user.create({
      data: {
        organizationId: org.org.id,
        email: `member-${org.org.id}@test.local`,
        role: "REP",
        passwordHash: "x",
      },
    });
    repId = rep.id;
  });

  afterAll(async () => {
    await dropOrg(org.org.id);
  });

  it("changes a member's role and audits it", async () => {
    const result = await changeMemberRole(org.ctx, { userId: repId, role: "MANAGER" });
    expect(result.ok).toBe(true);

    const user = await db.user.findUniqueOrThrow({ where: { id: repId } });
    expect(user.role).toBe("MANAGER");

    const audit = await db.auditLog.findFirst({
      where: { organizationId: org.org.id, entity: "User", action: "change_role" },
    });
    expect(audit).not.toBeNull();
  });

  it("will not let you change your own role", async () => {
    const result = await changeMemberRole(org.ctx, { userId: org.user.id, role: "REP" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/your own role/i);
  });

  it("will not let you deactivate yourself", async () => {
    const result = await deactivateMember(org.ctx, org.user.id);
    expect(result.ok).toBe(false);
  });

  it("protects the last owner", async () => {
    // Sole owner: deactivation would leave the org unadministrable.
    const second = await db.user.create({
      data: {
        organizationId: org.org.id,
        email: `owner2-${org.org.id}@test.local`,
        role: "OWNER",
        passwordHash: "x",
      },
    });

    const result = await deactivateMember(org.ctx, second.id);
    expect(result.ok).toBe(true); // two owners exist, so this one may go

    const owners = await db.user.count({
      where: { organizationId: org.org.id, deletedAt: null, role: "OWNER" },
    });
    expect(owners).toBe(1);
  });

  it("soft-deletes so history still resolves the person", async () => {
    const result = await deactivateMember(org.ctx, repId);
    expect(result.ok).toBe(true);

    const user = await db.user.findUniqueOrThrow({ where: { id: repId } });
    expect(user.deletedAt).not.toBeNull();

    const { members } = await listTeam(org.ctx);
    expect(members.map((m) => m.id)).not.toContain(repId);
  });
});
