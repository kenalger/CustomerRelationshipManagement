import type { CSSProperties } from "react";

import { hueFor } from "@/lib/hue";
import { cn } from "@/lib/utils";

/**
 * The workspace mark in the sidebar.
 *
 * Coloured from the organisation's own name rather than a flat grey, so a
 * person in two workspaces can tell them apart at a glance — a grey square
 * with a letter in it looks identical for every customer.
 */
export function WorkspaceTile({
  name,
  size = 28,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const hue = hueFor(name);

  const style = {
    width: size,
    height: size,
    fontSize: Math.max(11, Math.round(size * 0.46)),
    "--tile-bg": `hsl(${hue} 52% 46%)`,
    "--tile-fg": `hsl(${hue} 60% 97%)`,
    "--tile-bg-dark": `hsl(${hue} 44% 38%)`,
    "--tile-fg-dark": `hsl(${hue} 55% 94%)`,
  } as CSSProperties;

  return (
    <span
      aria-hidden
      style={style}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md font-semibold leading-none",
        "bg-[var(--tile-bg)] text-[var(--tile-fg)]",
        "dark:bg-[var(--tile-bg-dark)] dark:text-[var(--tile-fg-dark)]",
        className,
      )}
    >
      {name.trim().charAt(0).toUpperCase() || "W"}
    </span>
  );
}
