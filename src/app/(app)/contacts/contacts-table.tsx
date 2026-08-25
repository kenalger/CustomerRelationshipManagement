"use client";

import Link from "next/link";

import { BulkBar } from "@/components/crm/bulk-bar";
import {
  RowCheckbox,
  SelectAllCheckbox,
  SelectionProvider,
} from "@/components/crm/selection";
import { Avatar } from "@/components/ui/avatar";
import { RecordLink, SortableTh, Td, TableShell, Th, Tr } from "@/components/ui/table";
import { timeAgo } from "@/lib/utils";
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
  createdAt: Date;
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
            <Th>Company</Th>
            <SortableTh column="email" activeSort={sort} activeDir={dir} basePath="/contacts" params={carried}>
              Email
            </SortableTh>
            <Th>Phone</Th>
            <Th>Owner</Th>
            <SortableTh column="createdAt" activeSort={sort} activeDir={dir} basePath="/contacts" params={carried} align="right">
              Added
            </SortableTh>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Tr key={row.id}>
              {canWrite ? (
                <Td>
                  <RowCheckbox id={row.id} label={row.name} />
                </Td>
              ) : null}
              <Td>
                <span className="flex items-center gap-2">
                  <Avatar name={row.name} size={22} />
                  <span className="min-w-0">
                    <RecordLink href={`/contacts/${row.id}`} className="block truncate">
                      {row.name}
                    </RecordLink>
                    {row.title ? (
                      <span className="block truncate text-[12px] text-muted">{row.title}</span>
                    ) : null}
                  </span>
                </span>
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
              <Td className="text-secondary">{row.email ?? "—"}</Td>
              <Td className="text-secondary">{row.phone ?? "—"}</Td>
              <Td className="text-secondary">{row.ownerName ?? "—"}</Td>
              <Td align="right" className="text-muted">
                {timeAgo(row.createdAt)}
              </Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>

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
