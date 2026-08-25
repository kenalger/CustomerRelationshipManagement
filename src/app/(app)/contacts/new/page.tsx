import { PageHeader } from "@/components/page-header";
import { requireCtx } from "@/server/context";
import { listCompanies } from "@/server/services/companies";
import { NewContactForm } from "./form";

export const metadata = { title: "New contact · CRM" };

export default async function NewContactPage() {
  const ctx = await requireCtx();
  // Only this org's companies reach the picker, so the select cannot offer an
  // id the server would then have to reject.
  const { rows } = await listCompanies(ctx, { perPage: 100 });

  return (
    <>
      <PageHeader title="New contact" />
      <div className="mx-auto w-full max-w-2xl p-8">
        <NewContactForm companies={rows.map((c) => ({ id: c.id, name: c.name }))} />
      </div>
    </>
  );
}
