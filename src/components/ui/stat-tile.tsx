import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function StatTile({
  label,
  value,
  sub,
  icon: Icon,
  href,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  icon: LucideIcon;
  href?: ComponentProps<typeof Link>["href"];
  /** `alert` is for figures that mean something is wrong, never for emphasis. */
  tone?: "neutral" | "alert";
}) {
  const body = (
    <div
      className={cn(
        "h-full rounded-lg border bg-surface p-3.5 transition-colors duration-100",
        tone === "alert" ? "border-danger/30" : "border-border-subtle",
        href && "hover:border-accent",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="t-caps text-muted">{label}</p>
        <Icon
          size={14}
          strokeWidth={1.75}
          aria-hidden
          className={tone === "alert" ? "text-danger" : "text-muted"}
        />
      </div>
      <p
        className={cn("t-display mt-2 tabular-nums", tone === "alert" && "text-danger")}
      >
        {value}
      </p>
      {sub ? <p className="mt-1 text-[13px] text-muted">{sub}</p> : null}
    </div>
  );

  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}
