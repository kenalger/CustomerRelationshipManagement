import { AccountMenu } from "@/components/account-menu";
import { NotificationBell } from "@/components/notification-bell";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/context";
import { unreadCount } from "@/server/services/notifications";

/**
 * The app bar: who you are and where you are, and nothing else.
 *
 * It takes NO actions prop, and that is deliberate rather than an omission.
 * This row is identical on every screen, so anything in it reads as belonging
 * to the application; a "New contact" button here sits beside the account
 * avatar and the eye has no way to tell a page action from app furniture.
 *
 * Salesforce's design system draws the same line: the global header carries
 * only what "persists with the user through their experience" — search,
 * notifications, help, avatar — while a page header is a separate component
 * "distinguished from the global header through its focus on page-specific
 * content and actions". Atlassian likewise defines a page header as a title
 * "optionally combined with breadcrumbs, buttons, search, and filters", with
 * the buttons beside the filters rather than in the app chrome.
 *
 * Page actions go in `<PageToolbar>`, inside the content column, next to the
 * search and filters they sit alongside and directly above the thing they act
 * on. If you are reaching for an `action` prop here, that is the component you
 * want.
 *
 * The account control renders inside the same centred container as the page
 * content, not pinned with `position: fixed` and compensated by a right-hand
 * gutter — that earlier arrangement centred the bar within a different width
 * than the content below it, so the title never lined up with the table.
 *
 * The user query is cheap and the session lookup behind it is request-cached,
 * so rendering the account here costs a single extra select per page.
 */
export async function PageHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
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
