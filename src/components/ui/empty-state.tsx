import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * An empty state must say what this is and what to do next. "No data" tells a
 * rep nothing and leaves them stuck.
 */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-border-subtle-strong bg-surface px-6 py-12 text-center">
      <span className="mb-3.5 flex size-10 items-center justify-center rounded-md bg-[var(--tag-gray-bg)] text-[var(--tag-gray-fg)]">
        <Icon size={17} strokeWidth={1.75} aria-hidden />
      </span>
      <p className="t-heading">{title}</p>
      <p className="mt-1.5 max-w-sm text-[14px] text-muted">{hint}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
