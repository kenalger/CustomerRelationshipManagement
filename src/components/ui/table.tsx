import { ArrowDown, ArrowUp } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A grid, not a list of cards.
 *
 * Light borders are the design here rather than decoration — they are what
 * makes a table read as a database. Rows are 40px, set by cell padding alone
 * so nothing fights a fixed height.
 */
export function TableShell({ children, caption }: { children: ReactNode; caption: string }) {
  return (
    /*
     * The grid scrolls inside its own region, the way a spreadsheet does.
     *
     * This wrapper is the sticky containing block for the header row, which is
     * why the header offset MUST be 0 here. Offsetting it by the page header's
     * height instead pushed every header 52px down inside this box and over
     * the first rows — `overflow-x-auto` forces `overflow-y` to compute to
     * `auto`, so this div is the scrollport, not the page.
     *
     * Because the table scrolls internally, the page header can never collide
     * with it either — which was the original problem I was trying to solve.
     */
    <div className="max-h-[calc(100dvh-var(--header-h)-11rem)] overflow-auto rounded-md border border-border-subtle">
      <table className="w-full border-collapse text-[14px]">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export function Th({
  children,
  align = "left",
  className,
}: {
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        // top-0 relative to TableShell's scrollport, not the page. See the
        // note there for why any other value displaces the whole header row.
        "sticky top-0 z-10 border-b border-border-subtle bg-sunken",
        // A vertical rule between columns; the last one would sit on the
        // table's own border, so it is dropped.
        "border-r border-border-subtle last:border-r-0",
        "t-caps px-4 py-3 text-muted",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Tr({
  children,
  selected = false,
  className,
}: {
  children: ReactNode;
  selected?: boolean;
  className?: string;
}) {
  return (
    <tr
      className={cn(
        "border-b border-border-subtle transition-colors duration-100 last:border-b-0",
        selected ? "bg-accent-soft" : "hover:bg-hover",
        className,
      )}
    >
      {children}
    </tr>
  );
}

export function Td({
  children,
  align = "left",
  className,
}: {
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <td
      className={cn(
        // 12px vertical padding on ~22px content gives a ~46px row.
        "border-r border-border-subtle px-4 py-3 align-middle last:border-r-0",
        align === "right" ? "text-right tabular-nums" : "text-left",
        className,
      )}
    >
      {children}
    </td>
  );
}

/**
 * A sortable column header. Sorting lives in the URL, so a sorted view is
 * shareable, survives a refresh, and Back undoes it.
 */
export function SortableTh({
  children,
  column,
  activeSort,
  activeDir,
  basePath,
  params,
  align = "left",
}: {
  children: ReactNode;
  column: string;
  activeSort: string;
  activeDir: "asc" | "desc";
  basePath: string;
  params?: Record<string, string | undefined>;
  align?: "left" | "right";
}) {
  const active = activeSort === column;
  const nextDir = active && activeDir === "asc" ? "desc" : "asc";

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value) query.set(key, value);
  }
  query.set("sort", column);
  query.set("dir", nextDir);

  const Icon = activeDir === "asc" ? ArrowUp : ArrowDown;

  return (
    <Th align={align}>
      <Link
        href={`${basePath}?${query.toString()}`}
        aria-label={`Sort by ${String(children)} ${nextDir === "asc" ? "ascending" : "descending"}`}
        className={cn(
          "inline-flex items-center gap-1 rounded transition-colors hover:text-foreground",
          active && "text-foreground",
          align === "right" && "flex-row-reverse",
        )}
      >
        {children}
        {active ? <Icon size={12} strokeWidth={2.5} aria-hidden /> : null}
      </Link>
    </Th>
  );
}

/**
 * A record's name in a list. Not accent-coloured: a table of twenty blue links
 * spends the whole colour budget on navigation nobody is looking at.
 */
export function RecordLink({ className, ...props }: React.ComponentProps<"a">) {
  return (
    <a
      className={cn(
        "font-[510] text-foreground decoration-border-strong underline-offset-2 hover:underline",
        className,
      )}
      {...props}
    />
  );
}
