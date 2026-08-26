import { SectionHeader } from "@/components/section-header";
import { Callout } from "@/components/ui/callout";
import { hasRole } from "@/server/authz";
import { requireCtx } from "@/server/context";
import { getTemplate, listTemplates } from "@/server/services/templates";
import { TemplatesClient } from "./templates-client";

export const metadata = { title: "Templates · CRM" };

export default async function TemplatesSettingsPage({
  searchParams,
}: PageProps<"/settings/templates">) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const selectedId = typeof sp.template === "string" ? sp.template : "";

  const templates = await listTemplates(ctx);
  // A bookmarked id for a deleted template falls back to nothing selected
  // rather than a not-found page — this is a settings screen, not a record.
  const selected = selectedId ? await getTemplate(ctx, selectedId) : null;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-8">
      <SectionHeader
        title="Templates"
        description="The copy a sequence step sends. Variants let one step run an A/B test; a prospect is assigned a variant once and keeps it."
      />

      <Callout tone="info">
        Nothing here is sent automatically — no email provider is connected. When a step falls due,
        the rendered subject and body go onto a task for whoever owns the prospect to send by hand.
      </Callout>

      <TemplatesClient
        templates={templates.map((template) => ({
          id: template.id,
          name: template.name,
          subject: template.subject,
          variantLabels: template.variants.map((v) => v.label),
          usedBySteps: template._count.steps,
        }))}
        selected={selected}
        canWrite={hasRole(ctx, "REP")}
        canDelete={hasRole(ctx, "MANAGER")}
      />
    </div>
  );
}
