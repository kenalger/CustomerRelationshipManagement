import Link from "next/link";
import { notFound } from "next/navigation";

import { ActivityTimeline } from "@/components/crm/activity-timeline";
import { EditableField } from "@/components/crm/editable-field";
import { TagPicker } from "@/components/crm/tag-picker";
import { Panel } from "@/components/ui/panel";
import { RecordComposer } from "@/components/crm/record-composer";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/money";
import { requireCtx } from "@/server/context";
import { listActivities } from "@/server/services/activities";
import { getCompany } from "@/server/services/companies";
import { listTags, tagsFor } from "@/server/services/tags";

export default async function CompanyDetailPage({ params }: PageProps<"/companies/[id]">) {
  const ctx = await requireCtx();
  const { id } = await params;

  const company = await getCompany(ctx, id);
  if (!company) notFound();

  const [activities, tags, allTags] = await Promise.all([
    listActivities(ctx, { companyId: company.id }),
    tagsFor(ctx, { companyId: company.id }),
    listTags(ctx),
  ]);
  const canEdit = ctx.role !== "READ_ONLY";

  return (
    <>
      <PageHeader title={company.name} description={company.industry ?? undefined} />

      <div className="grid gap-4 p-6 lg:grid-cols-[20rem_1fr]">
        <div className="space-y-4">
          <Panel title="Tags">
            <TagPicker
              target={{ companyId: company.id }}
              tags={tags}
              all={allTags}
              canEdit={canEdit}
            />
          </Panel>

          <Panel title="Details">
            <dl className="divide-y divide-border-subtle">
              <EditableField
                entity="company"
                id={company.id}
                field="name"
                label="Name"
                value={company.name}
                canEdit={canEdit}
              />
              <EditableField
                entity="company"
                id={company.id}
                field="domain"
                label="Domain"
                value={company.domain}
                canEdit={canEdit}
              />
              <EditableField
                entity="company"
                id={company.id}
                field="industry"
                label="Industry"
                value={company.industry}
                canEdit={canEdit}
              />
              <EditableField
                entity="company"
                id={company.id}
                field="phone"
                label="Phone"
                type="tel"
                value={company.phone}
                canEdit={canEdit}
              />
              <EditableField
                entity="company"
                id={company.id}
                field="website"
                label="Website"
                type="url"
                display="url"
                value={company.website}
                canEdit={canEdit}
              />
              <div className="flex items-baseline justify-between gap-4 py-1.5">
                <dt className="shrink-0 text-[12px] text-muted">Sales rep</dt>
                <dd className="min-w-0 truncate text-right text-[12px]">
                  {company.owner?.name ?? company.owner?.email ?? <span className="text-muted">—</span>}
                </dd>
              </div>
            </dl>
          </Panel>

          <Panel title={`People (${company.contacts.length})`}>
            {company.contacts.length === 0 ? (
              <p className="text-sm text-muted">No contacts yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {company.contacts.map((c) => (
                  <li key={c.id} className="text-sm">
                    <Link href={`/contacts/${c.id}`} className="text-accent hover:underline">
                      {[c.firstName, c.lastName].filter(Boolean).join(" ")}
                    </Link>
                    {c.title ? <span className="text-muted"> · {c.title}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={`Deals (${company.deals.length})`}>
            {company.deals.length === 0 ? (
              <p className="text-sm text-muted">No deals yet.</p>
            ) : (
              <ul className="space-y-2">
                {company.deals.map((deal) => (
                  <li key={deal.id} className="flex items-center justify-between gap-2 text-sm">
                    <Link href={`/deals/${deal.id}`} className="truncate text-accent hover:underline">
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
            )}
          </Panel>
        </div>

        <div className="space-y-4">
          <RecordComposer link={{ companyId: company.id }} canWrite={canEdit} />
          <Panel title="Activity">
            <ActivityTimeline activities={activities} />
          </Panel>
        </div>
      </div>
    </>
  );
}
