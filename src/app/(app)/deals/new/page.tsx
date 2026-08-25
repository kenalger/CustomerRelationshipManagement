import { PageHeader } from "@/components/page-header";
import { requireCtx } from "@/server/context";
import { listCompanies } from "@/server/services/companies";
import { listContacts } from "@/server/services/contacts";
import { NewDealForm } from "./form";

export const metadata = { title: "New deal · CRM" };

export default async function NewDealPage() {
  const ctx = await requireCtx();
  const [companies, contacts] = await Promise.all([
    listCompanies(ctx, { perPage: 100 }),
    listContacts(ctx, { perPage: 100 }),
  ]);

  return (
    <>
      <PageHeader title="New deal" />
      <div className="mx-auto w-full max-w-2xl p-8">
        <NewDealForm
          companies={companies.rows.map((c) => ({ id: c.id, name: c.name }))}
          contacts={contacts.rows.map((c) => ({
            id: c.id,
            name: [c.firstName, c.lastName].filter(Boolean).join(" "),
          }))}
        />
      </div>
    </>
  );
}
