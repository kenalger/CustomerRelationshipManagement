"use client";

import { Check, Copy, UserPlus } from "lucide-react";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { ASSIGNABLE_ROLES } from "@/lib/validation/team";
import {
  type TeamActionState,
  changeRoleAction,
  deactivateMemberAction,
  inviteMemberAction,
  revokeInvitationAction,
} from "@/server/actions/team";

const ROLE_TONE = {
  OWNER: "accent",
  ADMIN: "info",
  MANAGER: "success",
  REP: "neutral",
  READ_ONLY: "warning",
} as const;

function label(role: string) {
  return role.replace("_", " ").toLowerCase();
}

function Submit({ children }: { children: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" loading={pending}>
      {children}
    </Button>
  );
}

export function InviteForm() {
  const [state, action] = useActionState<TeamActionState, FormData>(inviteMemberAction, {});
  const [copied, setCopied] = useState(false);

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success("Invite link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is blocked in some contexts; the link stays selectable.
      toast.error("Could not copy — select the link and copy it manually");
    }
  }

  return (
    <section className="rounded-lg border border-border-subtle bg-surface p-4">
      <h2 className="flex items-center gap-2 text-[14px] font-semibold">
        <UserPlus size={15} strokeWidth={1.75} aria-hidden className="text-muted" />
        Invite someone
      </h2>

      <form action={action} className="mt-3 flex flex-wrap items-end gap-2">
        <div className="min-w-52 flex-1 space-y-1.5">
          <label htmlFor="invite-email" className="block text-[12px] font-medium">
            Work email
          </label>
          <Input id="invite-email" name="email" type="email" required placeholder="rep@company.com" />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="invite-role" className="block text-[12px] font-medium">
            Role
          </label>
          <Select id="invite-role" name="role" defaultValue="REP" className="w-36">
            {ASSIGNABLE_ROLES.map((role) => (
              <option key={role} value={role}>
                {label(role)}
              </option>
            ))}
          </Select>
        </div>

        <Submit>Create invite</Submit>
      </form>

      {state.error ? (
        <p role="alert" className="mt-2 text-[12px] text-danger">
          {state.error}
        </p>
      ) : null}

      {state.inviteLink ? (
        <div className="mt-3 rounded-md border border-success/25 bg-success-muted p-2.5">
          <p className="text-[12px] font-medium text-success">{state.message}</p>
          <p className="mt-1 text-[12px] text-success/80">
            This link is shown once. Copy it now — you cannot get it back.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <input
              readOnly
              value={state.inviteLink}
              aria-label="Invitation link"
              onFocus={(e) => e.currentTarget.select()}
              className="h-7 flex-1 rounded-sm border border-border-strong bg-surface px-2 font-mono text-[12px]"
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => copy(state.inviteLink!)}
            >
              {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function MemberRow({
  member,
  isSelf,
  canManage,
  viewerIsOwner,
}: {
  member: {
    id: string;
    name: string | null;
    email: string;
    role: string;
    leads: number;
    deals: number;
  };
  isSelf: boolean;
  canManage: boolean;
  viewerIsOwner: boolean;
}) {
  const [roleState, changeRole] = useActionState<TeamActionState, FormData>(changeRoleAction, {});
  const [removeState, remove] = useActionState<TeamActionState, FormData>(
    deactivateMemberAction,
    {},
  );

  // An OWNER can only be acted on by another OWNER, and nobody acts on themselves.
  const editable =
    canManage && !isSelf && (member.role !== "OWNER" || viewerIsOwner) && member.role !== "OWNER";
  const error = roleState.error ?? removeState.error;

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-2.5">
      <Avatar name={member.name ?? member.email} size={26} />

      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-medium">
          {member.name ?? member.email}
          {isSelf ? <span className="ml-1.5 text-[12px] text-muted">you</span> : null}
        </p>
        <p className="truncate text-[12px] text-muted">{member.email}</p>
      </div>

      <span className="hidden text-[12px] text-muted tabular-nums sm:block">
        {member.leads} leads · {member.deals} deals
      </span>

      {editable ? (
        <form action={changeRole}>
          <input type="hidden" name="userId" value={member.id} />
          <label className="sr-only" htmlFor={`role-${member.id}`}>
            Role for {member.email}
          </label>
          <Select
            id={`role-${member.id}`}
            name="role"
            defaultValue={member.role}
            className="h-7 w-32 text-[12px]"
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
          >
            {ASSIGNABLE_ROLES.map((role) => (
              <option key={role} value={role}>
                {label(role)}
              </option>
            ))}
          </Select>
        </form>
      ) : (
        <Badge tone={ROLE_TONE[member.role as keyof typeof ROLE_TONE] ?? "neutral"}>
          {label(member.role)}
        </Badge>
      )}

      {editable ? (
        <form action={remove}>
          <input type="hidden" name="userId" value={member.id} />
          <Button type="submit" size="sm" variant="ghost">
            Deactivate
          </Button>
        </form>
      ) : null}

      {error ? (
        <p role="alert" className="w-full text-[12px] text-danger">
          {error}
        </p>
      ) : null}
    </li>
  );
}

export function PendingInvite({
  invitation,
  canManage,
}: {
  invitation: {
    id: string;
    email: string;
    role: string;
    expiresAt: string;
    invitedBy: string | null;
  };
  canManage: boolean;
}) {
  const [state, revoke] = useActionState<TeamActionState, FormData>(revokeInvitationAction, {});

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-medium">{invitation.email}</p>
        <p className="truncate text-[12px] text-muted">
          Invited by {invitation.invitedBy ?? "someone"} · expires{" "}
          {new Date(invitation.expiresAt).toLocaleDateString()}
        </p>
      </div>

      <Badge tone="neutral">{label(invitation.role)}</Badge>

      {canManage ? (
        <form action={revoke}>
          <input type="hidden" name="invitationId" value={invitation.id} />
          <Button type="submit" size="sm" variant="ghost">
            Revoke
          </Button>
        </form>
      ) : null}

      {state.error ? (
        <p role="alert" className="w-full text-[12px] text-danger">
          {state.error}
        </p>
      ) : null}
    </li>
  );
}
