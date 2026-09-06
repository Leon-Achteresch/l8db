import { beforeEach, describe, expect, test } from "bun:test";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "window", {
  value: {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  },
  configurable: true,
});

const { useConnectionsStore } = await import("../src/lib/connections");
const { tabKey, useTableTabs } = await import("../src/lib/table-tabs");
const { MAX_SPLIT_PANES, useSplitView } = await import("../src/lib/split-view");

await useConnectionsStore.persist.rehydrate();
await useTableTabs.persist.rehydrate();
await useSplitView.persist.rehydrate();

function addConnection(name: string) {
  return useConnectionsStore.getState().addConnection({
    name,
    kind: "postgres",
    connectionString: "postgresql://localhost:5432/db",
    sslMode: "prefer",
  });
}

function reset() {
  storage.clear();
  useConnectionsStore.setState({ connections: [], activeId: null });
  useTableTabs.setState({ tabs: [], tabsByConnection: {}, queryCounter: 0 });
  useSplitView.setState({ panes: [], focusedPane: 0, byConnection: {} });
}

beforeEach(() => {
  reset();
});

describe("split view", () => {
  test("teilt die aktive Ansicht und füllt mit dem nächsten Tab", () => {
    const a = addConnection("a");
    useConnectionsStore.getState().setActiveId(a.id);
    useTableTabs.getState().openTab({ schema: "public", table: "users" });
    useTableTabs.getState().openTab({ schema: "public", table: "orders" });
    const users = tabKey({ kind: "table", schema: "public", table: "users" });
    const orders = tabKey({ kind: "table", schema: "public", table: "orders" });

    useSplitView.getState().addPane(users);
    expect(useSplitView.getState().panes).toEqual([users, orders]);
    expect(useSplitView.getState().focusedPane).toBe(1);
  });

  test("legt bei einem Tab ein leeres zweites Pane an", () => {
    const a = addConnection("a");
    useConnectionsStore.getState().setActiveId(a.id);
    useTableTabs.getState().openTab({ schema: "public", table: "users" });
    const users = tabKey({ kind: "table", schema: "public", table: "users" });

    useSplitView.getState().addPane(users);
    expect(useSplitView.getState().panes).toEqual([users, null]);
    expect(useSplitView.getState().focusedPane).toBe(1);
  });

  test("stoppt bei 4 Panes", () => {
    const a = addConnection("a");
    useConnectionsStore.getState().setActiveId(a.id);
    useTableTabs.getState().openTab({ schema: "public", table: "t1" });
    const t1 = tabKey({ kind: "table", schema: "public", table: "t1" });
    for (let i = 0; i < 6; i++) {
      useSplitView.getState().addPane(t1);
    }
    expect(useSplitView.getState().panes).toHaveLength(MAX_SPLIT_PANES);
  });

  test("reveal fokussiert ein vorhandenes Pane oder belegt das aktive", () => {
    const a = addConnection("a");
    useConnectionsStore.getState().setActiveId(a.id);
    useTableTabs.getState().openTab({ schema: "public", table: "users" });
    useTableTabs.getState().openTab({ schema: "public", table: "orders" });
    const users = tabKey({ kind: "table", schema: "public", table: "users" });
    const orders = tabKey({ kind: "table", schema: "public", table: "orders" });
    const items = tabKey({ kind: "table", schema: "public", table: "items" });

    useSplitView.getState().addPane(users);
    useSplitView.getState().reveal(users);
    expect(useSplitView.getState().focusedPane).toBe(0);

    useSplitView.getState().reveal(items);
    expect(useSplitView.getState().panes).toEqual([items, orders]);
    expect(useSplitView.getState().focusedPane).toBe(0);
  });

  test("closePane auf 1 Pane beendet den Split", () => {
    const a = addConnection("a");
    useConnectionsStore.getState().setActiveId(a.id);
    useTableTabs.getState().openTab({ schema: "public", table: "users" });
    const users = tabKey({ kind: "table", schema: "public", table: "users" });
    useSplitView.getState().addPane(users);
    useSplitView.getState().closePane(1);
    expect(useSplitView.getState().panes).toEqual([]);
  });

  test("geschlossene Tabs werden aus den Panes entfernt", () => {
    const a = addConnection("a");
    useConnectionsStore.getState().setActiveId(a.id);
    useTableTabs.getState().openTab({ schema: "public", table: "users" });
    useTableTabs.getState().openTab({ schema: "public", table: "orders" });
    const users = tabKey({ kind: "table", schema: "public", table: "users" });
    const orders = tabKey({ kind: "table", schema: "public", table: "orders" });
    useSplitView.getState().addPane(users);
    useTableTabs.getState().closeTab(orders);
    expect(useSplitView.getState().panes).toEqual([users, null]);
  });

  test("Split bleibt pro Connection erhalten", () => {
    const a = addConnection("a");
    const b = addConnection("b");
    useConnectionsStore.getState().setActiveId(a.id);
    useTableTabs.getState().openTab({ schema: "public", table: "users" });
    const users = tabKey({ kind: "table", schema: "public", table: "users" });
    useSplitView.getState().addPane(users);

    useConnectionsStore.getState().setActiveId(b.id);
    expect(useSplitView.getState().panes).toEqual([]);

    useConnectionsStore.getState().setActiveId(a.id);
    expect(useSplitView.getState().panes).toEqual([users, null]);
  });
});
