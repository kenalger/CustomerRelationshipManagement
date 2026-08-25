"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

import { isTopLayer, popLayer, pushLayer } from "@/lib/layer-stack";
import { cn } from "@/lib/utils";

/**
 * A dropdown menu.
 *
 * Registers on the overlay stack so ⌘K cannot open on top of it and Escape
 * closes the menu rather than the page behind. Keyboard behaviour follows the
 * usual menu-button contract: Enter/Space/ArrowDown open and focus the first
 * item, arrows move, Home/End jump, Escape closes and returns focus.
 */
export function Menu({
  trigger,
  children,
  align = "start",
  className,
  label,
}: {
  trigger: (props: { open: boolean }) => React.ReactNode;
  children: React.ReactNode;
  align?: "start" | "end";
  className?: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const layerId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const close = useCallback(
    (returnFocus = true) => {
      setOpen(false);
      if (returnFocus) triggerRef.current?.focus();
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    pushLayer({ id: layerId, kind: "modal" });
    return () => popLayer(layerId);
  }, [open, layerId]);

  useEffect(() => {
    if (!open) return;

    function items() {
      return Array.from(
        listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [],
      );
    }

    function onKeyDown(event: KeyboardEvent) {
      if (!isTopLayer(layerId)) return;

      const list = items();
      const index = list.indexOf(document.activeElement as HTMLElement);

      switch (event.key) {
        case "Escape":
          event.preventDefault();
          close();
          break;
        case "ArrowDown":
          event.preventDefault();
          list[Math.min(index + 1, list.length - 1)]?.focus();
          break;
        case "ArrowUp":
          event.preventDefault();
          // Above the first item, focus goes back to the trigger rather than
          // wrapping — wrapping in a short menu feels like a trap.
          if (index <= 0) triggerRef.current?.focus();
          else list[index - 1]?.focus();
          break;
        case "Home":
          event.preventDefault();
          list[0]?.focus();
          break;
        case "End":
          event.preventDefault();
          list[list.length - 1]?.focus();
          break;
        case "Tab":
          // Tabbing out of a menu closes it, per the menu-button pattern.
          close(false);
          break;
      }
    }

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    }

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    // Focus the first item so the menu is immediately keyboard-navigable.
    requestAnimationFrame(() => items()[0]?.focus());

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open, layerId, close]);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className="w-full text-left"
      >
        {trigger({ open })}
      </button>

      {open ? (
        <div
          ref={listRef}
          role="menu"
          aria-label={label}
          className={cn(
            "absolute z-50 mt-1 min-w-56 rounded-md border border-border-subtle bg-surface p-1",
            "shadow-[var(--shadow-pop)]",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function MenuItem({
  children,
  onSelect,
  href,
  icon,
  danger = false,
  shortcut,
}: {
  children: React.ReactNode;
  onSelect?: () => void;
  href?: string;
  icon?: React.ReactNode;
  danger?: boolean;
  shortcut?: string;
}) {
  const shared = cn(
    "flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left text-[14px]",
    "outline-none transition-colors duration-100",
    danger
      ? "text-danger hover:bg-[var(--tag-red-bg)] focus:bg-[var(--tag-red-bg)]"
      : "text-foreground hover:bg-hover focus:bg-hover",
  );

  const body = (
    <>
      {icon ? (
        <span className={cn("shrink-0", danger ? "text-danger" : "text-muted")} aria-hidden>
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut ? (
        <kbd className="shrink-0 text-[12px] text-muted">{shortcut}</kbd>
      ) : null}
    </>
  );

  if (href) {
    return (
      <a role="menuitem" href={href} className={shared}>
        {body}
      </a>
    );
  }

  return (
    <button role="menuitem" type="button" onClick={onSelect} className={shared}>
      {body}
    </button>
  );
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <p className="px-2 pb-1 pt-1.5 text-[12px] text-muted">{children}</p>;
}

export function MenuSeparator() {
  return <hr className="my-1 border-0 border-t border-border-subtle" />;
}
