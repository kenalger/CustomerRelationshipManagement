import { beforeEach, describe, expect, it, vi } from "vitest";

import { hasLayer, isTopLayer, popLayer, pushLayer, snapshot } from "@/lib/layer-stack";

/**
 * The overlay stack is what stops keyboard handlers fighting each other: the
 * palette opening on top of a dialog, Escape closing the page behind instead
 * of the dialog, table shortcuts firing while a form has focus.
 */
describe("overlay layer stack", () => {
  beforeEach(() => {
    for (const layer of snapshot()) popLayer(layer.id);
  });

  it("starts empty", () => {
    expect(snapshot()).toHaveLength(0);
    expect(hasLayer()).toBe(false);
  });

  it("only the most recently opened layer handles keys", () => {
    pushLayer({ id: "dialog", kind: "modal" });
    expect(isTopLayer("dialog")).toBe(true);

    pushLayer({ id: "confirm", kind: "modal" });
    // The dialog underneath must stop reacting, or Escape closes both.
    expect(isTopLayer("dialog")).toBe(false);
    expect(isTopLayer("confirm")).toBe(true);
  });

  it("hands control back when the top layer closes", () => {
    pushLayer({ id: "dialog", kind: "modal" });
    pushLayer({ id: "confirm", kind: "modal" });
    popLayer("confirm");

    expect(isTopLayer("dialog")).toBe(true);
  });

  it("survives layers closing out of order", () => {
    pushLayer({ id: "a", kind: "modal" });
    pushLayer({ id: "b", kind: "palette" });
    pushLayer({ id: "c", kind: "modal" });

    // A layer in the middle unmounting must not corrupt the ordering.
    popLayer("b");
    expect(snapshot().map((l) => l.id)).toEqual(["a", "c"]);
    expect(isTopLayer("c")).toBe(true);
  });

  it("reports a modal layer so the palette can refuse to open over one", () => {
    expect(hasLayer("modal")).toBe(false);
    pushLayer({ id: "dialog", kind: "modal" });
    expect(hasLayer("modal")).toBe(true);
    expect(hasLayer("palette")).toBe(false);
  });

  it("ignores popping something that was never pushed", () => {
    pushLayer({ id: "dialog", kind: "modal" });
    popLayer("never-existed");
    expect(snapshot().map((l) => l.id)).toEqual(["dialog"]);
  });

  it("no layer is top when the stack is empty", () => {
    expect(isTopLayer("anything")).toBe(false);
  });

  it("notifies subscribers on both push and pop", async () => {
    const { subscribe } = await import("@/lib/layer-stack");
    const seen = vi.fn();
    const unsubscribe = subscribe(seen);

    pushLayer({ id: "dialog", kind: "modal" });
    popLayer("dialog");

    expect(seen).toHaveBeenCalledTimes(2);
    unsubscribe();

    pushLayer({ id: "after", kind: "modal" });
    expect(seen).toHaveBeenCalledTimes(2);
  });
});
