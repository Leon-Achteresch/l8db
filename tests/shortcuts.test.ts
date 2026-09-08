import { describe, expect, it } from "bun:test";
import {
  detectShortcutPlatform,
  filterShortcuts,
  formatShortcut,
  groupShortcutsByArea,
  isShortcutAvailable,
  SHORTCUTS,
} from "../src/lib/shortcuts";

describe("shortcut platform", () => {
  it("erkennt macOS und andere Plattformen", () => {
    expect(detectShortcutPlatform("MacIntel")).toBe("mac");
    expect(detectShortcutPlatform("Win32")).toBe("other");
    expect(detectShortcutPlatform("Linux x86_64")).toBe("other");
  });

  it("zeigt Cmd auf macOS und Ctrl sonst", () => {
    const run = SHORTCUTS.find((entry) => entry.id === "query.run");
    if (!run) throw new Error("query.run fehlt");
    expect(formatShortcut(run.binding, "mac")).toBe("Cmd+Enter");
    expect(formatShortcut(run.binding, "other")).toBe("Ctrl+Enter");
  });

  it("formatiert Zusatzmodifikatoren plattformgerecht", () => {
    expect(formatShortcut({ mod: true, shift: true, key: "Enter" }, "mac")).toBe(
      "Cmd+Shift+Enter",
    );
    expect(formatShortcut({ mod: true, alt: true, key: "Enter" }, "other")).toBe("Ctrl+Alt+Enter");
    expect(formatShortcut({ shift: true, alt: true, key: "F" }, "mac")).toBe("Shift+Option+F");
  });
});

describe("filterShortcuts", () => {
  it("gibt ohne Suchbegriff alles zurück", () => {
    expect(filterShortcuts(SHORTCUTS, "   ", "mac")).toHaveLength(SHORTCUTS.length);
  });

  it("filtert nach Befehlsname", () => {
    const result = filterShortcuts(SHORTCUTS, "abfrage ausführen", "mac");
    expect(result.map((entry) => entry.id)).toContain("query.run");
    expect(result.every((entry) => entry.area === "SQL-Editor")).toBe(true);
  });

  it("filtert nach Bereich", () => {
    const result = filterShortcuts(SHORTCUTS, "datengitter", "other");
    expect(result.map((entry) => entry.id).sort()).toEqual([
      "grid.copy",
      "grid.export",
      "grid.nextPage",
      "grid.prevPage",
      "grid.search",
    ]);
  });

  it("filtert nach Tastenkürzel und beachtet die Plattform", () => {
    expect(filterShortcuts(SHORTCUTS, "cmd+k", "mac").map((entry) => entry.id)).toEqual([
      "palette.open",
    ]);
    expect(filterShortcuts(SHORTCUTS, "cmd+k", "other")).toHaveLength(0);
    expect(filterShortcuts(SHORTCUTS, "ctrl+k", "other").map((entry) => entry.id)).toEqual([
      "palette.open",
    ]);
  });

  it("liefert bei fehlenden Treffern eine leere Liste", () => {
    expect(filterShortcuts(SHORTCUTS, "zzz", "mac")).toEqual([]);
  });
});

describe("Verfügbarkeit und Gruppierung", () => {
  it("markiert verbindungsabhängige Aktionen ohne Verbindung als nicht nutzbar", () => {
    const run = SHORTCUTS.find((entry) => entry.id === "query.run");
    const help = SHORTCUTS.find((entry) => entry.id === "shortcuts.open");
    if (!run || !help) throw new Error("Kürzel fehlen");
    expect(isShortcutAvailable(run, { hasConnection: false })).toBe(false);
    expect(isShortcutAvailable(run, { hasConnection: true })).toBe(true);
    expect(isShortcutAvailable(help, { hasConnection: false })).toBe(true);
  });

  it("gruppiert nach Bereich ohne Einträge zu verlieren", () => {
    const groups = groupShortcutsByArea(SHORTCUTS);
    const total = groups.reduce((sum, group) => sum + group.shortcuts.length, 0);
    expect(total).toBe(SHORTCUTS.length);
    expect(new Set(groups.map((group) => group.area)).size).toBe(groups.length);
  });

  it("hat eindeutige Ids", () => {
    expect(new Set(SHORTCUTS.map((entry) => entry.id)).size).toBe(SHORTCUTS.length);
  });
});
