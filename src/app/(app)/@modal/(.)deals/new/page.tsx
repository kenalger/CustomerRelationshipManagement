import { Modal } from "@/components/ui/modal";
import { requireCtx } from "@/server/context";
import { listCompanies } from "@/server/services/companies";
import { listContacts } from "@/server/services/contacts";
import { NewDealForm } from "@/app/(app)/deals/new/form";

export default async function NewDealModal() {
  const ctx = await requireCtx();
  const [companies, contacts] = await Promise.all([
    listCompanies(ctx, { perPage: 100 }),
    listContacts(ctx, { perPage: 100 }),
  ]);

  return (
    <Modal title="New deal" size="md">
      <NewDealForm
        companies={companies.rows.map((c) => ({ id: c.id, name: c.name }))}
        contacts={contacts.rows.map((c) => ({
          id: c.id,
          name: [c.firstName, c.lastName].filter(Boolean).join(" "),
        }))}
      />
    </Modal>
  );
}
