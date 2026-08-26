import { SectionHeader } from "@/components/section-header";
import { requireCtx } from "@/server/context";
import { hasRole } from "@/server/authz";
import { listTags } from "@/server/services/tags";
import { TagsClient } from "./tags-client";

export const metadata = { title: "Tags · CRM" };

export default async function TagsSettingsPage() {
  const ctx = await requireCtx();
  const tags = await listTags(ctx);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-8">
      <SectionHeader
        title="Tags"
        description="Shared labels for contacts, companies and leads. Everyone in the workspace sees the same set, which is what makes them worth filtering on."
      />
      <TagsClient
        tags={tags}
        canWrite={hasRole(ctx, "REP")}
        canDelete={hasRole(ctx, "MANAGER")}
      />
    </div>
  );
}
