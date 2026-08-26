import { SectionHeader } from "@/components/section-header";
import { Callout } from "@/components/ui/callout";
import { requireCtx } from "@/server/context";
import { getScoringRules } from "@/server/services/scoring";
import { ScoringForm } from "./scoring-form";

export const metadata = { title: "Lead scoring · CRM" };

export default async function ScoringSettingsPage() {
  const ctx = await requireCtx();
  const canManage = ctx.role === "OWNER" || ctx.role === "ADMIN";

  // getScoringRules is ADMIN-only, so a manager viewing this page would get a
  // ForbiddenError rather than a read-only view. Guard before calling.
  if (!canManage) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-6 p-8">
        <SectionHeader
          title="Lead scoring"
          description="How every lead is ranked in the queue."
        />
        <Callout tone="info">Only an owner or admin can view or change scoring weights.</Callout>
      </div>
    );
  }

  const rules = await getScoringRules(ctx);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-8">
      <SectionHeader
        title="Lead scoring"
        description="Points a lead earns for where it came from, how reachable it is, and how far along it is. The queue sorts on the total."
      />
      <ScoringForm defaults={rules} />
    </div>
  );
}
