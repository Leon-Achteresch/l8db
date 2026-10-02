import { beforeEach, describe, expect, test } from "bun:test";

const storage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, value),
  removeItem: (key: string) => void storage.delete(key),
};
const windowMock = Object.assign(new EventTarget(), { localStorage: localStorageMock });
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, configurable: true });
Object.defineProperty(globalThis, "window", { value: windowMock, configurable: true });

const { useDashboardsStore, undoDashboards, clearDashboardHistory } = await import(
  "../src/lib/dashboards/store.ts?window-sync"
);
const { useObjectDrafts } = await import("../src/lib/object-drafts.ts?window-sync");
const { useAnalysisWorkspaces } = await import("../src/lib/analysis-workspaces.ts?window-sync");
const { useCsvMappingPresets } = await import("../src/lib/csv-mapping-presets.ts?window-sync");
const { useSettingsStore } = await import("../src/lib/settings.ts?window-sync");

function otherWindowWrites(key: string, state: unknown, version = 0): void {
  const value = JSON.stringify({ state, version });
  storage.set(key, value);
  window.dispatchEvent(Object.assign(new Event("storage"), { key, newValue: value }));
}

function flushBuffered(): void {
  window.dispatchEvent(new Event("pagehide"));
}

function stored<T>(key: string): T {
  return (JSON.parse(storage.get(key) ?? "null") as { state: T }).state;
}

function dashboard(id: string, name: string) {
  return {
    id,
    connectionId: "c1",
    database: null,
    name,
    datasets: [],
    widgets: [],
    refreshSec: 0,
    locked: false,
    createdAt: 1,
  };
}

beforeEach(() => {
  storage.clear();
});

describe("dashboards across windows", () => {
  test("a dashboard created in another window survives a local edit", () => {
    useDashboardsStore.setState({ dashboards: [dashboard("d1", "Mine")], active: { c1: "d1" } });
    clearDashboardHistory();
    flushBuffered();
    otherWindowWrites(
      "l8db-dashboards",
      { dashboards: [dashboard("d1", "Mine"), dashboard("x", "Other")], active: { c1: "x" } },
      2,
    );
    expect(useDashboardsStore.getState().dashboards.map((d) => d.id)).toEqual(["d1", "x"]);
    expect(useDashboardsStore.getState().active).toEqual({ c1: "d1" });
    useDashboardsStore.getState().update("d1", { name: "Renamed" });
    flushBuffered();
    const persisted = stored<{ dashboards: { id: string; name: string }[] }>("l8db-dashboards");
    expect(persisted.dashboards.map((d) => [d.id, d.name])).toEqual([
      ["d1", "Renamed"],
      ["x", "Other"],
    ]);
  });

  test("undo never reverts a change that arrived from another window", () => {
    useDashboardsStore.setState({ dashboards: [dashboard("d1", "Mine")], active: {} });
    flushBuffered();
    clearDashboardHistory();
    useDashboardsStore.getState().update("d1", { name: "Local edit" });
    otherWindowWrites(
      "l8db-dashboards",
      { dashboards: [dashboard("d1", "Local edit"), dashboard("x", "Other")], active: {} },
      2,
    );
    undoDashboards();
    expect(useDashboardsStore.getState().dashboards.map((d) => d.id)).toContain("x");
  });

  test("ignores removals and corrupted payloads", () => {
    useDashboardsStore.setState({ dashboards: [dashboard("d1", "Mine")], active: {} });
    window.dispatchEvent(
      Object.assign(new Event("storage"), { key: "l8db-dashboards", newValue: "{broken" }),
    );
    window.dispatchEvent(
      Object.assign(new Event("storage"), { key: "l8db-dashboards", newValue: null }),
    );
    expect(useDashboardsStore.getState().dashboards.map((d) => d.id)).toEqual(["d1"]);
  });
});

describe("other user-data stores across windows", () => {
  test("object drafts", () => {
    useObjectDrafts.setState({ drafts: {} });
    const draft = {
      key: "k-other",
      connectionId: "c1",
      database: null,
      title: "proc",
      objectKey: "p",
      sql: "x",
      base: "y",
      updatedAt: 1,
    };
    otherWindowWrites("l8db.object-drafts", { drafts: { "k-other": draft } });
    useObjectDrafts.getState().put({ ...draft, key: "k-mine" });
    expect(Object.keys(stored<{ drafts: object }>("l8db.object-drafts").drafts).sort()).toEqual([
      "k-mine",
      "k-other",
    ]);
  });

  test("analysis workspaces", () => {
    useAnalysisWorkspaces.setState({ workspaces: [] });
    otherWindowWrites("l8db.analysis-workspaces", { workspaces: [{ id: "w1", name: "Other" }] });
    useAnalysisWorkspaces.setState((state) => ({
      workspaces: [...state.workspaces, { id: "w2", name: "Mine" } as never],
    }));
    expect(
      stored<{ workspaces: { id: string }[] }>("l8db.analysis-workspaces").workspaces.map(
        (w) => w.id,
      ),
    ).toEqual(["w1", "w2"]);
  });

  test("csv mapping presets", () => {
    useCsvMappingPresets.setState({ presets: [] });
    otherWindowWrites("l8db.csv-mapping-presets", { presets: [{ id: "p1", name: "Other" }] });
    useCsvMappingPresets.setState((state) => ({
      presets: [...state.presets, { id: "p2", name: "Mine" } as never],
    }));
    expect(
      stored<{ presets: { id: string }[] }>("l8db.csv-mapping-presets").presets.map((p) => p.id),
    ).toEqual(["p1", "p2"]);
  });

  test("settings changed in another window are not reverted by a local change", () => {
    useSettingsStore.setState({ productionReadOnly: true, editorFontSize: 13 });
    otherWindowWrites(
      "l8db.settings",
      { ...useSettingsStore.getState(), productionReadOnly: false },
      1,
    );
    expect(useSettingsStore.getState().productionReadOnly).toBe(false);
    useSettingsStore.getState().setEditorFontSize(15);
    const persisted = stored<{ productionReadOnly: boolean; editorFontSize: number }>(
      "l8db.settings",
    );
    expect(persisted.productionReadOnly).toBe(false);
    expect(persisted.editorFontSize).toBe(15);
  });
});
