import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A bordered surface.
 *
 * v1 removed the border because "a 1px ring on everything" is a named tell.
 * That was wrong for this product: in a database UI the light borders ARE the
 * structure, and without one a panel floats with nothing to define it. The
 * tell is a ring plus a shadow plus a radius all doing the same job — so the
 * shadow is gone and the radius is small instead.
 */
export function Panel({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-md border border-border-subtle bg-surface",
        className,
      )}
    >
      {title ? (
        <header className="flex items-center justify-between gap-3 border-b border-border-subtle px-5 py-3">
          <div className="min-w-0">
            <h2 className="t-heading">{title}</h2>
            {description ? <p className="mt-0.5 text-[12px] text-muted">{description}</p> : null}
          </div>
          {action}
        </header>
      ) : null}
      {/* Inner radius = outer − padding, so a nested surface never reads as a
          mismatch. 8px outer with 12px padding leaves square corners. */}
      <div className={cn("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function DetailField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="shrink-0 text-[13px] text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right text-[13px]">
        {value || <span className="text-muted">—</span>}
      </dd>
    </div>
  );
}
