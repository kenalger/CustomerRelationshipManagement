import Link from "next/link";
import { notFound } from "next/navigation";

import { ActivityTimeline } from "@/components/crm/activity-timeline";
import { CompanyFields } from "@/components/crm/fields/company-fields";
import { RecordComposer } from "@/components/crm/record-composer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { formatMoney } from "@/lib/money";
import { requireCtx } from "@/server/context";
import { listActivities } from "@/server/services/activities";
import { getCompany } from "@/server/services/companies";

export default async function CompanyModal({ params }: PageProps<"/companies/[id]">) {
  const ctx = await requireCtx();
  const { id } = await params;

  const company = await getCompany(ctx, id);
  if (!company) notFound();

  const activities = await listActivities(ctx, { companyId: company.id });
  const canEdit = ctx.role !== "READ_ONLY";

  return (
    <Modal
      title={company.name}
      description={company.industry ?? undefined}
      footer={
        // A plain anchor, deliberately: <Link> would be intercepted by this
        // same modal route and the click would appear to do nothing. A hard
        // navigation is the only way out to the full page.
        <a href={`/companies/${company.id}`}>
          <Button size="sm" variant="secondary">
            Open full record
          </Button>
        </a>
      }
    >
      <div className="space-y-5">
        <CompanyFields company={company} canEdit={canEdit} />

        {company.contacts.length > 0 ? (
          <section>
            <h3 className="t-heading mb-2">People</h3>
            <ul className="space-y-1">
              {company.contacts.map((c) => (
                <li key={c.id} className="text-[12px]">
                  <Link href={`/contacts/${c.id}`} className="underline-offset-2 hover:underline">
                    {[c.firstName, c.lastName].filter(Boolean).join(" ")}
                  </Link>
                  {c.title ? <span className="text-muted"> · {c.title}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {company.deals.length > 0 ? (
          <section>
            <h3 className="t-heading mb-2">Deals</h3>
            <ul className="space-y-1.5">
              {company.deals.map((deal) => (
                <li key={deal.id} className="flex items-center justify-between gap-2 text-[12px]">
                  <Link href={`/deals/${deal.id}`} className="truncate underline-offset-2 hover:underline">
                    {deal.title}
                  </Link>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="tabular-nums">{formatMoney(Number(deal.value), deal.currency)}</span>
                    <Badge tone={deal.stage.isWon ? "success" : deal.stage.isLost ? "danger" : "info"}>
                      {deal.stage.name}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section>
          <h3 className="t-heading mb-2">Activity</h3>
          <div className="mb-3">
            <RecordComposer link={{ companyId: company.id }} canWrite={canEdit} />
          </div>
          <ActivityTimeline activities={activities} />
        </section>
      </div>
    </Modal>
  );
}
