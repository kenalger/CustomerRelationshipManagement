import { Modal } from "@/components/ui/modal";
import { requireCtx } from "@/server/context";
import { NewCompanyForm } from "@/app/(app)/companies/new/form";

export default async function NewCompanyModal() {
  await requireCtx();
  return (
    <Modal title="New company" size="md">
      <NewCompanyForm />
    </Modal>
  );
}
