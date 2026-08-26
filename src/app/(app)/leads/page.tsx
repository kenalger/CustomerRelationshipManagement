import { Search, Sparkles } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/context";
import { listLeads } from "@/server/services/leads";
import { slaSnapshot } from "@/server/services/sla";
import { LeadsTable } from "./leads-table";

export const metadata = { title: "Leads · CRM" };


const TABS = [
  { label: "All", value: "" },
  { label: "New", value: "NEW" },
  { label: "Working", value: "WORKING" },
  { label: "Converted", value: "CONVERTED" },
] as const;


export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const status = typeof sp.status === "string" ? sp.status : "";
  const q = typeof sp.q === "string" ? sp.q : "";
  const sort = typeof sp.sort === "string" ? sp.sort : "createdAt";
  const dir = sp.dir === "asc" ? "asc" : "desc";

  const [{ rows, total, page, perPage }, sla, team] = await Promise.all([
    listLeads(ctx, {
      status: status || undefined,
      q: q || undefined,
      sort,
      dir,
      page: typeof sp.page === "string" ? sp.page : 1,
    }),
    slaSnapshot(ctx),
    db.user.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true, name: true, email: true },
      orderBy: { email: "asc" },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Leads"
        description="Inbound from every connected source, deduped and assigned."
      />

      <div className="mx-auto w-full max-w-[1280px] space-y-6 p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 rounded-lg border border-border-subtle bg-surface p-0.5">
            {TABS.map((tab) => {
              const active = status === tab.value;
              return (
                <Link
                  key={tab.label}
                  href={tab.value ? `/leads?status=${tab.value}` : "/leads"}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[12px] transition-colors duration-100",
                    active
                      ? "bg-accent-soft font-medium text-accent"
                      : "text-secondary hover:text-foreground",
                  )}
                >
                  {tab.label}
                </Link>
              );
            })}
          </div>

          <form role="search" className="relative">
            <Search
              size={14}
              strokeWidth={1.75}
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
            />
            {status ? <input type="hidden" name="status" value={status} /> : null}
            <Input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search name, email, company…"
              aria-label="Search leads"
              className="w-64 pl-8"
            />
          </form>
        </div>

        {sla.breaching > 0 ? (
          <p
            role="status"
            className="rounded-lg border border-warning/25 bg-warning-muted px-3 py-2 text-[12px] text-warning"
          >
            <strong className="font-semibold">{sla.breaching}</strong> unworked past the{" "}
            {sla.slaFirstTouchMinutes}-minute target. Contact speed is the strongest predictor of
            conversion here.
          </p>
        ) : null}

        {rows.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title={q || status ? "Nothing matches that filter" : "No leads yet"}
            hint={
              q || status
                ? "Try a broader search, or clear the status filter."
                : "Connect Facebook Lead Ads or a mailbox and inbound leads land here within a minute."
            }
            action={
              q || status ? (
                <Link href="/leads">
                  <Button variant="secondary" size="sm">
                    Clear filters
                  </Button>
                </Link>
              ) : (
                <Link href="/settings/connections">
                  <Button size="sm">Set up a connection</Button>
                </Link>
              )
            }
          />
        ) : (
          <LeadsTable
            rows={rows.map((lead) => ({
              id: lead.id,
              firstName: lead.firstName,
              lastName: lead.lastName,
              email: lead.email,
              companyName: lead.companyName,
              source: lead.source,
              status: lead.status,
              score: lead.score,
              scoredAt: lead.scoredAt,
              createdAt: lead.createdAt,
              firstTouchedAt: lead.firstTouchedAt,
              ageMinutes: lead.ageMinutes,
              ownerName: lead.owner?.name ?? lead.owner?.email ?? null,
            }))}
            total={total}
            page={page}
            sort={sort}
            dir={dir}
            status={status}
            q={q}
            warnAfter={sla.slaFirstTouchMinutes}
            dangerAfter={sla.slaEscalateMinutes}
            assignees={team.map((u) => ({ id: u.id, name: u.name ?? u.email }))}
            canWrite={ctx.role !== "READ_ONLY"}
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
