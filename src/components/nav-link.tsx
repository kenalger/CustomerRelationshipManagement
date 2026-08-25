"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

export function NavLink({
  href,
  icon,
  children,
  badge = 0,
  badgeTone = "neutral",
}: {
  href: ComponentProps<typeof Link>["href"];
  /**
   * A rendered element, not a component. This is a Client Component, and a
   * Server Component cannot pass a function across the boundary — only the
   * already-rendered element survives serialisation.
   */
  icon: ReactNode;
  children: ReactNode;
  badge?: number;
  /** `alert` turns the count red — used when the count means something is wrong. */
  badgeTone?: "neutral" | "alert";
}) {
  const pathname = usePathname();
  const path = String(href);
  const active = pathname === path || pathname.startsWith(`${path}/`);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-[30px] items-center gap-2 rounded-md px-2.5",
        "text-[14px] transition-colors duration-100 ease-out",
        active
          ? "bg-hover font-[560] text-foreground"
          : "text-secondary hover:bg-hover hover:text-foreground",
      )}
    >
      <span className="shrink-0" aria-hidden>
        {icon}
      </span>
      <span className="flex-1 truncate">{children}</span>
      {badge > 0 ? (
        <span
          className={cn(
            "min-w-4 rounded-sm px-1 text-center text-[12px] font-[560] leading-[16px] tabular-nums",
            badgeTone === "alert"
              ? "bg-[var(--tag-red-bg)] text-[var(--tag-red-fg)]"
              : "bg-[var(--tag-gray-bg)] text-[var(--tag-gray-fg)]",
          )}
          aria-label={`${badge} unread`}
        >
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </Link>
  );
}
