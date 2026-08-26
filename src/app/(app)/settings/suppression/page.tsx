import { SectionHeader } from "@/components/section-header";
import { hasRole } from "@/server/authz";
import { requireCtx } from "@/server/context";
import { listSuppressions } from "@/server/services/suppression";
import { SuppressionClient } from "./suppression-client";

export const metadata = { title: "Do not contact · CRM" };

export default async function SuppressionSettingsPage({
  searchParams,
}: PageProps<"/settings/suppression">) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  // `.catch()`-style handling rather than parseInt: a hand-typed page in a
  // bookmarked URL must degrade to page 1, not render an error boundary.
  const page = Number.parseInt(typeof sp.page === "string" ? sp.page : "1", 10) || 1;

  const { rows, total, perPage } = await listSuppressions(ctx, { q: q || undefined, page });

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-8">
      <SectionHeader
        title="Do not contact"
        description="Addresses no campaign may ever reach."
      />
      <SuppressionClient
        rows={rows.map((row) => ({
          id: row.id,
          email: row.email,
          reason: row.reason,
          note: row.note,
          createdAt: row.createdAt,
          addedBy: row.createdBy?.name ?? row.createdBy?.email ?? null,
        }))}
        total={total}
        page={page}
        perPage={perPage}
        q={q}
        canWrite={hasRole(ctx, "REP")}
        canRemove={hasRole(ctx, "MANAGER")}
      />
    </div>
  );
}
