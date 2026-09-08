import { beforeEach, expect, test } from "bun:test";
import type { Capabilities } from "../src/lib/db";
import {
  availableTableDetailTabs,
  resolveTableDetailTab,
  TABLE_DETAIL_TABS,
} from "../src/lib/table-detail-tabs";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  },
});
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { localStorage: globalThis.localStorage },
});
const { useSettingsStore } = await import("../src/lib/settings");
useSettingsStore.persist.setOptions({
  storage: {
    getItem: (key) => JSON.parse(storage.get(key) ?? "null"),
    setItem: (key, value) => { storage.set(key, JSON.stringify(value)); },
    removeItem: (key) => { storage.delete(key); },
  },
});

beforeEach(() => {
  useSettingsStore.getState().resetToDefaults();
});

test("Tabauswahl bleibt nach erneutem Laden erhalten", async () => {
  useSettingsStore.getState().setTableDetailTabVisible("data", false);
  useSettingsStore.getState().setTableDetailTabVisible("triggers", false);
  const persisted = storage.get("l8db.settings")!;
  useSettingsStore.setState({ hiddenTableDetailTabs: [] });
  storage.set("l8db.settings", persisted);
  await useSettingsStore.persist.rehydrate();
  expect(useSettingsStore.getState().hiddenTableDetailTabs).toEqual(["data", "triggers"]);
  useSettingsStore.getState().setTableDetailTabVisible("data", true);
  expect(useSettingsStore.getState().hiddenTableDetailTabs).toEqual(["triggers"]);
});

test("alte Einstellungen übernehmen die standardmäßig sichtbaren Tabs", async () => {
  storage.set("l8db.settings", JSON.stringify({ state: { rowLimit: 500 }, version: 0 }));
  await useSettingsStore.persist.rehydrate();
  expect(useSettingsStore.getState().hiddenTableDetailTabs).toEqual([]);
  expect(useSettingsStore.getState().rowLimit).toBe(500);
});

test("Tab-Reset erhält andere Einstellungen, Werkseinstellungen setzen Tabs zurück", () => {
  useSettingsStore.getState().setRowLimit(500);
  useSettingsStore.getState().setTableDetailTabVisible("columns", false);
  useSettingsStore.getState().resetTableDetailTabs();
  expect(useSettingsStore.getState().rowLimit).toBe(500);
  expect(useSettingsStore.getState().hiddenTableDetailTabs).toEqual([]);
  useSettingsStore.getState().setTableDetailTabVisible("audit", false);
  useSettingsStore.getState().resetToDefaults();
  expect(useSettingsStore.getState().hiddenTableDetailTabs).toEqual([]);
});

test("Tabauswahl berücksichtigt Objekttyp und Treiberfunktionen", () => {
  const caps = { triggers: true, explain: true } as Capabilities;
  expect(availableTableDetailTabs(false, caps).map((tab) => tab.id)).toEqual([
    "data", "columns", "triggers", "performance",
  ]);
  expect(availableTableDetailTabs(true, caps).map((tab) => tab.id)).toEqual([
    "data", "columns", "definition", "performance",
  ]);
  expect(availableTableDetailTabs(false, {} as Capabilities).map((tab) => tab.id)).toEqual([
    "data", "columns",
  ]);
});

test("ausgeblendeter aktiver Tab fällt auf einen sichtbaren Tab zurück", () => {
  const visible = TABLE_DETAIL_TABS.filter((tab) => tab.id === "columns" || tab.id === "audit");
  expect(resolveTableDetailTab("data", visible)).toBe("columns");
  expect(resolveTableDetailTab("audit", visible)).toBe("audit");
  expect(resolveTableDetailTab("data", [])).toBe("");
});
