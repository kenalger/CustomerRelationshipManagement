"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

type SelectionValue = {
  selected: Set<string>;
  toggle: (id: string, shiftKey: boolean) => void;
  toggleAll: () => void;
  clear: () => void;
  allSelected: boolean;
  someSelected: boolean;
};

const SelectionContext = createContext<SelectionValue | null>(null);

/**
 * Row selection for a list view.
 *
 * `ids` is the rows currently on screen, in display order, which is what makes
 * shift-click ranges work: a range is a slice of what the user can see, not of
 * the whole table.
 */
export function SelectionProvider({
  ids,
  children,
}: {
  ids: string[];
  children: React.ReactNode;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);

  const toggle = useCallback(
    (id: string, shiftKey: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev);

        // Shift-click extends from the last clicked row, the way every
        // spreadsheet and mail client behaves.
        if (shiftKey && anchor && anchor !== id) {
          const from = ids.indexOf(anchor);
          const to = ids.indexOf(id);
          if (from !== -1 && to !== -1) {
            const [start, end] = from < to ? [from, to] : [to, from];
            for (const rowId of ids.slice(start, end + 1)) next.add(rowId);
            return next;
          }
        }

        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      setAnchor(id);
    },
    [anchor, ids],
  );

  const value = useMemo<SelectionValue>(() => {
    const onScreen = selected.size > 0 && ids.every((id) => selected.has(id));
    return {
      selected,
      toggle,
      toggleAll: () => setSelected(onScreen ? new Set() : new Set(ids)),
      clear: () => setSelected(new Set()),
      allSelected: onScreen,
      someSelected: selected.size > 0 && !onScreen,
    };
  }, [selected, ids, toggle]);

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useSelection(): SelectionValue {
  const value = useContext(SelectionContext);
  if (!value) throw new Error("useSelection must be used inside a SelectionProvider");
  return value;
}

/** Header checkbox — indeterminate when only part of the page is selected. */
export function SelectAllCheckbox() {
  const { allSelected, someSelected, toggleAll } = useSelection();
  return (
    <input
      type="checkbox"
      checked={allSelected}
      ref={(el) => {
        if (el) el.indeterminate = someSelected;
      }}
      onChange={toggleAll}
      aria-label={allSelected ? "Clear selection" : "Select all on this page"}
      className="size-3.5 cursor-pointer accent-[var(--accent)]"
    />
  );
}

export function RowCheckbox({ id, label }: { id: string; label: string }) {
  const { selected, toggle } = useSelection();
  return (
    <input
      type="checkbox"
      checked={selected.has(id)}
      // onClick carries shiftKey; onChange does not.
      onClick={(e) => toggle(id, e.shiftKey)}
      onChange={() => {}}
      aria-label={`Select ${label}`}
      className="size-3.5 cursor-pointer accent-[var(--accent)]"
    />
  );
}
