"use client";

import { Command } from "cmdk";
import {
  Building2,
  CircleDollarSign,
  KanbanSquare,
  LayoutDashboard,
  Plus,
  Search,
  Sparkles,
  User,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";

import { hasLayer, popLayer, pushLayer } from "@/lib/layer-stack";
import { searchAction } from "@/server/actions/search";
import type { SearchHit } from "@/server/services/search";

const KIND_ICON = {
  lead: Sparkles,
  contact: User,
  company: Building2,
  deal: CircleDollarSign,
} as const;

const ROUTES = [
  { label: "Go to Overview", href: "/dashboard", Icon: LayoutDashboard },
  { label: "Go to Leads", href: "/leads", Icon: Sparkles },
  { label: "Go to Pipeline", href: "/deals", Icon: KanbanSquare },
  { label: "Go to Contacts", href: "/contacts", Icon: Users },
  { label: "Go to Companies", href: "/companies", Icon: Building2 },
  { label: "New contact", href: "/contacts/new", Icon: Plus },
  { label: "New company", href: "/companies/new", Icon: Plus },
  { label: "New deal", href: "/deals/new", Icon: Plus },
] as const;

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, startSearch] = useTransition();

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "k" || !(event.metaKey || event.ctrlKey)) return;
      // A dialog is already the focused layer — opening the palette on top of
      // it would put two overlays in play and leave Escape ambiguous.
      if (!open && hasLayer("modal")) return;
      event.preventDefault();
      setOpen((prev) => !prev);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Register as a layer while open, so anything opened above it wins the keys.
  useEffect(() => {
    if (!open) return;
    const id = "command-palette";
    pushLayer({ id, kind: "palette" });
    return () => popLayer(id);
  }, [open]);

  const short = term.trim().length < 2;

  // Debounced: a query per keystroke would hammer four tables per character.
  useEffect(() => {
    if (short) return;
    const timer = setTimeout(() => {
      startSearch(async () => setHits(await searchAction(term)));
    }, 180);
    return () => clearTimeout(timer);
  }, [term, short]);

  // Derived rather than cleared in an effect: stale results must not flash
  // while the query is being retyped.
  const visibleHits = short ? [] : hits;

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      setTerm("");
      router.push(href);
    },
    [router],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh] backdrop-blur-[2px]"
      onClick={() => setOpen(false)}
    >
      <Command
        label="Command palette"
        shouldFilter={false}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-xl border border-border-strong bg-surface shadow-[var(--shadow-overlay)]"
      >
        <div className="flex items-center gap-2 border-b border-border-subtle px-3">
          <Search size={15} strokeWidth={1.75} aria-hidden className="shrink-0 text-muted" />
          <Command.Input
            autoFocus
            value={term}
            onValueChange={setTerm}
            placeholder="Search leads, contacts, companies, deals…"
            className="h-11 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted"
          />
          <kbd className="rounded border border-border-subtle px-1.5 py-0.5 text-[12px] text-muted">
            esc
          </kbd>
        </div>

        <Command.List className="max-h-[340px] overflow-y-auto p-1.5">
          <Command.Empty className="px-3 py-6 text-center text-[12px] text-muted">
            {short
              ? "Type at least two characters."
              : searching
                ? "Searching…"
                : "Nothing found."}
          </Command.Empty>

          {visibleHits.length > 0 ? (
            <Command.Group
              heading="Records"
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[12px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.06em] [&_[cmdk-group-heading]]:text-muted"
            >
              {visibleHits.map((hit) => {
                const Icon = KIND_ICON[hit.kind];
                return (
                  <Command.Item
                    key={`${hit.kind}-${hit.id}`}
                    value={`${hit.kind}-${hit.id}`}
                    onSelect={() => go(hit.href)}
                    className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[12px] data-[selected=true]:bg-accent-soft data-[selected=true]:text-accent"
                  >
                    <Icon size={14} strokeWidth={1.75} aria-hidden className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{hit.title}</span>
                    {hit.subtitle ? (
                      <span className="shrink-0 truncate text-[12px] text-muted">
                        {hit.subtitle}
                      </span>
                    ) : null}
                  </Command.Item>
                );
              })}
            </Command.Group>
          ) : null}

          {short ? (
            <Command.Group
              heading="Jump to"
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[12px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.06em] [&_[cmdk-group-heading]]:text-muted"
            >
              {ROUTES.map((route) => (
                <Command.Item
                  key={route.href}
                  value={route.label}
                  onSelect={() => go(route.href)}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[12px] data-[selected=true]:bg-accent-soft data-[selected=true]:text-accent"
                >
                  <route.Icon size={14} strokeWidth={1.75} aria-hidden className="shrink-0" />
                  {route.label}
                </Command.Item>
              ))}
            </Command.Group>
          ) : null}
        </Command.List>
      </Command>
    </div>
  );
}

/** Sidebar affordance — a shortcut nobody knows about does not exist. */
export function CommandHint() {
  return (
    <button
      type="button"
      onClick={() =>
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }),
        )
      }
      className="flex h-7 w-full items-center gap-2 rounded-md border border-border-subtle bg-sunken px-2 text-[12px] text-muted transition-colors hover:border-border-strong hover:text-foreground"
    >
      <Search size={13} strokeWidth={1.75} aria-hidden />
      <span className="flex-1 text-left">Search</span>
      <kbd className="rounded border border-border-subtle px-1 text-[12px]">⌘K</kbd>
    </button>
  );
}
