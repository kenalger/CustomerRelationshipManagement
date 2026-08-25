"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;

/**
 * Three-state segmented control rather than a binary switch: "system" is a
 * real preference, and collapsing it into a toggle silently overrides the
 * user's OS setting the first time they click.
 */
export function ThemeToggle() {
  // `theme` is undefined on the server, so nothing reads as selected until
  // next-themes re-renders after hydration. That avoids a setState-in-effect
  // and still never flashes the wrong selection.
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="flex items-center gap-0.5 rounded-lg border border-border-subtle p-0.5"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const selected = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-md transition-colors",
              selected
                ? "bg-surface text-foreground"
                : "text-muted hover:text-foreground",
            )}
          >
            <Icon size={13} strokeWidth={2} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
