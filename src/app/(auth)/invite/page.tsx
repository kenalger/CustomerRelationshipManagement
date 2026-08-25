import Link from "next/link";

import { Callout } from "@/components/ui/callout";
import { describeInvitation } from "@/server/services/team";
import { AcceptForm } from "./accept-form";

export const metadata = { title: "Join a workspace · CRM" };

export default async function InvitePage({ searchParams }: PageProps<"/invite">) {
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";

  // One lookup, one outcome. We never say *why* a token failed — expired,
  // revoked, and never-existed all look identical, so the page cannot be used
  // to probe for valid tokens.
  const invitation = await describeInvitation(token);

  if (!invitation) {
    return (
      <div className="rounded-xl border border-border-subtle bg-surface p-6">
        <h1 className="text-[18px] font-semibold tracking-[-0.01em]">Invitation unavailable</h1>
        <Callout tone="warning" className="mt-3">
          This link is not valid. It may have expired, been used already, or been revoked. Ask
          whoever invited you to send a new one.
        </Callout>
        <p className="mt-6 border-t border-border-subtle pt-4 text-[12px] text-muted">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-accent hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border-subtle bg-surface p-6">
      <span className="mb-4 flex size-8 items-center justify-center rounded-lg bg-accent text-[14px] font-bold text-accent-fg">
        {invitation.organization.name.charAt(0)}
      </span>
      <h1 className="text-[18px] font-semibold tracking-[-0.01em]">
        Join {invitation.organization.name}
      </h1>
      <p className="mt-1 text-[12px] text-muted">
        You&rsquo;re invited as{" "}
        <span className="font-medium text-foreground">
          {invitation.role.replace("_", " ").toLowerCase()}
        </span>
        . Set a password to finish.
      </p>

      <AcceptForm token={token} email={invitation.email} />
    </div>
  );
}
