"use client";

import { Plus } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { TagChip, tagStyle } from "@/components/crm/tag-chip";
import type { TagColour } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";
import { applyTagAction, createTagAction, removeTagAction } from "@/server/actions/tags";
import type { TagTarget } from "@/server/services/tags";

type Tag = { id: string; name: string; colour: TagColour };

/**
 * Tags on one record, with a picker.
 *
 * Optimistic by hand rather than with `useOptimistic`: the list has to survive
 * a failed server action by reverting, and `useOptimistic` discards its
 * override when the transition ends regardless of the outcome — which would
 * flash the tag back in and then out again on an error.
 */
export function TagPicker({
  target,
  tags,
  all,
  canEdit,
}: {
  target: TagTarget;
  tags: Tag[];
  all: Tag[];
  canEdit: boolean;
}) {
  const [applied, setApplied] = useState<Tag[]>(tags);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);

  // The server is the source of truth after a revalidate; without this the list
  // would keep showing the optimistic state from the last interaction. Adjusted
  // during render rather than in an effect — React's own pattern for resetting
  // state when a prop changes, and it avoids a second render pass showing the
  // stale list first.
  const [seen, setSeen] = useState(tags);
  if (seen !== tags) {
    setSeen(tags);
    setApplied(tags);
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const appliedIds = new Set(applied.map((t) => t.id));
  const trimmed = query.trim();
  const candidates = all
    .filter((t) => !appliedIds.has(t.id))
    .filter((t) => t.name.toLowerCase().includes(trimmed.toLowerCase()));

  // Case-insensitive, because that is the uniqueness rule the service enforces:
  // offering "Create enterprise" when "Enterprise" exists would always fail.
  const exists = all.some((t) => t.name.toLowerCase() === trimmed.toLowerCase());

  const apply = (tag: Tag) => {
    setApplied((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)));
    setQuery("");
    start(async () => {
      const result = await applyTagAction(tag.id, target);
      if (!result.ok) {
        setApplied((prev) => prev.filter((t) => t.id !== tag.id));
        toast.error(result.error);
      }
    });
  };

  const remove = (tag: Tag) => {
    setApplied((prev) => prev.filter((t) => t.id !== tag.id));
    start(async () => {
      const result = await removeTagAction(tag.id, target);
      if (!result.ok) {
        setApplied((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)));
        toast.error(result.error);
      }
    });
  };

  const createAndApply = () => {
    if (trimmed === "" || exists) return;
    start(async () => {
      const result = await createTagAction({ name: trimmed, colour: "GRAY" });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const tag = { id: result.data.id, name: trimmed, colour: "GRAY" as TagColour };
      setApplied((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)));
      setQuery("");
      const link = await applyTagAction(tag.id, target);
      if (!link.ok) {
        setApplied((prev) => prev.filter((t) => t.id !== tag.id));
        toast.error(link.error);
      }
    });
  };

  return (
    <div ref={box} className="relative flex flex-wrap items-center gap-1.5">
      {applied.map((tag) => (
        <TagChip
          key={tag.id}
          name={tag.name}
          colour={tag.colour}
          onRemove={canEdit ? () => remove(tag) : undefined}
        />
      ))}

      {applied.length === 0 && !canEdit ? (
        <span className="text-[13px] text-muted">No tags</span>
      ) : null}

      {canEdit ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="listbox"
          className="inline-flex items-center gap-1 rounded-sm border border-dashed border-border-subtle-strong px-1.5 py-0.5 text-[13px] leading-5 text-muted transition-colors hover:border-border-strong hover:text-foreground"
        >
          <Plus size={12} strokeWidth={2} />
          Tag
        </button>
      ) : null}

      {open ? (
        <div className="absolute left-0 top-full z-20 mt-1.5 w-64 rounded-md border border-border-subtle bg-surface p-1.5 shadow-lg">
          <input
            autoFocus
            value={query}
            maxLength={40}
            placeholder="Search or create"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              if (candidates.length > 0) apply(candidates[0]);
              else createAndApply();
            }}
            aria-label="Search tags"
            className="mb-1 h-8 w-full rounded-sm border border-border-subtle-strong bg-page px-2 text-[14px] outline-none focus:border-accent"
          />

          <div role="listbox" className="max-h-56 overflow-auto">
            {candidates.map((tag) => (
              <button
                key={tag.id}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => apply(tag)}
                className="flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left hover:bg-hover"
              >
                <span style={tagStyle(tag.colour)} className="size-3 shrink-0 rounded-xs" />
                <span className="truncate text-[13px]">{tag.name}</span>
              </button>
            ))}

            {trimmed !== "" && !exists ? (
              <button
                type="button"
                onClick={createAndApply}
                className="flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left hover:bg-hover"
              >
                <Plus size={12} strokeWidth={2} className="shrink-0 text-muted" />
                <span className="truncate text-[13px]">
                  Create <span className="font-[560]">{trimmed}</span>
                </span>
              </button>
            ) : null}

            {candidates.length === 0 && (trimmed === "" || exists) ? (
              <p className={cn("px-1.5 py-2 text-[13px] text-muted")}>
                {all.length === 0 ? "No tags in this workspace yet." : "Every tag is already on this record."}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
