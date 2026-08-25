import Link from "next/link";

import { EditableField } from "@/components/crm/editable-field";

type Contact = {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  company: { id: string; name: string } | null;
  owner: { name: string | null; email: string } | null;
};

/**
 * One definition of a contact's editable fields, rendered by both the full
 * page and the dialog. Duplicating this list is how the two drift apart.
 */
export function ContactFields({ contact, canEdit }: { contact: Contact; canEdit: boolean }) {
  return (
    <dl className="divide-y divide-border-subtle">
      <EditableField entity="contact" id={contact.id} field="firstName" label="First name" value={contact.firstName} canEdit={canEdit} />
      <EditableField entity="contact" id={contact.id} field="lastName" label="Last name" value={contact.lastName} canEdit={canEdit} />
      <EditableField entity="contact" id={contact.id} field="email" label="Email" type="email" display="email" value={contact.email} canEdit={canEdit} />
      <EditableField entity="contact" id={contact.id} field="phone" label="Phone" type="tel" display="tel" value={contact.phone} canEdit={canEdit} />
      <EditableField entity="contact" id={contact.id} field="title" label="Job title" value={contact.title} canEdit={canEdit} />
      <div className="flex items-baseline justify-between gap-4 py-1.5">
        <dt className="shrink-0 text-[12px] text-muted">Company</dt>
        <dd className="min-w-0 truncate text-right text-[12px]">
          {contact.company ? (
            <Link href={`/companies/${contact.company.id}`} className="underline-offset-2 hover:underline">
              {contact.company.name}
            </Link>
          ) : (
            <span className="text-muted">—</span>
          )}
        </dd>
      </div>
      <div className="flex items-baseline justify-between gap-4 py-1.5">
        <dt className="shrink-0 text-[12px] text-muted">Owner</dt>
        <dd className="min-w-0 truncate text-right text-[12px]">
          {contact.owner?.name ?? contact.owner?.email ?? <span className="text-muted">—</span>}
        </dd>
      </div>
    </dl>
  );
}
