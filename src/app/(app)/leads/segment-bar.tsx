"use client";

import { Bookmark, Lock, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { createSegmentAction, deleteSegmentAction } from "@/server/actions/segments";

type Segment = {
  id: string;
  name: string;
  shared: boolean;
  ownerId: string;
};

/**
 * Saved views for the lead queue.
 *
 * The bar reads the current URL rather than taking the filters as props: the
 * filters already live in the query string, which is what makes them
 * shareable, and duplicating them into React state would give two sources of
 * truth that drift the first time someone uses the back button.
 */
export function SegmentBar({
  segments,
  activeId,
  currentUserId,
  canWrite,
}: {
  segments: Segment[];
  activeId: string | null;
  currentUserId: string;
  canWrite: boolean;
}) {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(true);
  const [pending, start] = useTransition();

  const status = params.get("status") ?? "";

  /*
   * What is on screen right now, as a segment document.
   *
   * Only status: sort and page are view state rather than membership, and the
   * free-text search is deliberately not saved — "everyone matching acme" is a
   * lookup, not a segment, and freezing a substring into a saved view produces
   * a list that quietly changes meaning as records are edited.
   *
   * The document vocabulary is much wider than this (score, source, tags,
   * staleness); this bar only captures what the lead list itself can express.
   */
  const filter: Record<string, unknown> = status ? { status: [status] } : {};
  const describable = status !== "";

  const save = () => {
    const trimmed = name.trim();
    if (trimmed === "") return;
    start(async () => {
      const result = await createSegmentAction({
        name: trimmed,
        entity: "LEAD",
        filter,
        shared,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setNaming(false);
      setName("");
      router.push(`${pathname}?segment=${result.data.id}`);
    });
  };

  const remove = (segment: Segment) =>
    start(async () => {
      const result = await deleteSegmentAction(segment.id, "LEAD");
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Deleted ${segment.name}`);
      if (activeId === segment.id) router.push(pathname);
    });

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {segments.map((segment) => {
        const active = segment.id === activeId;
        return (
          <span
            key={segment.id}
            className={cn(
              "group inline-flex items-center rounded-md border text-[13px] transition-colors",
              active
                ? "border-accent bg-accent-soft text-accent"
                : "border-border-subtle-strong text-secondary hover:bg-hover hover:text-foreground",
            )}
          >
            <Link
              href={`/leads?segment=${segment.id}`}
              aria-current={active ? "page" : undefined}
              className="flex items-center gap-1.5 py-1 pl-2.5 pr-1.5"
            >
              {segment.shared ? null : (
                <Lock size={11} strokeWidth={2} aria-label="Private" className="shrink-0" />
              )}
              <span className="max-w-[180px] truncate">{segment.name}</span>
            </Link>
            {canWrite && (segment.ownerId === currentUserId || active) ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => remove(segment)}
                aria-label={`Delete segment ${segment.name}`}
                className="mr-1 rounded-xs px-1 py-1 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-60 hover:!opacity-100"
              >
                <X size={12} strokeWidth={2} />
              </button>
            ) : null}
          </span>
        );
      })}

      {activeId ? (
        <Link
          href="/leads"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] text-muted transition-colors hover:bg-hover hover:text-foreground"
        >
          Clear view
        </Link>
      ) : null}

      {canWrite && !naming ? (
        <button
          type="button"
          onClick={() => setNaming(true)}
          disabled={!describable}
          title={
            describable
              ? undefined
              : "Pick a status first — a saved view of everything is just the list"
          }
          className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border-subtle-strong px-2.5 py-1 text-[13px] text-muted transition-colors hover:border-border-strong hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Bookmark size={12} strokeWidth={2} />
          Save this view
        </button>
      ) : null}

      {naming ? (
        <span className="inline-flex items-center gap-2 rounded-md border border-border-subtle bg-surface px-2 py-1">
          <Input
            autoFocus
            value={name}
            maxLength={60}
            placeholder="Name this view"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setNaming(false);
            }}
            aria-label="Segment name"
            className="h-7 w-44"
          />
          <label className="flex cursor-pointer items-center gap-1.5 text-[13px] text-secondary">
            <input
              type="checkbox"
              checked={shared}
              onChange={(e) => setShared(e.target.checked)}
              className="size-3.5 cursor-pointer accent-[var(--accent)]"
            />
            Share with the team
          </label>
          <Button size="sm" onClick={save} loading={pending} disabled={name.trim() === ""}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setNaming(false)}>
            Cancel
          </Button>
        </span>
      ) : null}
    </div>
  );
}
