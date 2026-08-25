import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 flex h-[var(--header-h)] items-center justify-between gap-4 border-b border-border-subtle bg-page pl-8 pr-20">
      <div className="min-w-0">
        <h1 className="t-heading truncate">{title}</h1>
        {description ? <p className="truncate text-[13px] text-muted">{description}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </header>
  );
}

export { EmptyState } from "@/components/ui/empty-state";
