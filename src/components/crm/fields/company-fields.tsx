import { EditableField } from "@/components/crm/editable-field";

type Company = {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  size: string | null;
  phone: string | null;
  website: string | null;
  owner: { name: string | null; email: string } | null;
};

export function CompanyFields({ company, canEdit }: { company: Company; canEdit: boolean }) {
  return (
    <dl className="divide-y divide-border-subtle">
      <EditableField entity="company" id={company.id} field="name" label="Name" value={company.name} canEdit={canEdit} />
      <EditableField entity="company" id={company.id} field="domain" label="Domain" value={company.domain} canEdit={canEdit} />
      <EditableField entity="company" id={company.id} field="industry" label="Industry" value={company.industry} canEdit={canEdit} />
      <EditableField entity="company" id={company.id} field="size" label="Size" value={company.size} canEdit={canEdit} />
      <EditableField entity="company" id={company.id} field="phone" label="Phone" type="tel" display="tel" value={company.phone} canEdit={canEdit} />
      <EditableField entity="company" id={company.id} field="website" label="Website" type="url" display="url" value={company.website} canEdit={canEdit} />
      <div className="flex items-baseline justify-between gap-4 py-1.5">
        <dt className="shrink-0 text-[12px] text-muted">Sales rep</dt>
        <dd className="min-w-0 truncate text-right text-[12px]">
          {company.owner?.name ?? company.owner?.email ?? <span className="text-muted">—</span>}
        </dd>
      </div>
    </dl>
  );
}
