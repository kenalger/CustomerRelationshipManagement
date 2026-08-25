import { BellOff } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { requireCtx } from "@/server/context";
import { listNotifications } from "@/server/services/notifications";
import { MarkAllReadButton, NotificationRow } from "./notification-list";

export const metadata = { title: "Notifications · CRM" };

export default async function NotificationsPage() {
  const ctx = await requireCtx();
  const notifications = await listNotifications(ctx);
  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <>
      <PageHeader
        title="Notifications"
        description={unread === 0 ? "All caught up." : `${unread} unread`}
        action={unread > 0 ? <MarkAllReadButton /> : undefined}
      />

      <div className="mx-auto w-full max-w-5xl p-8">
        {notifications.length === 0 ? (
          <EmptyState
            icon={BellOff}
            title="Nothing yet"
            hint="You'll be told here when a lead is assigned to you, or when a connection stops working."
          />
        ) : (
          <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle bg-surface">
            {notifications.map((notification) => (
              <NotificationRow key={notification.id} notification={notification} />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
