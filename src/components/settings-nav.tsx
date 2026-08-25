"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const SECTIONS = [
  { href: "/settings/organization", label: "General" },
  { href: "/settings/team", label: "Members" },
  { href: "/settings/pipelines", label: "Pipelines" },
  { href: "/settings/connections", label: "Connections" },
] as const;

/**
 * Sub-navigation for settings.
 *
 * A tab row rather than a third sidebar: the app already has a 248px nav, and
 * three columns for four rarely-visited pages is a worse trade than one row of
 * tabs. `aria-current` marks the active section for assistive tech, and the
 * underline is 2px so it reads as selection rather than as a border.
 */
export function SettingsNav({ alert = 0 }: { alert?: number }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Settings sections" className="border-b border-border-subtle">
      <div className="mx-auto flex w-full max-w-5xl gap-1 px-8">
      {SECTIONS.map((section) => {
        const active = pathname === section.href || pathname.startsWith(`${section.href}/`);
        const showAlert = section.href === "/settings/connections" && alert > 0;

        return (
          <Link
            key={section.href}
            href={section.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex items-center gap-1.5 px-2.5 py-2.5 text-[14px] transition-colors",
              active
                ? "font-[560] text-foreground"
                : "text-secondary hover:text-foreground",
            )}
          >
            {section.label}
            {showAlert ? (
              <span className="rounded-sm bg-[var(--tag-red-bg)] px-1 text-[12px] font-[560] leading-4 tabular-nums text-[var(--tag-red-fg)]">
                {alert}
              </span>
            ) : null}
            {active ? (
              <span
                aria-hidden
                className="absolute inset-x-1.5 -bottom-px h-0.5 rounded-sm bg-foreground"
              />
            ) : null}
          </Link>
        );
      })}
      </div>
    </nav>
  );
}
