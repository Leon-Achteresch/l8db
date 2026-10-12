import { expect, test } from "bun:test";
import type { buildSettingsItems as SettingsBuilder } from "../src/features/shell/app-header-search/command-items";
import {
  buildCompareItems,
  buildDiagramExportItems,
  buildHotkeyItems,
  buildSettingsItems,
} from "../src/features/shell/app-header-search/command-items";
import { paletteSearchItems, parsePaletteQuery } from "../src/lib/command-palette-search";
import { rankCommands } from "../src/lib/command-score";
import { useHotkeysStore } from "../src/lib/hotkeys";
import { useTableTabs } from "../src/lib/table-tabs";

test("Vergleichsbefehl ist mit aktiver Verbindung auch im Befehlsmodus auffindbar", () => {
  const navigate = (() => Promise.resolve()) as Parameters<typeof buildCompareItems>[2];
  expect(buildCompareItems(false, () => {}, navigate)).toEqual([]);
  const items = buildCompareItems(true, () => {}, navigate);
  for (const query of ["vergleich", "> vergleichen", "> compare", "> diff"]) {
    const parsed = parsePaletteQuery(query);
    const results = rankCommands(paletteSearchItems(items, parsed.commandsOnly), parsed.search);
    expect(results.map((item) => item.id)).toContain("compare:new");
  }
  expect(items[0].featureId).toBe("search.commands.new-compare");
});

test("Vergleichsbefehl öffnet jedes Mal einen eigenen Tab mit Einrichtungsdialog", () => {
  const initial = useTableTabs.getState();
  const calls: unknown[] = [];
  const navigate = ((options: unknown) => {
    calls.push(options);
    return Promise.resolve();
  }) as Parameters<typeof buildCompareItems>[2];
  const opened: boolean[] = [];
  try {
    useTableTabs.setState({ tabs: [], tabsByConnection: {} });
    useTableTabs.getState().openToolTab("compare", "existing");
    const [item] = buildCompareItems(true, (open) => opened.push(open), navigate);
    item.onSelect();
    item.onSelect();

    const tabs = useTableTabs.getState().tabs;
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toEqual({ kind: "tool", tool: "compare", id: "existing" });
    const ids = tabs.map((tab) => (tab.kind === "tool" ? tab.id : undefined));
    expect(ids[1]).toEqual(expect.any(String));
    expect(ids[2]).toEqual(expect.any(String));
    expect(new Set(ids).size).toBe(3);
    expect(calls).toEqual([
      { to: "/compare", search: { compareId: ids[1], setup: true } },
      { to: "/compare", search: { compareId: ids[2], setup: true } },
    ]);
    expect(opened).toEqual([false, false]);
  } finally {
    useTableTabs.setState({ tabs: initial.tabs, tabsByConnection: initial.tabsByConnection });
  }
});

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
