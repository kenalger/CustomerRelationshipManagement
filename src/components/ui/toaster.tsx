"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";

/**
 * Toasts inherit the app's tokens rather than sonner's defaults, so a
 * confirmation never arrives in a different visual language to the page that
 * triggered it.
 */
export function Toaster() {
  const { resolvedTheme } = useTheme();

  return (
    <Sonner
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      position="bottom-right"
      duration={4000}
      toastOptions={{
        style: {
          background: "var(--surface)",
          border: "1px solid var(--border-strong)",
          borderRadius: "8px",
          color: "var(--ink)",
          boxShadow: "var(--shadow-[var(--shadow-overlay)])",
          fontSize: "13px",
        },
      }}
    />
  );
}
