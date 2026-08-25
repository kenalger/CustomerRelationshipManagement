import { SectionHeader } from "@/components/section-header";
import { Callout } from "@/components/ui/callout";
import { requireCtx } from "@/server/context";
import { getOrganization } from "@/server/services/settings";
import { OrganizationForm } from "./organization-form";

export const metadata = { title: "Organization · CRM" };

export default async function OrganizationSettingsPage() {
  const ctx = await requireCtx();
  const org = await getOrganization(ctx);
  const canManage = ctx.role === "OWNER" || ctx.role === "ADMIN";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-8">
        <SectionHeader
          title="Organization"
          description="Workspace name and the speed-to-lead policy the sweeper enforces."
        />

        {canManage ? (
          <OrganizationForm
            defaults={{
              name: org.name,
              slaFirstTouchMinutes: org.slaFirstTouchMinutes,
              slaEscalateMinutes: org.slaEscalateMinutes,
            }}
          />
        ) : (
          <Callout tone="info">Only an owner or admin can change these settings.</Callout>
        )}

        <p className="text-[12px] text-muted">
          Workspace URL is <span className="font-mono">{org.slug}</span> and cannot be changed.
        </p>
    </div>
  );
}
