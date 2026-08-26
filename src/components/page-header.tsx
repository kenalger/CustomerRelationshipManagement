import type { ReactNode } from "react";

import { AccountMenu } from "@/components/account-menu";
import { NotificationBell } from "@/components/notification-bell";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/context";
import { unreadCount } from "@/server/services/notifications";

/**
 * The page bar.
 *
 * The account control is rendered HERE, inside the same centred container as
 * the page content — not pinned with `position: fixed` and compensated by a
 * right-hand gutter. That earlier arrangement centred the bar within a
 * different width than the content below it, so the title never quite lined
 * up with the table under it.
 *
 * The user query is cheap and the session lookup behind it is request-cached,
 * so rendering the account here costs a single extra select per page.
 */
export async function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  const ctx = await requireCtx();
  // Both reads, so they are safe to run together — it is interactive
  // transactions this pg adapter cannot run concurrently, not selects.
  const [user, unread] = await Promise.all([
    db.user.findUnique({
      where: { id: ctx.userId },
      select: { name: true, email: true },
    }),
    unreadCount(ctx),
  ]);

  return (
    <header className="sticky top-0 z-20 border-b border-border-subtle bg-page">
      <div className="mx-auto flex h-[var(--header-h)] w-full max-w-[1280px] items-center justify-between gap-6 px-8">
        <div className="min-w-0">
          <h1 className="truncate text-[18px] font-[590] leading-6 tracking-[-0.014em]">
            {title}
          </h1>
          {description ? (
            <p className="mt-0.5 truncate text-[13px] leading-5 text-muted">{description}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {action}
          {/* A rule between the page's own actions and the account, so the two
              read as separate groups rather than one row of controls. */}
          {action ? <span aria-hidden className="h-5 w-px bg-border-subtle" /> : null}
          <NotificationBell unread={unread} />
          <AccountMenu
            userName={user?.name ?? null}
            userEmail={user?.email ?? ""}
            role={ctx.role}
          />
        </div>
      </div>
    </header>
  );
}

export { EmptyState } from "@/components/ui/empty-state";
