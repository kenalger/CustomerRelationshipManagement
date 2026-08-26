import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The page's own toolbar: filters and search on the left, page actions on the
 * right, inside the content column.
 *
 * This exists because page actions do not belong in the app bar. Salesforce's
 * design system draws the line explicitly: the *global* header carries only
 * things that "persist with the user through their experience" — search,
 * notifications, help, avatar — while a *page* header is a separate component
 * "distinguished from the global header through its focus on page-specific
 * content and actions". Atlassian defines a page header the same way: a title
 * "optionally combined with breadcrumbs, buttons, search, and filters" — the
 * buttons and the filters together, not split across two bands.
 *
 * We had "New contact" sitting beside the account avatar, which put a
 * page-specific action in the one row that is supposed to be identical on
 * every screen. The eye then has no way to separate "things about this app"
 * from "things about this page".
 *
 * Rendered as a `section` with no heading, so it does not add a landmark that
 * assistive tech has to step through — it is a band of controls, not a region.
 */
export function PageToolbar({
  filters,
  actions,
  className,
}: {
  /** Search, tabs, filter chips — whatever narrows what is on screen. */
  filters?: ReactNode;
  /** The page's own actions. The primary one goes last, nearest the edge. */
  actions?: ReactNode;
  className?: string;
}) {
  if (!filters && !actions) return null;

  return (
    <div
      className={cn(
        // `justify-between` with an empty left slot would push the actions
        // left; the spacer keeps them on the right whether or not filters
        // exist, so pages do not drift apart from each other.
        "flex flex-wrap items-center gap-3",
        className,
      )}
    >
      {filters ? <div className="flex flex-wrap items-center gap-2">{filters}</div> : null}
      <div className="ms-auto flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}
