import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const users = { kind: "table", schema: "public", table: "users" };
const orders = { kind: "table", schema: "public", table: "orders" };

function startup(tabs?: object, split?: object, activeId: string | null = "a", version = 3) {
  const script = `
    const values = new Map();
    values.set("l8db.connections", JSON.stringify({ state: { connections: [], activeId: ${JSON.stringify(activeId)} }, version: 0 }));
    const tabs = ${JSON.stringify(tabs ?? null)};
    const split = ${JSON.stringify(split ?? null)};
    if (tabs) values.set("l8db.table-tabs", JSON.stringify({ state: tabs, version: ${version} }));
    if (split) values.set("l8db.split-view", JSON.stringify({ state: split, version: 0 }));
    const storage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    };
    globalThis.window = { localStorage: storage };
    Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
    const { useConnectionsStore } = await import("./src/lib/connections.ts");
    const { useTableTabs } = await import("./src/lib/table-tabs.ts");
    const { useSplitView } = await import("./src/lib/split-view.ts");
    const snapshot = () => ({
      tabs: useTableTabs.getState().tabs,
      tabsByConnection: useTableTabs.getState().tabsByConnection,
      panes: useSplitView.getState().panes,
      focusedPane: useSplitView.getState().focusedPane,
      tabsHydrated: useTableTabs.persist.hasHydrated(),
      splitHydrated: useSplitView.persist.hasHydrated(),
    });
    const initial = snapshot();
    useConnectionsStore.getState().setActiveId("b");
    const switched = snapshot();
    useTableTabs.getState().openTab({ schema: "public", table: "invoices" });
    useConnectionsStore.getState().setActiveId(${JSON.stringify(activeId)});
    const restored = snapshot();
    const persistedTabs = await useTableTabs.persist.getOptions().storage.getItem("l8db.table-tabs");
    const persistedSplit = await useSplitView.persist.getOptions().storage.getItem("l8db.split-view");
    console.log(JSON.stringify({ initial, switched, restored, persistedTabs, persistedSplit }));
  `;
  const result = Bun.spawnSync({
    cmd: [process.execPath, "--eval", script],
    cwd: fileURLToPath(new URL("..", import.meta.url)),
  });
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout.toString());
}

describe("workspace persistence on startup", () => {
  test("initialisiert auch ohne gespeicherte Tabs vollständig", () => {
    const result = startup();
    expect(result.initial.tabsHydrated).toBe(true);
    expect(result.initial.splitHydrated).toBe(true);
    expect(result.restored.tabs).toEqual([]);
  });

  test("lädt nur die Tabs und Panes der aktiven Verbindung und erlaubt danach Wechsel", () => {
    const result = startup(
      { tabs: [orders], tabsByConnection: { a: [users], b: [orders] }, queryCounter: 2 },
      {
        panes: ["table:public.orders", null],
        focusedPane: 0,
        byConnection: {
          a: { panes: ["table:public.users", null], focusedPane: 1 },
          b: { panes: ["table:public.orders", null], focusedPane: 0 },
        },
      },
    );
    expect(result.initial.tabsHydrated).toBe(true);
    expect(result.initial.splitHydrated).toBe(true);
    expect(result.initial.tabs).toEqual([users]);
    expect(result.initial.panes).toEqual(["table:public.users", null]);
    expect(result.switched.tabs).toEqual([orders]);
    expect(result.switched.panes).toEqual(["table:public.orders", null]);
    expect(result.restored.tabs).toEqual([users]);
    expect(result.restored.panes).toEqual(["table:public.users", null]);
    expect(result.restored.focusedPane).toBe(1);
  });

  test.each(["a", null])("übernimmt keine globalen Restdaten für %s", (activeId) => {
    const result = startup(
      { tabs: [orders], tabsByConnection: { b: [orders] }, queryCounter: 0 },
      { panes: ["table:public.orders", null], focusedPane: 1, byConnection: {} },
      activeId,
    );
    expect(result.initial.tabs).toEqual([]);
    expect(result.initial.panes).toEqual([]);
    expect(result.restored.tabs).toEqual([]);
    expect(result.restored.panes).toEqual([]);
  });

  test("migriert alte Tabs zur gespeicherten Verbindung", () => {
    const result = startup({ tabs: [users], queryCounter: 1 }, undefined, "a", 2);
    expect(result.initial.tabsHydrated).toBe(true);
    expect(result.initial.tabs).toEqual([users]);
    expect(result.switched.tabs).toEqual([]);
    expect(result.restored.tabs).toEqual([users]);
  });

  test("speichert Verbindungssammlungen und stellt sie bei einem neuen Start wieder her", () => {
    const first = startup({ tabsByConnection: { a: [users], b: [orders] }, queryCounter: 2 });
    expect(first.persistedTabs.state).not.toHaveProperty("tabs");
    expect(first.persistedSplit.state).not.toHaveProperty("panes");
    const second = startup(first.persistedTabs.state, first.persistedSplit.state);
    expect(second.initial.tabs).toEqual([users]);
    expect(second.switched.tabs.map((tab: { table: string }) => tab.table)).toEqual([
      "orders",
      "invoices",
    ]);
  });
});
