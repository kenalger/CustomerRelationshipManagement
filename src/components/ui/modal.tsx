"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef } from "react";

import { cn } from "@/lib/utils";
import { isTopLayer, popLayer, pushLayer } from "@/lib/layer-stack";

const WIDTH = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-2xl",
  xl: "max-w-5xl",
} as const;

/**
 * A route-driven dialog.
 *
 * Closing calls `router.back()` rather than flipping local state, because the
 * URL is the source of truth: the link is shareable, refreshing renders the
 * full page instead, and the browser Back button closes the dialog. State-only
 * modals break all three.
 */
export function Modal({
  title,
  description,
  children,
  size = "lg",
  footer,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  size?: keyof typeof WIDTH;
  footer?: React.ReactNode;
}) {
  const router = useRouter();
  const layerId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusTo = useRef<Element | null>(null);

  const close = useCallback(() => router.back(), [router]);

  useEffect(() => {
    pushLayer({ id: layerId, kind: "modal" });
    restoreFocusTo.current = document.activeElement;

    // Body scroll lock, compensating for the scrollbar so the page behind does
    // not jump sideways as it disappears.
    const gap = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = document.body.style.overflow;
    const prevPad = document.body.style.paddingRight;
    document.body.style.overflow = "hidden";
    if (gap > 0) document.body.style.paddingRight = `${gap}px`;

    // Focus the panel, not the first input: a dialog that steals the caret
    // into a field makes Escape feel unreachable and scrolls long forms.
    panelRef.current?.focus();

    return () => {
      popLayer(layerId);
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPad;
      if (restoreFocusTo.current instanceof HTMLElement) restoreFocusTo.current.focus();
    };
  }, [layerId]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Only the topmost layer reacts, so a dropdown inside the dialog gets
      // Escape before the dialog does.
      if (!isTopLayer(layerId)) return;

      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }

      if (event.key !== "Tab") return;

      // Focus trap. Without it, Tab walks into the page behind the overlay.
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === panelRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [layerId, close]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/45 p-4 sm:p-8"
      onClick={(event) => {
        // Only a click on the scrim itself, not a drag that ended there.
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          "w-full rounded-xl bg-surface shadow-[var(--shadow-overlay)] outline-none",
          "max-h-[calc(100dvh-4rem)] overflow-hidden",
          "flex flex-col",
          WIDTH[size],
        )}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border-subtle px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="t-heading truncate">{title}</h2>
            {description ? (
              <p className="mt-0.5 truncate text-[13px] text-muted">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="-mr-1 shrink-0 rounded-md p-1.5 text-muted transition-colors hover:bg-hover hover:text-foreground"
          >
            <X size={15} strokeWidth={1.75} aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>

        {footer ? (
          <footer className="flex items-center justify-end gap-2 border-t border-border-subtle px-5 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
