"use client";

import Link from "next/link";

import { BulkBar } from "@/components/crm/bulk-bar";
import { GridProvider } from "@/components/crm/grid";
import { GridCell } from "@/components/crm/grid-cell";
import {
  RowCheckbox,
  SelectAllCheckbox,
  SelectionProvider,
} from "@/components/crm/selection";
import { Avatar } from "@/components/ui/avatar";
import { RecordLink, SortableTh, Td, TableShell, Th, Tr } from "@/components/ui/table";
import { assignContactsAction, deleteContactsAction } from "@/server/actions/bulk";

export type ContactRow = {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  companyId: string | null;
  companyName: string | null;
  ownerName: string | null;
};

export function ContactsTable({
  rows,
  total,
  page,
  sort,
  dir,
  q,
  assignees,
  canWrite,
  canDelete,
}: {
  rows: ContactRow[];
  total: number;
  page: number;
  sort: string;
  dir: "asc" | "desc";
  q: string;
  assignees: { id: string; name: string }[];
  canWrite: boolean;
  canDelete: boolean;
}) {
  const ids = rows.map((r) => r.id);
  const carried = { q: q || undefined };

  return (
    <SelectionProvider ids={ids}>
      <GridProvider rows={rows.length} cols={3}>
      <TableShell caption={`Contacts, ${total} total, page ${page}`}>
        <thead>
          <tr>
            {canWrite ? (
              <Th className="w-8">
                <SelectAllCheckbox />
              </Th>
            ) : null}
            <SortableTh column="lastName" activeSort={sort} activeDir={dir} basePath="/contacts" params={carried}>
              Name
            </SortableTh>
            <Th>Title</Th>
            <Th>Company</Th>
            <SortableTh column="email" activeSort={sort} activeDir={dir} basePath="/contacts" params={carried}>
              Email
            </SortableTh>
            <Th>Phone</Th>
            <Th>Sales rep</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <Tr key={row.id}>
              {canWrite ? (
                <Td>
                  <RowCheckbox id={row.id} label={row.name} />
                </Td>
              ) : null}

              {/* The identity column navigates rather than edits — the single
                  most copyable mechanic from the products studied. */}
              <Td>
                <span className="flex items-center gap-2">
                  <Avatar name={row.name} size={22} />
                  <RecordLink href={`/contacts/${row.id}`} className="block truncate">
                    {row.name}
                  </RecordLink>
                </span>
              </Td>

              <Td className="p-1">
                <GridCell
                  pos={{ row: r, col: 0 }}
                  entity="contact"
                  id={row.id}
                  field="title"
                  label="Job title"
                  value={row.title}
                  editable={canWrite}
                />
              </Td>

              <Td className="text-secondary">
                {row.companyId && row.companyName ? (
                  <Link href={`/companies/${row.companyId}`} className="underline-offset-2 hover:underline">
                    {row.companyName}
                  </Link>
                ) : (
                  "—"
                )}
              </Td>

              <Td className="p-1">
                <GridCell
                  pos={{ row: r, col: 1 }}
                  entity="contact"
                  id={row.id}
                  field="email"
                  label="Email"
                  type="email"
                  value={row.email}
                  editable={canWrite}
                />
              </Td>

              <Td className="p-1">
                <GridCell
                  pos={{ row: r, col: 2 }}
                  entity="contact"
                  id={row.id}
                  field="phone"
                  label="Phone"
                  type="tel"
                  value={row.phone}
                  editable={canWrite}
                />
              </Td>

              <Td className="text-secondary">{row.ownerName ?? "—"}</Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>
      </GridProvider>

      {canWrite ? (
        <BulkBar
          noun="contact"
          assignees={assignees}
          onAssign={assignContactsAction}
          actions={
            canDelete
              ? [
                  {
                    label: "Delete",
                    variant: "danger",
                    // Soft delete, but still worth confirming — a mis-click on
                    // a 200-row selection is a bad afternoon.
                    confirm: "Delete {n} contacts? They stay on the records they touched.",
                    run: deleteContactsAction,
                  },
                ]
              : []
          }
        />
      ) : null}
    </SelectionProvider>
  );
}
