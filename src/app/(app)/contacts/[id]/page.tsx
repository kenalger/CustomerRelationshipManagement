import Link from "next/link";
import { notFound } from "next/navigation";

import { ActivityTimeline } from "@/components/crm/activity-timeline";
import { EditableField } from "@/components/crm/editable-field";
import { TaskList } from "@/components/crm/task-list";
import { TagPicker } from "@/components/crm/tag-picker";
import { Panel } from "@/components/ui/panel";
import { RecordComposer } from "@/components/crm/record-composer";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/money";
import { requireCtx } from "@/server/context";
import { listActivities } from "@/server/services/activities";
import { listTasksFor } from "@/server/services/tasks";
import { getContact } from "@/server/services/contacts";
import { listTags, tagsFor } from "@/server/services/tags";

export default async function ContactDetailPage({ params }: PageProps<"/contacts/[id]">) {
  const ctx = await requireCtx();
  const { id } = await params;

  // getContact is tenant-scoped, so another org's id is simply "not found".
  const contact = await getContact(ctx, id);
  if (!contact) notFound();

  const [activities, tasks, tags, allTags] = await Promise.all([
    listActivities(ctx, { contactId: contact.id }),
    listTasksFor(ctx, { contactId: contact.id }),
    tagsFor(ctx, { contactId: contact.id }),
    listTags(ctx),
  ]);
  const canEdit = ctx.role !== "READ_ONLY";
  const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(" ");

  return (
    <>
      <PageHeader title={fullName} description={contact.title ?? undefined} />

      <div className="grid gap-4 p-6 lg:grid-cols-[20rem_1fr]">
        <div className="space-y-4">
          <Panel title="Tags">
            <TagPicker
              target={{ contactId: contact.id }}
              tags={tags}
              all={allTags}
              canEdit={canEdit}
            />
          </Panel>

          <Panel title="Details">
            <dl className="divide-y divide-border-subtle">
              <EditableField
                entity="contact"
                id={contact.id}
                field="firstName"
                label="First name"
                value={contact.firstName}
                canEdit={canEdit}
              />
              <EditableField
                entity="contact"
                id={contact.id}
                field="lastName"
                label="Last name"
                value={contact.lastName}
                canEdit={canEdit}
              />
              <EditableField
                entity="contact"
                id={contact.id}
                field="email"
                label="Email"
                type="email"
                display="email"
                value={contact.email}
                canEdit={canEdit}
              />
              <EditableField
                entity="contact"
                id={contact.id}
                field="phone"
                label="Phone"
                type="tel"
                display="tel"
                value={contact.phone}
                canEdit={canEdit}
              />
              <EditableField
                entity="contact"
                id={contact.id}
                field="title"
                label="Job title"
                value={contact.title}
                canEdit={canEdit}
              />
              <div className="flex items-baseline justify-between gap-4 py-1.5">
                <dt className="shrink-0 text-[12px] text-muted">Company</dt>
                <dd className="min-w-0 truncate text-right text-[12px]">
                  {contact.company ? (
                    <Link href={`/companies/${contact.company.id}`} className="text-accent hover:underline">
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
          </Panel>

          <Panel title={`Deals (${contact.deals.length})`}>
            {contact.deals.length === 0 ? (
              <p className="text-sm text-muted">No deals yet.</p>
            ) : (
              <ul className="space-y-2">
                {contact.deals.map((deal) => (
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
          <section className="rounded-lg bg-surface">
            <header className="flex items-center justify-between border-b border-border-subtle px-4 py-2.5">
              <h2 className="text-[14px] font-semibold">
                Tasks{" "}
                <span className="text-muted tabular-nums">
                  ({tasks.filter((t) => !t.completedAt).length} open)
                </span>
              </h2>
            </header>
            <TaskList tasks={tasks} emptyHint="No follow-ups yet — add one from the composer below." />
          </section>

          <RecordComposer link={{ contactId: contact.id }} canWrite={canEdit} />
          <Panel title="Activity">
            <ActivityTimeline activities={activities} />
          </Panel>
        </div>
      </div>
    </>
  );
}
