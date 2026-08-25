import { Building2, Plus, Search } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/field";
import { RecordLink, Td, TableShell, Th, Tr } from "@/components/ui/table";
import { requireCtx } from "@/server/context";
import { listCompanies } from "@/server/services/companies";

export const metadata = { title: "Companies · CRM" };

export default async function CompaniesPage({ searchParams }: PageProps<"/companies">) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";

  const { rows, total, page, perPage } = await listCompanies(ctx, {
    q: q || undefined,
    page: typeof sp.page === "string" ? sp.page : 1,
  });

  return (
    <>
      <PageHeader
        title="Companies"
        description="Accounts you sell to."
        action={
          <Link href="/companies/new">
            <Button size="sm">
              <Plus size={14} strokeWidth={2} aria-hidden />
              New company
            </Button>
          </Link>
        }
      />

      <div className="mx-auto w-full max-w-[1280px] space-y-6 p-8">
        <form role="search" className="relative w-64">
          <Search
            size={14}
            strokeWidth={1.75}
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
          />
          <Input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search name or domain…"
            aria-label="Search companies"
            className="pl-8"
          />
        </form>

        {rows.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={q ? "Nothing matches that search" : "No companies yet"}
            hint={
              q
                ? "Try a shorter search term."
                : "Add one, or convert a lead that names a company."
            }
            action={
              <Link href="/companies/new">
                <Button size="sm">New company</Button>
              </Link>
            }
          />
        ) : (
          <TableShell caption={`Companies, ${total} total, page ${page}`}>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Domain</Th>
                <Th>Industry</Th>
                <Th align="right">People</Th>
                <Th align="right">Deals</Th>
                <Th>Owner</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <Tr key={c.id}>
                  <Td>
                    <RecordLink href={`/companies/${c.id}`}>{c.name}</RecordLink>
                  </Td>
                  <Td className="text-secondary">{c.domain ?? "—"}</Td>
                  <Td className="text-secondary">{c.industry ?? "—"}</Td>
                  <Td align="right" className="text-secondary">{c._count.contacts}</Td>
                  <Td align="right" className="text-secondary">{c._count.deals}</Td>
                  <Td className="text-secondary">{c.owner?.name ?? c.owner?.email ?? "—"}</Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        )}

        {total > perPage ? (
          <p className="text-[12px] text-muted tabular-nums">
            Showing {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} of {total}
          </p>
        ) : null}
      </div>
    </>
  );
}
