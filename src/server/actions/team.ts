"use server";

import { revalidatePath } from "next/cache";

import { signIn } from "@/auth";
import { ForbiddenError } from "@/server/authz";
import { requireCtx } from "@/server/context";
import { type Result, err } from "@/server/result";
import {
  acceptInvitation,
  changeMemberRole,
  deactivateMember,
  inviteMember,
  revokeInvitation,
} from "@/server/services/team";

export type TeamActionState = {
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string[]>;
  /** Shown once, then gone — there is no email delivery yet. */
  inviteLink?: string;
};

async function guarded<T>(fn: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ForbiddenError) return err(error.message);
    throw error;
  }
}

export async function inviteMemberAction(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const ctx = await requireCtx();

  const result = await guarded(() =>
    inviteMember(ctx, {
      email: formData.get("email") ?? "",
      role: formData.get("role") ?? "REP",
    }),
  );
  if (!result.ok) return { error: result.error, fieldErrors: result.fieldErrors };

  revalidatePath("/settings/team");

  const base = process.env.AUTH_URL ?? "";
  return {
    message: `Invitation ready for ${result.data.email}`,
    inviteLink: `${base}/invite?token=${result.data.token}`,
  };
}

export async function revokeInvitationAction(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const ctx = await requireCtx();
  const result = await guarded(() =>
    revokeInvitation(ctx, String(formData.get("invitationId") ?? "")),
  );

  revalidatePath("/settings/team");
  if (!result.ok) return { error: result.error };
  return { message: "Invitation revoked" };
}

export async function changeRoleAction(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const ctx = await requireCtx();
  const result = await guarded(() =>
    changeMemberRole(ctx, {
      userId: formData.get("userId") ?? "",
      role: formData.get("role") ?? "REP",
    }),
  );

  revalidatePath("/settings/team");
  if (!result.ok) return { error: result.error };
  return { message: "Role updated" };
}

export async function deactivateMemberAction(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const ctx = await requireCtx();
  const result = await guarded(() =>
    deactivateMember(ctx, String(formData.get("userId") ?? "")),
  );

  revalidatePath("/settings/team");
  if (!result.ok) return { error: result.error };
  return { message: "Member deactivated" };
}

export async function acceptInvitationAction(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const password = String(formData.get("password") ?? "");
  const result = await acceptInvitation({
    token: formData.get("token") ?? "",
    name: formData.get("name") ?? "",
    password,
  });

  if (!result.ok) return { error: result.error, fieldErrors: result.fieldErrors };

  // Straight into the app — making someone sign in again right after choosing
  // a password is friction with no security benefit.
  await signIn("credentials", {
    email: result.data.email,
    password,
    redirectTo: "/dashboard",
  });

  return {};
}
