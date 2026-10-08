import { expect, test } from "bun:test";
import type { buildSettingsItems as SettingsBuilder } from "../src/features/shell/app-header-search/command-items";
import {
  buildDiagramExportItems,
  buildHotkeyItems,
  buildSettingsItems,
} from "../src/features/shell/app-header-search/command-items";
import { useHotkeysStore } from "../src/lib/hotkeys";

test("Exportbefehle beachten Verbindung, Ansicht und eigene Tastenkürzel", () => {
  const build = (path: string, connected: boolean) =>
    buildHotkeyItems(
      path,
      connected,
      () => {},
      () => {},
    );
  expect(build("/", true).some((item) => item.id === "hotkey:grid.export")).toBe(false);
  expect(build("/query/1", false).some((item) => item.id === "hotkey:grid.export")).toBe(false);
  expect(build("/query/1", true).find((item) => item.id === "hotkey:grid.export")?.label).toBe(
    "Ergebnis exportieren…",
  );
  expect(
    build("/tables/public/users", true).find((item) => item.id === "hotkey:grid.export")?.label,
  ).toBe("Tabelle exportieren…");
  useHotkeysStore.getState().setOverride("grid.export", "Mod+Shift+E");
  try {
    const item = build("/query/1", true).find((item) => item.id === "hotkey:grid.export");
    expect(item?.hint).toContain("E");
    expect(item?.hint).toMatch(/Shift|⇧/);
    expect(item?.kind).toBe("command");
  } finally {
    useHotkeysStore.getState().setOverride("grid.export", null);
  }
});

test("Einstellungsbefehle öffnen die passende Kategorie", () => {
  const calls: unknown[] = [];
  const navigate = ((options: unknown) => {
    calls.push(options);
    return Promise.resolve();
  }) as Parameters<typeof SettingsBuilder>[1];
  const item = buildSettingsItems(() => {}, navigate).find(
    (item) => item.id === "setting:row-limit",
  );
  expect(item?.kind).toBe("setting");
  item?.onSelect();
  expect(calls).toEqual([{ to: "/settings", search: { tab: "data", setting: "row-limit" } }]);
});

test("Diagrammexporte sind nur im verbundenen ER-Diagramm verfügbar", () => {
  expect(buildDiagramExportItems("/er-diagram", false)).toEqual([]);
  expect(buildDiagramExportItems("/query/1", true)).toEqual([]);
  expect(buildDiagramExportItems("/er-diagram", true).map((item) => item.id)).toEqual([
    "er.export.png",
    "er.export.svg",
    "er.export.pdf",
    "er.export.mermaid",
    "er.export.dbml",
  ]);
});
