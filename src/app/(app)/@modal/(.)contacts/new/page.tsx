import { Modal } from "@/components/ui/modal";
import { requireCtx } from "@/server/context";
import { listCompanies } from "@/server/services/companies";
import { NewContactForm } from "@/app/(app)/contacts/new/form";

export default async function NewContactModal() {
  const ctx = await requireCtx();
  const { rows } = await listCompanies(ctx, { perPage: 100 });

  return (
    <Modal title="New contact" size="md">
      <NewContactForm companies={rows.map((c) => ({ id: c.id, name: c.name }))} />
    </Modal>
  );
}
