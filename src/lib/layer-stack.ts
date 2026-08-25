"use client";

/**
 * A stack of open overlay layers.
 *
 * Global `keydown` listeners are the standard way modals break: the command
 * palette opens on top of a dialog, Escape closes the wrong thing, and table
 * shortcuts fire while a form has focus. Every overlay pushes onto this stack
 * and only the top layer responds to keys.
 *
 * Deliberately a tiny module-level store rather than context — the palette and
 * the modals are in different subtrees and a provider would have to wrap both.
 */
type Layer = { id: string; kind: "modal" | "palette" };

let stack: Layer[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function pushLayer(layer: Layer) {
  stack = [...stack, layer];
  emit();
}

export function popLayer(id: string) {
  stack = stack.filter((l) => l.id !== id);
  emit();
}

/** True when this layer is the one that should handle keys. */
export function isTopLayer(id: string): boolean {
  return stack.at(-1)?.id === id;
}

export function hasLayer(kind?: Layer["kind"]): boolean {
  return kind ? stack.some((l) => l.kind === kind) : stack.length > 0;
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function snapshot() {
  return stack;
}
