import { PageHeader } from "@/components/page-header";
import { requireCtx } from "@/server/context";
import { ImportWizard } from "./import-wizard";

export const metadata = { title: "Import contacts · CRM" };

export default async function ImportContactsPage() {
  await requireCtx();

  return (
    <>
      <PageHeader
        title="Import contacts"
        description="Upload a CSV, check the mapping, then import."
      />
      <div className="mx-auto w-full max-w-5xl p-8">
        <ImportWizard />
      </div>
    </>
  );
}
