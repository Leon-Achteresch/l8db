import { describe, expect, it } from "bun:test";
import {
  HOTKEY_COMMANDS,
  canonicalizeHotkey,
  commandById,
  defaultHotkeyFor,
  detectHotkeyConflicts,
  filterHotkeyCommands,
  findHotkeyConflict,
  groupHotkeyCommands,
  isCommandVisibleInRoute,
  isHotkeyAvailable,
  resolveHotkey,
  useHotkeysStore,
  validateHotkeyInput,
} from "../src/lib/hotkeys";

describe("hotkey commands", () => {
  it("hat eindeutige Ids und Defaults", () => {
    const ids = HOTKEY_COMMANDS.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const command of HOTKEY_COMMANDS) {
      expect(command.defaultHotkey.length).toBeGreaterThan(0);
      expect(command.label.length).toBeGreaterThan(0);
    }
  });

  it("deckt Chrome- und VS-Code-Parität ab", () => {
    expect(defaultHotkeyFor("tab.newQuery")).toBe("Mod+T");
    expect(defaultHotkeyFor("tab.close")).toBe("Mod+W");
    expect(defaultHotkeyFor("tab.reopen")).toBe("Mod+Shift+T");
    expect(defaultHotkeyFor("app.refresh")).toBe("F5");
    expect(defaultHotkeyFor("settings.open")).toBe("Mod+,");
    expect(defaultHotkeyFor("sidebar.toggle")).toBe("Mod+B");
    expect(defaultHotkeyFor("palette.quickOpen")).toBe("Mod+P");
    expect(defaultHotkeyFor("query.save")).toBe("Mod+S");
    expect(defaultHotkeyFor("query.format")).toBe("Alt+Shift+F");
    expect(defaultHotkeyFor("query.comment")).toBe("Mod+/");
    expect(commandById("palette.open")?.aliases).toContain("Mod+Shift+P");
  });

  it("löst Overrides auf und setzt zurück", () => {
    expect(resolveHotkey("query.save")).toBe("Mod+S");
    useHotkeysStore.getState().setOverride("query.save", "Mod+Shift+G");
    expect(resolveHotkey("query.save")).toBe("Mod+Shift+G");
    useHotkeysStore.getState().setOverride("query.save", null);
    expect(resolveHotkey("query.save")).toBe("Mod+S");
    useHotkeysStore.getState().resetAll();
    expect(useHotkeysStore.getState().overrides).toEqual({});
  });
});

describe("hotkey conflicts", () => {
  it("meldet keine Konflikte für Defaults", () => {
    expect(detectHotkeyConflicts({})).toEqual([]);
  });

  it("vereinheitlicht Alias-Schreibweisen", () => {
    expect(canonicalizeHotkey("Cmd+K")).toBe(canonicalizeHotkey("Mod+K"));
    expect(canonicalizeHotkey("ctrl+k")).toBe(canonicalizeHotkey("Control+K"));
    expect(canonicalizeHotkey("Option+F")).toBe(canonicalizeHotkey("Alt+F"));
  });

  it("findet Kollisionen mit anderen Befehlen", () => {
    expect(findHotkeyConflict("Mod+K", "tab.close", {})).toEqual(["palette.open"]);
    expect(findHotkeyConflict("Mod+K", "palette.open", {})).toEqual([]);
  });

  it("toleriert die gewollte F5-Doppelbelegung", () => {
    expect(findHotkeyConflict("F5", "app.refresh", {})).toEqual([]);
    expect(findHotkeyConflict("F5", "query.run", {})).toEqual([]);
  });
});

describe("hotkey filter und Verfügbarkeit", () => {
  it("filtert nach Name, Bereich und Kürzel", () => {
    expect(filterHotkeyCommands("   ")).toHaveLength(HOTKEY_COMMANDS.length);
    const result = filterHotkeyCommands("abfrage ausführen");
    expect(result.map((command) => command.id)).toContain("query.run");
    expect(filterHotkeyCommands("chrome neuladen").map((command) => command.id)).toContain(
      "app.refresh",
    );
  });

  it("gruppiert ohne Verluste nach Bereich", () => {
    const groups = groupHotkeyCommands(HOTKEY_COMMANDS);
    const total = groups.reduce((sum, group) => sum + group.commands.length, 0);
    expect(total).toBe(HOTKEY_COMMANDS.length);
    expect(new Set(groups.map((group) => group.area)).size).toBe(groups.length);
  });

  it("beachtet Verbindung und Route", () => {
    expect(isHotkeyAvailable("query.run", { hasConnection: false })).toBe(false);
    expect(isHotkeyAvailable("query.run", { hasConnection: true })).toBe(true);
    expect(isHotkeyAvailable("settings.open", { hasConnection: false })).toBe(true);
    const run = commandById("query.run");
    const refresh = commandById("app.refresh");
    if (!run || !refresh) throw new Error("Befehle fehlen");
    expect(isCommandVisibleInRoute(run, "/query/abc")).toBe(true);
    expect(isCommandVisibleInRoute(run, "/")).toBe(false);
    expect(isCommandVisibleInRoute(refresh, "/")).toBe(true);
  });

  it("validiert Eingaben", () => {
    expect(validateHotkeyInput("Mod+Shift+T").valid).toBe(true);
    expect(validateHotkeyInput("F5").valid).toBe(true);
    expect(validateHotkeyInput("").valid).toBe(false);
    expect(validateHotkeyInput("Mod+").valid).toBe(false);
  });
});
