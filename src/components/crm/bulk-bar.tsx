"use client";

import { X } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { useSelection } from "@/components/crm/selection";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import type { BulkResult } from "@/server/actions/bulk";

export type BulkAction = {
  label: string;
  /** Confirmation copy. Present means the action asks first. */
  confirm?: string;
  variant?: "primary" | "secondary" | "danger";
  run: (ids: string[]) => Promise<BulkResult>;
};

/**
 * The action bar for a selection.
 *
 * Anchored to the bottom of the viewport rather than the top of the table: a
 * rep scrolls while selecting, and a bar that scrolls away with the header is
 * unreachable exactly when it is needed.
 */
export function BulkBar({
  actions,
  assignees,
  onAssign,
  noun = "record",
}: {
  actions: BulkAction[];
  /** Present enables the owner picker. */
  assignees?: { id: string; name: string }[];
  onAssign?: (ids: string[], ownerId: string) => Promise<BulkResult>;
  noun?: string;
}) {
  const { selected, clear } = useSelection();
  const [pending, start] = useTransition();
  const ids = [...selected];

  if (ids.length === 0) return null;

  function report(result: BulkResult) {
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    const { succeeded, failed, errors } = result.outcome;
    if (failed > 0) {
      // Partial success is the normal case in bulk work; saying only
      // "done" would hide the rows that did not make it.
      toast.warning(`${succeeded} updated, ${failed} skipped`, {
        description: errors[0],
      });
    } else {
      toast.success(`${succeeded} ${succeeded === 1 ? noun : `${noun}s`} updated`);
    }
    clear();
  }

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-4"
    >
      <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-xl bg-surface px-3 py-2 shadow-[var(--shadow-overlay)] ring-1 ring-border-strong">
        <span className="text-[12px] font-[510] tabular-nums">
          {ids.length} selected
        </span>

        <span aria-hidden className="h-4 w-px bg-border-subtle" />

        {assignees && onAssign ? (
          <>
            <label className="sr-only" htmlFor="bulk-assignee">
              Assign to
            </label>
            <Select
              id="bulk-assignee"
              defaultValue=""
              disabled={pending}
              onChange={(e) => {
                const ownerId = e.target.value;
                if (!ownerId) return;
                e.target.value = "";
                start(async () => report(await onAssign(ids, ownerId)));
              }}
              className="h-7 w-40 text-[12px]"
            >
              <option value="">Assign to…</option>
              {assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </>
        ) : null}

        {actions.map((action) => (
          <Button
            key={action.label}
            size="sm"
            variant={action.variant ?? "secondary"}
            disabled={pending}
            onClick={() => {
              if (action.confirm && !window.confirm(action.confirm.replace("{n}", String(ids.length)))) {
                return;
              }
              start(async () => report(await action.run(ids)));
            }}
          >
            {action.label}
          </Button>
        ))}

        <button
          type="button"
          onClick={clear}
          aria-label="Clear selection"
          className="rounded-md p-1 text-muted transition-colors hover:bg-hover hover:text-foreground"
        >
          <X size={13} strokeWidth={2} aria-hidden />
        </button>
      </div>
    </div>
  );
}
