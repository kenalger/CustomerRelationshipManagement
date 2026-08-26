import { cn } from "@/lib/utils";

/**
 * Loading placeholders that match the shape of what arrives.
 *
 * A centred spinner tells you nothing and makes the layout jump when content
 * lands. A skeleton in the final geometry means the page settles instead of
 * reflowing — and shipping only the populated state is the most reliable
 * failure in generated UI.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-sm bg-border-subtle/70", className)}
    />
  );
}

/** A stat-tile row, at the real tile height. */
export function StatRowSkeleton({ tiles = 4 }: { tiles?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: tiles }, (_, i) => (
        <div key={i} className="rounded-lg bg-surface p-4">
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="mt-3 h-7 w-28" />
          <Skeleton className="mt-2 h-2 w-24" />
        </div>
      ))}
    </div>
  );
}

/** A table at the real 32px row height, so nothing shifts when data lands. */
export function TableSkeleton({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded-lg bg-surface">
      <div className="flex h-8 items-center gap-3 border-b border-border-subtle px-3">
        {Array.from({ length: cols }, (_, i) => (
          <Skeleton key={i} className="h-2 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex h-8 items-center gap-3 border-b border-border-subtle/70 px-3 last:border-0">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className="h-2 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function PanelSkeleton({ lines = 4, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("rounded-lg bg-surface p-4", className)}>
      <Skeleton className="h-2.5 w-32" />
      <div className="mt-4 space-y-2.5">
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} className="h-2 w-full" />
        ))}
      </div>
    </div>
  );
}

/**
 * Page shell so the header does not pop in after the body.
 *
 * The band is `--header-h`, the same fixed height as the real page bar and the
 * sidebar's workspace band. It has to be: as a padded auto-height row this
 * stood at 60px and then jumped to 64px when the route resolved, which is
 * precisely the pop this component exists to prevent — and while it loaded,
 * its rule missed the sidebar's.
 */
export function PageSkeleton({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" aria-label="Loading">
      <header className="flex h-[var(--header-h)] items-center justify-between gap-4 border-b border-border-subtle bg-sunken px-8">
        <div>
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-2 h-2 w-56" />
        </div>
        <Skeleton className="h-8 w-24 rounded-md" />
      </header>
      <div className="space-y-4 p-6">{children}</div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
