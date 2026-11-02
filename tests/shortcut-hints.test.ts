import { beforeEach, describe, expect, it } from "bun:test";
import { useHotkeysStore } from "../src/lib/hotkeys";
import {
  eventHotkey,
  HINT_COOLDOWN_MS,
  HINT_STARTUP_GRACE_MS,
  hotkeyIndex,
  hotkeyTargetOf,
  shouldHint,
  useShortcutHintsStore,
} from "../src/lib/shortcut-hints";

const later = Date.now() + HINT_STARTUP_GRACE_MS + 1;

function key(init: Partial<KeyboardEvent>) {
  return {
    key: "",
    code: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...init,
  };
}

describe("shortcut hints", () => {
  beforeEach(() => useShortcutHintsStore.getState().reset());

  it("zeigt erst ab der Schwelle und respektiert Cooldown und Startphase", () => {
    expect(shouldHint({ clicks: 2, shown: 0 }, later, 0, HINT_STARTUP_GRACE_MS)).toBe(false);
    expect(shouldHint({ clicks: 3, shown: 0 }, later, 0, HINT_STARTUP_GRACE_MS)).toBe(true);
    expect(shouldHint({ clicks: 3, shown: 0 }, later, 0, 1_000)).toBe(false);
    expect(shouldHint({ clicks: 7, shown: 1 }, later, 0, HINT_STARTUP_GRACE_MS)).toBe(false);
    expect(shouldHint({ clicks: 8, shown: 1 }, later, later - 1_000, HINT_STARTUP_GRACE_MS)).toBe(
      false,
    );
    expect(shouldHint({ clicks: 99, shown: 3 }, later, 0, HINT_STARTUP_GRACE_MS)).toBe(false);
    expect(shouldHint({ clicks: 9, shown: 0, learned: true }, later, 0)).toBe(false);
    expect(shouldHint({ clicks: 9, shown: 0, muted: true }, later, 0)).toBe(false);
  });

  it("aktiviert einen Tipp nach wiederholtem Klick und hält den globalen Abstand", () => {
    const store = useShortcutHintsStore.getState();
    store.recordClick("tab.newQuery", later);
    store.recordClick("tab.newQuery", later);
    expect(useShortcutHintsStore.getState().active).toBeNull();
    store.recordClick("tab.newQuery", later);
    expect(useShortcutHintsStore.getState().active).toEqual({ id: "tab.newQuery", learned: false });
    store.dismiss();
    store.recordClick("sidebar.toggle", later + 1);
    store.recordClick("sidebar.toggle", later + 2);
    store.recordClick("sidebar.toggle", later + 3);
    expect(useShortcutHintsStore.getState().active).toBeNull();
    store.recordClick("sidebar.toggle", later + HINT_COOLDOWN_MS);
    expect(useShortcutHintsStore.getState().active?.id).toBe("sidebar.toggle");
  });

  it("gelernte und stummgeschaltete Kürzel erzeugen nie wieder einen Tipp", () => {
    const store = useShortcutHintsStore.getState();
    for (let i = 0; i < 3; i++) store.recordClick("tab.newQuery", later);
    store.recordKeyboard("tab.newQuery");
    expect(useShortcutHintsStore.getState().active).toEqual({ id: "tab.newQuery", learned: true });
    store.mute("sidebar.toggle");
    for (let i = 0; i < 30; i++)
      store.recordClick("sidebar.toggle", later + HINT_COOLDOWN_MS * (i + 2));
    expect(useShortcutHintsStore.getState().stats["sidebar.toggle"].clicks).toBe(0);
    store.recordClick("unbekannt", later);
    expect(useShortcutHintsStore.getState().stats.unbekannt).toBeUndefined();
  });

  it("erkennt Tastenkürzel inklusive Aliasen und eigener Belegung", () => {
    const overrides = useHotkeysStore.getState().overrides;
    const index = hotkeyIndex(overrides);
    expect(
      index.get(eventHotkey(key({ key: "t", code: "KeyT", metaKey: true }), true) ?? ""),
    ).toContain("tab.newQuery");
    expect(
      index.get(eventHotkey(key({ key: "T", code: "KeyT", ctrlKey: true }), false) ?? ""),
    ).toContain("tab.newQuery");
    expect(
      index.get(
        eventHotkey(key({ key: "P", code: "KeyP", metaKey: true, shiftKey: true }), true) ?? "",
      ),
    ).toContain("palette.open");
    expect(eventHotkey(key({ key: "a", code: "KeyA" }), true)).toBe("a");
    expect(eventHotkey(key({ key: "z", code: "KeyY", metaKey: true }), true)).toBe("mod+z");
    expect(eventHotkey(key({ key: "Home", code: "Home" }), true)).toBe("home");
    expect(eventHotkey(key({ key: "Meta", code: "MetaLeft", metaKey: true }), true)).toBeNull();
    expect(eventHotkey(key({ key: "F5", code: "F5" }), true)).toBe("f5");
    expect(eventHotkey(key({ key: "∂", code: "KeyD", altKey: true }), true)).toBe("alt+d");
    const custom = hotkeyIndex({ "tab.newQuery": "Mod+Alt+Y" });
    expect(custom.get("alt+mod+y")).toEqual(["tab.newQuery"]);
    expect(custom.get("mod+t")).toBeUndefined();
  });

  it("findet das markierte Ziel am Element oder im Menüeintrag", () => {
    const marked = {
      closest: (selector: string) =>
        selector === "[data-hotkey]" ? { dataset: { hotkey: "edit.undo" } } : null,
    };
    expect(hotkeyTargetOf(marked as unknown as EventTarget)).toBe("edit.undo");
    const menuItem = {
      closest: (selector: string) =>
        selector === "[data-hotkey]"
          ? null
          : { querySelector: () => ({ dataset: { hotkey: "tab.close" } }) },
    };
    expect(hotkeyTargetOf(menuItem as unknown as EventTarget)).toBe("tab.close");
    expect(hotkeyTargetOf(null)).toBeNull();
  });
});
