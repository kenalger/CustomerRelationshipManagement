import Link from "next/link";
import { notFound } from "next/navigation";

import { ActivityTimeline } from "@/components/crm/activity-timeline";
import { ContactFields } from "@/components/crm/fields/contact-fields";
import { RecordComposer } from "@/components/crm/record-composer";
import { TaskList } from "@/components/crm/task-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { formatMoney } from "@/lib/money";
import { requireCtx } from "@/server/context";
import { listActivities } from "@/server/services/activities";
import { getContact } from "@/server/services/contacts";
import { listTasksFor } from "@/server/services/tasks";

export default async function ContactModal({ params }: PageProps<"/contacts/[id]">) {
  const ctx = await requireCtx();
  const { id } = await params;

  const contact = await getContact(ctx, id);
  if (!contact) notFound();

  const [activities, tasks] = await Promise.all([
    listActivities(ctx, { contactId: contact.id }),
    listTasksFor(ctx, { contactId: contact.id }),
  ]);

  const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
  const canEdit = ctx.role !== "READ_ONLY";

  return (
    <Modal
      title={fullName}
      description={contact.title ?? undefined}
      footer={
        // A dialog must always offer the way out to the full record — a
        // preview that traps you is worse than a navigation.
        // A plain anchor, deliberately: <Link> would be intercepted by this
        // same modal route and the click would appear to do nothing. A hard
        // navigation is the only way out to the full page.
        <a href={`/contacts/${contact.id}`}>
          <Button size="sm" variant="secondary">
            Open full record
          </Button>
        </a>
      }
    >
      {/* One column: the page's two-column layout would be cramped at dialog
          width, and a squeezed timeline is unreadable. */}
      <div className="space-y-5">
        <ContactFields contact={contact} canEdit={canEdit} />

        {contact.deals.length > 0 ? (
          <section>
            <h3 className="t-heading mb-2">Deals</h3>
            <ul className="space-y-1.5">
              {contact.deals.map((deal) => (
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
          <h3 className="t-heading mb-2">
            Tasks{" "}
            <span className="text-muted tabular-nums">
              ({tasks.filter((t) => !t.completedAt).length} open)
            </span>
          </h3>
          <div className="rounded-lg bg-sunken">
            <TaskList tasks={tasks} emptyHint="No follow-ups yet — add one from the composer below." />
          </div>
        </section>

        <section>
          <h3 className="t-heading mb-2">Activity</h3>
          <div className="mb-3">
            <RecordComposer link={{ contactId: contact.id }} canWrite={canEdit} />
          </div>
          <ActivityTimeline activities={activities} />
        </section>
      </div>
    </Modal>
  );
}
