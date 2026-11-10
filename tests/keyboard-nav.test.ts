import { describe, expect, it } from "bun:test";
import { commandById, conflictKey, detectHotkeyConflicts, HOTKEY_COMMANDS } from "@/lib/hotkeys";
import { nextRegionIndex, stepIndex, typeAheadIndex } from "@/lib/keyboard-nav";

const NEW_IDS = ["focus.nextRegion", "focus.prevRegion", "focus.sidebar", "focus.content"];

describe("keyboard navigation", () => {
  it("bewegt sich in Listen mit Pfeilen, Pos1 und Ende", () => {
    expect(stepIndex(2, 5, "ArrowDown", "vertical")).toBe(3);
    expect(stepIndex(4, 5, "ArrowDown", "vertical")).toBe(4);
    expect(stepIndex(0, 5, "ArrowUp", "vertical")).toBe(0);
    expect(stepIndex(2, 5, "Home", "vertical")).toBe(0);
    expect(stepIndex(2, 5, "End", "vertical")).toBe(4);
    expect(stepIndex(1, 5, "ArrowRight", "horizontal")).toBe(2);
    expect(stepIndex(1, 5, "ArrowLeft", "horizontal")).toBe(0);
    expect(stepIndex(1, 5, "ArrowRight", "vertical")).toBeNull();
    expect(stepIndex(-1, 5, "ArrowDown", "vertical")).toBe(0);
    expect(stepIndex(0, 0, "ArrowDown", "vertical")).toBeNull();
  });

  it("springt beim Tippen zum nächsten passenden Eintrag", () => {
    const labels = ["orders", "Customers", "order_items", "products"];
    expect(typeAheadIndex(labels, 0, "o")).toBe(2);
    expect(typeAheadIndex(labels, 2, "o")).toBe(0);
    expect(typeAheadIndex(labels, 0, "cu")).toBe(1);
    expect(typeAheadIndex(labels, 0, "x")).toBeNull();
    expect(typeAheadIndex(labels, 0, "")).toBeNull();
  });

  it("wechselt Bereiche zyklisch in beide Richtungen", () => {
    expect(nextRegionIndex(0, 3, 1)).toBe(1);
    expect(nextRegionIndex(2, 3, 1)).toBe(0);
    expect(nextRegionIndex(0, 3, -1)).toBe(2);
    expect(nextRegionIndex(-1, 3, 1)).toBe(0);
    expect(nextRegionIndex(-1, 3, -1)).toBe(2);
    expect(nextRegionIndex(-1, 0, 1)).toBe(-1);
  });

  it("registriert Fokus-Befehle ohne Konflikte auf beiden Plattformen", () => {
    for (const id of NEW_IDS) expect(commandById(id)).toBeDefined();
    const conflicting = detectHotkeyConflicts({}).flatMap((conflict) => conflict.ids);
    for (const id of NEW_IDS) expect(conflicting).not.toContain(id);
    for (const mac of [true, false]) {
      const keys = HOTKEY_COMMANDS.flatMap((command) => [
        command.defaultHotkey,
        ...(command.aliases ?? []),
      ]).map((hotkey) => conflictKey(hotkey, mac));
      for (const id of NEW_IDS) {
        const own = conflictKey(commandById(id)?.defaultHotkey ?? "", mac);
        expect(keys.filter((key) => key === own).length).toBe(1);
      }
    }
  });
});
