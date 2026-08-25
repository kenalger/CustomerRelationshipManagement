import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

/** Deterministic hue per person, so the same rep is the same colour everywhere. */
function hueFor(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) % 360;
  return hash;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({
  name,
  size = 20,
  className,
}: {
  name: string | null | undefined;
  size?: number;
  className?: string;
}) {
  const label = name?.trim() || "Unassigned";
  const hue = hueFor(label);

  // Both themes are computed here and picked by the `dark:` variant — a pale
  // tint that works on white becomes an eye-searing blob on a dark ground.
  const style = {
    width: size,
    height: size,
    fontSize: Math.max(9, Math.round(size * 0.42)),
    "--avatar-bg": `hsl(${hue} 60% 91%)`,
    "--avatar-fg": `hsl(${hue} 65% 27%)`,
    "--avatar-bg-dark": `hsl(${hue} 32% 24%)`,
    "--avatar-fg-dark": `hsl(${hue} 70% 80%)`,
  } as CSSProperties;

  return (
    <span
      title={label}
      style={style}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold leading-none",
        "bg-[var(--avatar-bg)] text-[var(--avatar-fg)]",
        "dark:bg-[var(--avatar-bg-dark)] dark:text-[var(--avatar-fg-dark)]",
        className,
      )}
    >
      {initials(label)}
    </span>
  );
}
