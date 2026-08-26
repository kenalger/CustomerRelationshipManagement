import { Plus, Search, Upload, Users } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { PageToolbar } from "@/components/page-toolbar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/field";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/context";
import { listContacts } from "@/server/services/contacts";
import { ContactsTable } from "./contacts-table";

export const metadata = { title: "Contacts · CRM" };

export default async function ContactsPage({ searchParams }: PageProps<"/contacts">) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const sort = typeof sp.sort === "string" ? sp.sort : "lastName";
  const dir = sp.dir === "desc" ? "desc" : "asc";

  const [{ rows, total, page, perPage }, team] = await Promise.all([
    listContacts(ctx, {
      q: q || undefined,
      sort,
      dir,
      page: typeof sp.page === "string" ? sp.page : 1,
    }),
    db.user.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true, name: true, email: true },
      orderBy: { email: "asc" },
    }),
  ]);

  return (
    <>
      <PageHeader title="Contacts" description="People, and the companies they work for." />

      <div className="mx-auto w-full max-w-[1280px] space-y-6 p-8">
        <PageToolbar
          filters={
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
                placeholder="Search name or email…"
                aria-label="Search contacts"
                className="pl-8"
              />
            </form>
          }
          actions={
            <>
              <Link href="/contacts/import">
                <Button size="sm" variant="secondary">
                  <Upload size={14} strokeWidth={2} aria-hidden />
                  Import CSV
                </Button>
              </Link>
              <Link href="/contacts/new">
                <Button size="sm">
                  <Plus size={14} strokeWidth={2} aria-hidden />
                  New contact
                </Button>
              </Link>
            </>
          }
        />

        {rows.length === 0 ? (
          <EmptyState
            icon={Users}
            title={q ? "Nothing matches that search" : "No contacts yet"}
            hint={
              q
                ? "Try a shorter search term."
                : "Import a CSV of your existing list, add one by hand, or convert a lead."
            }
            action={
              <Link href="/contacts/import">
                <Button size="sm">Import a CSV</Button>
              </Link>
            }
          />
        ) : (
          <ContactsTable
            rows={rows.map((c) => ({
              id: c.id,
              name: [c.firstName, c.lastName].filter(Boolean).join(" "),
              title: c.title,
              email: c.email,
              phone: c.phone,
              companyId: c.company?.id ?? null,
              companyName: c.company?.name ?? null,
              ownerName: c.owner?.name ?? c.owner?.email ?? null,
            }))}
            total={total}
            page={page}
            sort={sort}
            dir={dir}
            q={q}
            assignees={team.map((u) => ({ id: u.id, name: u.name ?? u.email }))}
            canWrite={ctx.role !== "READ_ONLY"}
            canDelete={ctx.role === "OWNER" || ctx.role === "ADMIN" || ctx.role === "MANAGER"}
          />
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
