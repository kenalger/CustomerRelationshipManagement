"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { type CellPos, useGrid } from "@/components/crm/grid";
import { cn } from "@/lib/utils";
import { type EditableEntity, saveFieldAction } from "@/server/actions/records";

/**
 * An editable table cell.
 *
 * Soft focus draws a ring; edit mode swaps in an input. Escape reverts and
 * hands focus back to the grid rather than the page. Blur commits, because
 * losing a typed value by clicking away is the worst thing a grid can do.
 */
export function GridCell({
  pos,
  entity,
  id,
  field,
  label,
  value,
  type = "text",
  editable = true,
  align = "left",
  children,
}: {
  pos: CellPos;
  entity: EditableEntity;
  id: string;
  field: string;
  label: string;
  value: string | null;
  type?: "text" | "email" | "tel";
  editable?: boolean;
  align?: "left" | "right";
  /** Read-mode presentation. Falls back to the raw value. */
  children?: React.ReactNode;
}) {
  const grid = useGrid();
  const [current, setCurrent] = useState(value ?? "");
  const [saving, startSave] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const cellRef = useRef<HTMLDivElement>(null);

  const focused = grid.isFocused(pos);
  const editing = grid.isEditing(pos);

  function commit(next: string, moveTo?: CellPos) {
    if (next === current) {
      grid.endEdit({ moveTo });
      return;
    }
    startSave(async () => {
      const result = await saveFieldAction(entity, id, field, next);
      if (result.ok) {
        setCurrent(next);
      } else {
        // Snap back so a rejected value never looks saved.
        toast.error(result.error);
      }
      grid.endEdit({ moveTo });
    });
  }

  if (editing) {
    return (
      <div className="px-1 py-0.5">
        <label className="sr-only" htmlFor={`cell-${id}-${field}`}>
          {label}
        </label>
        <input
          id={`cell-${id}-${field}`}
          ref={inputRef}
          type={type}
          defaultValue={grid.seed ?? current}
          autoFocus
          disabled={saving}
          onFocus={(e) => {
            // A seeded edit continues typing; a plain edit selects everything
            // so the first keystroke replaces rather than appends.
            if (grid.seed) e.currentTarget.setSelectionRange(1, 1);
            else e.currentTarget.select();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(e.currentTarget.value, { row: pos.row + 1, col: pos.col });
            }
            if (e.key === "Escape") {
              e.preventDefault();
              // Revert: the pattern says Escape restores grid navigation and
              // discards the edit.
              grid.endEdit();
            }
            if (e.key === "Tab") {
              e.preventDefault();
              commit(e.currentTarget.value, {
                row: pos.row,
                col: e.shiftKey ? pos.col - 1 : pos.col + 1,
              });
            }
          }}
          onBlur={(e) => commit(e.currentTarget.value)}
          className={cn(
            "h-7 w-full rounded-sm border border-accent bg-surface px-1.5 text-[14px] outline-none",
            align === "right" && "text-right tabular-nums",
          )}
        />
      </div>
    );
  }

  return (
    <div
      ref={(el) => {
        cellRef.current = el;
        grid.register(pos, el);
      }}
      role="gridcell"
      /*
       * Roving tabindex: exactly ONE cell is in the page's tab sequence.
       *
       * The fallback matters — with nothing focused yet, every cell at -1
       * makes the grid unreachable by keyboard entirely, because Tab has no
       * stop to land on. The first cell holds the tab stop until the user
       * moves focus somewhere else in the grid.
       */
      tabIndex={focused || (!grid.focus && pos.row === 0 && pos.col === 0) ? 0 : -1}
      aria-label={`${label}: ${current || "empty"}`}
      onFocus={() => grid.setFocus(pos)}
      onClick={() => grid.setFocus(pos)}
      onDoubleClick={() => editable && grid.beginEdit(pos)}
      onKeyDown={(e) => {
        if (!editable) return;
        if (e.key === "Enter" || e.key === "F2") {
          e.preventDefault();
          grid.beginEdit(pos);
          return;
        }
        // A printable character starts editing and seeds the input with it,
        // so typing over a cell just works.
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
          grid.beginEdit(pos, e.key);
        }
      }}
      className={cn(
        "min-h-7 cursor-text rounded-sm px-1.5 py-0.5 text-[14px] outline-none",
        focused && "ring-2 ring-accent ring-inset",
        !editable && "cursor-default",
        align === "right" && "text-right tabular-nums",
        !current && "text-muted",
      )}
    >
      {children ?? current ?? "—"}
    </div>
  );
}
