import { Bell } from "lucide-react";
import Link from "next/link";

/**
 * Notifications, as a control in the top-right app bar.
 *
 * It lives here rather than in the sidebar nav because it is a *state*
 * indicator, not a destination you navigate between — the same reason the
 * account control sits beside it. A count buried seven rows down a nav list is
 * seen when you happen to look at the list; in the corner it is seen on every
 * page.
 *
 * The badge is accent, not red. `NavLink`'s rule is that red means something
 * is wrong (an overdue task), and unread notifications are not wrong — they
 * are unread. Using the alert colour for both would spend the red on the
 * commoner, less serious signal.
 */
export function NotificationBell({ unread }: { unread: number }) {
  return (
    <Link
      href="/notifications"
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      className="relative flex size-8 shrink-0 items-center justify-center rounded-md text-secondary transition-colors duration-100 hover:bg-hover hover:text-foreground"
    >
      <Bell size={17} strokeWidth={1.75} aria-hidden />
      {unread > 0 ? (
        <span
          aria-hidden
          className="absolute -right-0.5 -top-0.5 min-w-4 rounded-sm bg-accent px-1 text-center text-[11px] font-[590] leading-4 tabular-nums text-accent-fg"
        >
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
