"use client";

import { Tag as TagIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { TAG_COLOURS, TagChip, tagStyle } from "@/components/crm/tag-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import type { TagColour } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";
import {
  createTagAction,
  deleteTagAction,
  renameTagAction,
  setTagColourAction,
} from "@/server/actions/tags";

type Tag = {
  id: string;
  name: string;
  colour: TagColour;
  usageCount: number;
};

/** Nine swatches in a row — the palette is small enough to show whole. */
function ColourPicker({
  value,
  onPick,
  disabled,
}: {
  value: TagColour;
  onPick: (colour: TagColour) => void;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label="Tag colour" className="flex flex-wrap gap-1">
      {TAG_COLOURS.map((colour) => (
        <button
          key={colour}
          type="button"
          disabled={disabled}
          onClick={() => onPick(colour)}
          aria-label={colour.toLowerCase()}
          aria-pressed={value === colour}
          style={tagStyle(colour)}
          className={cn(
            "size-6 rounded-sm border-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            // Selection is a ring, not a size change: nine swatches that grow
            // on hover make the row reflow under the pointer.
            value === colour ? "border-foreground" : "border-transparent hover:border-border-strong",
          )}
        />
      ))}
    </div>
  );
}

function TagRow({
  tag,
  canWrite,
  canDelete,
}: {
  tag: Tag;
  canWrite: boolean;
  canDelete: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(tag.name);
  const [pending, start] = useTransition();

  const commitName = () => {
    const next = name.trim();
    setEditing(false);
    if (next === tag.name || next === "") {
      setName(tag.name);
      return;
    }
    start(async () => {
      const result = await renameTagAction(tag.id, next);
      if (!result.ok) {
        setName(tag.name);
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-5 py-3 last:border-0">
      <div className="min-w-0 flex-1">
        {editing ? (
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              if (e.key === "Escape") {
                setName(tag.name);
                setEditing(false);
              }
            }}
            className="max-w-[260px]"
            aria-label="Tag name"
          />
        ) : (
          <button
            type="button"
            disabled={!canWrite}
            onClick={() => setEditing(true)}
            className="cursor-text disabled:cursor-default"
            aria-label={canWrite ? `Rename ${tag.name}` : undefined}
          >
            <TagChip name={tag.name} colour={tag.colour} />
          </button>
        )}
      </div>

      <ColourPicker
        value={tag.colour}
        disabled={!canWrite || pending}
        onPick={(colour) =>
          start(async () => {
            const result = await setTagColourAction(tag.id, colour);
            if (!result.ok) toast.error(result.error);
          })
        }
      />

      {/* A count, not a bare number: "0" beside a tag has to read as "unused". */}
      <span className="w-24 shrink-0 text-right text-[13px] tabular-nums text-muted">
        {tag.usageCount === 0
          ? "Unused"
          : `${tag.usageCount} ${tag.usageCount === 1 ? "record" : "records"}`}
      </span>

      {canDelete ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await deleteTagAction(tag.id);
              if (!result.ok) toast.error(result.error);
              else toast.success(`Deleted ${tag.name}`);
            })
          }
        >
          Delete
        </Button>
      ) : null}
    </div>
  );
}

export function TagsClient({
  tags,
  canWrite,
  canDelete,
}: {
  tags: Tag[];
  canWrite: boolean;
  canDelete: boolean;
}) {
  const [name, setName] = useState("");
  const [colour, setColour] = useState<TagColour>("GRAY");
  const [pending, start] = useTransition();

  const create = () => {
    const trimmed = name.trim();
    if (trimmed === "") return;
    start(async () => {
      const result = await createTagAction({ name: trimmed, colour });
      if (result.ok) {
        setName("");
        setColour("GRAY");
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="space-y-5">
      {canWrite ? (
        <section className="rounded-md border border-border-subtle bg-surface">
          <header className="border-b border-border-subtle px-5 py-3.5">
            <h3 className="t-heading">New tag</h3>
            <p className="mt-0.5 text-[13px] text-muted">
              Names are case-insensitive, so &ldquo;Enterprise&rdquo; and &ldquo;enterprise&rdquo;
              cannot both exist.
            </p>
          </header>
          <div className="flex flex-wrap items-end gap-3 p-5">
            <div className="min-w-[200px] flex-1">
              <label htmlFor="tag-name" className="t-label mb-1.5 block">
                Name
              </label>
              <Input
                id="tag-name"
                value={name}
                maxLength={40}
                placeholder="e.g. Retainer client"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") create();
                }}
              />
            </div>
            <div>
              <span className="t-label mb-1.5 block">Colour</span>
              <ColourPicker value={colour} onPick={setColour} disabled={pending} />
            </div>
            <Button size="sm" onClick={create} loading={pending} disabled={name.trim() === ""}>
              Add tag
            </Button>
          </div>
        </section>
      ) : null}

      <section className="rounded-md border border-border-subtle bg-surface">
        <header className="border-b border-border-subtle px-5 py-3.5">
          <h3 className="t-heading">{tags.length === 1 ? "1 tag" : `${tags.length} tags`}</h3>
        </header>
        {tags.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={TagIcon}
              title="No tags yet"
              hint="Tags are how a segment gets built — start with the two or three distinctions the team already makes out loud."
            />
          </div>
        ) : (
          <div>
            {tags.map((tag) => (
              <TagRow key={tag.id} tag={tag} canWrite={canWrite} canDelete={canDelete} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
