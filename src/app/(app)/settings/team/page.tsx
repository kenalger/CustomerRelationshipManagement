import { SectionHeader } from "@/components/section-header";
import { Callout } from "@/components/ui/callout";
import { requireCtx } from "@/server/context";
import { listTeam } from "@/server/services/team";
import { InviteForm, MemberRow, PendingInvite } from "./team-client";

export const metadata = { title: "Team · CRM" };

export default async function TeamPage() {
  const ctx = await requireCtx();
  const { members, invitations } = await listTeam(ctx);
  const canManage = ctx.role === "OWNER" || ctx.role === "ADMIN";

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-8">
        <SectionHeader
          title="Team"
          description="Who can see this workspace, and what they can do in it."
        />

        {members.length === 1 ? (
          <Callout tone="warning">
            You are the only member. Lead assignment, SLA escalation, and ownership all need
            somebody to route to — invite your team below.
          </Callout>
        ) : null}

        {canManage ? <InviteForm /> : null}

        <section className="rounded-lg bg-surface">
          <header className="border-b border-border-subtle px-4 py-2.5">
            <h2 className="text-[14px] font-semibold">
              Members <span className="text-muted tabular-nums">({members.length})</span>
            </h2>
          </header>
          <ul className="divide-y divide-border-subtle">
            {members.map((member) => (
              <MemberRow
                key={member.id}
                member={{
                  id: member.id,
                  name: member.name,
                  email: member.email,
                  role: member.role,
                  leads: member._count.ownedLeads,
                  deals: member._count.ownedDeals,
                }}
                isSelf={member.id === ctx.userId}
                canManage={canManage}
                viewerIsOwner={ctx.role === "OWNER"}
              />
            ))}
          </ul>
        </section>

        {invitations.length > 0 ? (
          <section className="rounded-lg bg-surface">
            <header className="border-b border-border-subtle px-4 py-2.5">
              <h2 className="text-[14px] font-semibold">
                Pending invitations{" "}
                <span className="text-muted tabular-nums">({invitations.length})</span>
              </h2>
            </header>
            <ul className="divide-y divide-border-subtle">
              {invitations.map((invitation) => (
                <PendingInvite
                  key={invitation.id}
                  invitation={{
                    id: invitation.id,
                    email: invitation.email,
                    role: invitation.role,
                    expiresAt: invitation.expiresAt.toISOString(),
                    invitedBy: invitation.invitedBy?.name ?? invitation.invitedBy?.email ?? null,
                  }}
                  canManage={canManage}
                />
              ))}
            </ul>
          </section>
        ) : null}

        <p className="text-[12px] text-muted">
          Invitations expire after 7 days and can only be used once. There is no email delivery
          yet, so copy the link and send it yourself.
        </p>
    </div>
  );
}
