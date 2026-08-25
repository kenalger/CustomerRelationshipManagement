import { PageHeader } from "@/components/page-header";
import { requireCtx } from "@/server/context";
import { NewCompanyForm } from "./form";

export const metadata = { title: "New company · CRM" };

export default async function NewCompanyPage() {
  await requireCtx();
  return (
    <>
      <PageHeader title="New company" />
      <div className="mx-auto w-full max-w-2xl p-8">
        <NewCompanyForm />
      </div>
    </>
  );
}
