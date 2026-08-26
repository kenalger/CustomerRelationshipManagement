"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { hasLayer } from "@/lib/layer-stack";

/**
 * Two-state focus for an editable grid, following the W3C ARIA grid pattern.
 *
 * "Soft focus" (which cell is highlighted and arrow-navigable) is kept SEPARATE
 * from edit mode (which cell has an open input). Collapsing them into one piece
 * of state is what makes home-grown grids feel wrong: arrow keys start typing,
 * Escape closes the page instead of the editor, and Tab escapes the table.
 *
 * Keys, per the pattern:
 *   arrows      move soft focus, clamped at the edges
 *   Home/End    first/last cell in the row
 *   Enter / F2  enter edit mode
 *   printable   enter edit mode and seed the input with that character
 *   Escape      leave edit mode and REVERT, restoring grid navigation
 *   Tab         leaves the grid entirely, because only the focused cell is in
 *               the tab sequence (roving tabindex)
 */
export type CellPos = { row: number; col: number };

type GridValue = {
  focus: CellPos | null;
  editing: CellPos | null;
  seed: string | null;
  setFocus: (pos: CellPos | null) => void;
  beginEdit: (pos: CellPos, seed?: string) => void;
  endEdit: (opts?: { moveTo?: CellPos }) => void;
  isFocused: (pos: CellPos) => boolean;
  isEditing: (pos: CellPos) => boolean;
  register: (pos: CellPos, el: HTMLElement | null) => void;
};

const GridContext = createContext<GridValue | null>(null);

export function GridProvider({
  rows,
  cols,
  children,
}: {
  rows: number;
  cols: number;
  children: React.ReactNode;
}) {
  const [focus, setFocusState] = useState<CellPos | null>(null);
  const [editing, setEditing] = useState<CellPos | null>(null);
  const [seed, setSeed] = useState<string | null>(null);
  const cells = useRef(new Map<string, HTMLElement>());

  const key = (p: CellPos) => `${p.row}:${p.col}`;

  const register = useCallback((pos: CellPos, el: HTMLElement | null) => {
    if (el) cells.current.set(key(pos), el);
    else cells.current.delete(key(pos));
  }, []);

  const setFocus = useCallback((pos: CellPos | null) => {
    setFocusState(pos);
    if (pos) cells.current.get(`${pos.row}:${pos.col}`)?.focus();
  }, []);

  const beginEdit = useCallback((pos: CellPos, s?: string) => {
    setFocusState(pos);
    setSeed(s ?? null);
    setEditing(pos);
  }, []);

  const endEdit = useCallback(
    (opts?: { moveTo?: CellPos }) => {
      setEditing(null);
      setSeed(null);
      // Focus returns to the grid, not to the body — otherwise Escape drops
      // the user out of the table entirely.
      setFocus(opts?.moveTo ?? focus);
    },
    [focus, setFocus],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // A dialog on top owns the keyboard.
      if (hasLayer("modal")) return;
      if (!focus || editing) return;

      const { row, col } = focus;
      const clamp = (r: number, c: number) => ({
        row: Math.max(0, Math.min(rows - 1, r)),
        col: Math.max(0, Math.min(cols - 1, c)),
      });

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setFocus(clamp(row + 1, col));
          break;
        case "ArrowUp":
          event.preventDefault();
          setFocus(clamp(row - 1, col));
          break;
        case "ArrowRight":
          event.preventDefault();
          setFocus(clamp(row, col + 1));
          break;
        case "ArrowLeft":
          event.preventDefault();
          setFocus(clamp(row, col - 1));
          break;
        case "Home":
          event.preventDefault();
          setFocus(clamp(row, 0));
          break;
        case "End":
          event.preventDefault();
          setFocus(clamp(row, cols - 1));
          break;
        default:
          break;
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [focus, editing, rows, cols, setFocus]);

  const value = useMemo<GridValue>(
    () => ({
      focus,
      editing,
      seed,
      setFocus,
      beginEdit,
      endEdit,
      isFocused: (p) => focus?.row === p.row && focus?.col === p.col,
      isEditing: (p) => editing?.row === p.row && editing?.col === p.col,
      register,
    }),
    [focus, editing, seed, setFocus, beginEdit, endEdit, register],
  );

  return <GridContext.Provider value={value}>{children}</GridContext.Provider>;
}

export function useGrid(): GridValue {
  const value = useContext(GridContext);
  if (!value) throw new Error("useGrid must be used inside a GridProvider");
  return value;
}
