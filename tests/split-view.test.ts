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
const { remoteTab, remoteTableTab, tabKey, useTableTabs } = await import("../src/lib/table-tabs");
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
  useSplitView.setState({
    panes: [],
    masters: [],
    focusedPane: 0,
    byConnection: {},
    paneConnections: {},
    orientation: "horizontal",
    activeGroup: null,
    groups: {},
  });
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

  test("reveal fokussiert ein vorhandenes Pane oder verlässt die Tab-Gruppe", () => {
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
    expect(useSplitView.getState().panes).toEqual([]);
    expect(useSplitView.getState().groups[a.id][0].tabs.map((tab) => tab && tabKey(tab))).toEqual([
      users,
      orders,
    ]);
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

  test("geschlossener Tab beendet den Split, die Gruppe bleibt", () => {
    const a = addConnection("a");
    useConnectionsStore.getState().setActiveId(a.id);
    useTableTabs.getState().openTab({ schema: "public", table: "users" });
    useTableTabs.getState().openTab({ schema: "public", table: "orders" });
    const users = tabKey({ kind: "table", schema: "public", table: "users" });
    const orders = tabKey({ kind: "table", schema: "public", table: "orders" });
    useSplitView.getState().addPane(users);
    useTableTabs.getState().closeTab(orders);
    expect(useSplitView.getState().panes).toEqual([]);
    expect(useSplitView.getState().groups[a.id]).toHaveLength(1);
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

  test("Ausrichtung bleibt beim Tauschen, Rehydrieren und Verbindungswechsel erhalten", async () => {
    const a = addConnection("a");
    const b = addConnection("b");
    useConnectionsStore.getState().setActiveId(a.id);
    useTableTabs.getState().openTab({ schema: "public", table: "users" });
    const users = tabKey({ kind: "table", schema: "public", table: "users" });
    useSplitView.getState().addPane(users);
    useSplitView.getState().setOrientation("vertical");
    useSplitView.getState().swapPanes(0, 1);
    await useSplitView.persist.rehydrate();
    expect(useSplitView.getState().orientation).toBe("vertical");
    expect(useSplitView.getState().panes).toEqual([null, users]);
    useConnectionsStore.getState().setActiveId(b.id);
    expect(useSplitView.getState().orientation).toBe("horizontal");
    useConnectionsStore.getState().setActiveId(a.id);
    expect(useSplitView.getState().orientation).toBe("vertical");
    expect(useSplitView.getState().panes).toHaveLength(2);
  });

  test("setPane legt Tab per Drop in ein Pane und tauscht Duplikate", () => {
    const a = addConnection("a");
    useConnectionsStore.getState().setActiveId(a.id);
    useTableTabs.getState().openTab({ schema: "public", table: "users" });
    useTableTabs.getState().openTab({ schema: "public", table: "orders" });
    useTableTabs.getState().openTab({ schema: "public", table: "items" });
    const users = tabKey({ kind: "table", schema: "public", table: "users" });
    const orders = tabKey({ kind: "table", schema: "public", table: "orders" });
    const items = tabKey({ kind: "table", schema: "public", table: "items" });

    useSplitView.getState().addPane(users);
    useSplitView.getState().setPane(0, items);
    expect(useSplitView.getState().panes).toEqual([items, orders]);
    expect(useSplitView.getState().focusedPane).toBe(0);

    useSplitView.getState().setPane(1, items);
    expect(useSplitView.getState().panes).toEqual([orders, items]);
    expect(useSplitView.getState().focusedPane).toBe(1);
  });

  test("swapPanes vertauscht zwei Panes", () => {
    const a = addConnection("a");
    useConnectionsStore.getState().setActiveId(a.id);
    useTableTabs.getState().openTab({ schema: "public", table: "users" });
    useTableTabs.getState().openTab({ schema: "public", table: "orders" });
    const users = tabKey({ kind: "table", schema: "public", table: "users" });
    const orders = tabKey({ kind: "table", schema: "public", table: "orders" });

    useSplitView.getState().addPane(users);
    useSplitView.getState().swapPanes(0, 1);
    expect(useSplitView.getState().panes).toEqual([orders, users]);
    expect(useSplitView.getState().focusedPane).toBe(1);
    useSplitView.getState().swapPanes(0, 5);
    expect(useSplitView.getState().panes).toEqual([orders, users]);
  });
});

describe("Verbindung pro Bereich", () => {
  test("override is scoped to the active connection and cleared with it", () => {
    const a = addConnection("A");
    const b = addConnection("B");
    useConnectionsStore.setState({ activeId: a.id });
    useSplitView.getState().setPaneConnection("table:public.t", b.id);
    expect(useSplitView.getState().paneConnections).toEqual({ [`${a.id}|table:public.t`]: b.id });
    useSplitView.getState().setPaneConnection("table:public.t", null);
    expect(useSplitView.getState().paneConnections).toEqual({});
    useSplitView.getState().setPaneConnection("table:public.t", b.id);
    useSplitView.getState().clearForConnection(b.id);
    expect(useSplitView.getState().paneConnections).toEqual({});
  });

  test("Bereich einer anderen Verbindung wählt eigene Tabellen unabhängig von den Tabs", () => {
    const a = addConnection("A");
    const b = addConnection("B");
    useConnectionsStore.getState().setActiveId(a.id);
    useTableTabs.getState().openTab({ schema: "public", table: "users" });
    useTableTabs.getState().openTab({ schema: "public", table: "orders" });
    const users = tabKey({ kind: "table", schema: "public", table: "users" });
    const orders = tabKey({ kind: "table", schema: "public", table: "orders" });
    const remoteUsers = tabKey({
      kind: "table",
      schema: "public",
      table: "users",
      connectionId: b.id,
    });
    expect(remoteTableTab(users)).toBeNull();
    expect(remoteTableTab(remoteUsers)).toEqual({
      kind: "table",
      schema: "public",
      table: "users",
      entityType: "table",
      connectionId: b.id,
    });

    useSplitView.getState().addPane(users);
    useSplitView.getState().setPaneConnection("split-detail:1", b.id);
    useSplitView
      .getState()
      .setPaneTab(1, b.id, { kind: "table", schema: "public", table: "users" });
    expect(useSplitView.getState().panes).toEqual([users, remoteUsers]);
    expect(useSplitView.getState().paneConnections).toEqual({});

    useTableTabs.getState().closeTab(orders);
    expect(useSplitView.getState().panes).toEqual([users, remoteUsers]);

    useSplitView.getState().setPane(0, orders);
    expect(useSplitView.getState().panes).toEqual([orders, remoteUsers]);
    expect(useSplitView.getState().focusedPane).toBe(0);

    useSplitView
      .getState()
      .setPaneTab(0, b.id, { kind: "table", schema: "public", table: "users" });
    expect(useSplitView.getState().panes).toEqual([orders, remoteUsers]);
    expect(useSplitView.getState().focusedPane).toBe(1);

    useSplitView
      .getState()
      .setPaneTab(1, null, { kind: "table", schema: "public", table: "users" });
    expect(useSplitView.getState().panes).toEqual([orders, users]);
  });

  test("Bereich einer anderen Verbindung zeigt auch Packages und Funktionen", () => {
    const a = addConnection("A");
    const b = addConnection("B");
    useConnectionsStore.getState().setActiveId(a.id);
    useTableTabs.getState().openTab({ schema: "public", table: "users" });
    const users = tabKey({ kind: "table", schema: "public", table: "users" });
    useSplitView.getState().addPane(users);

    useSplitView.getState().setPaneTab(1, b.id, { kind: "package", schema: "HR", name: "PAYROLL" });
    const key = useSplitView.getState().panes[1];
    expect(remoteTableTab(key)).toBeNull();
    expect(remoteTab(key)).toEqual({
      kind: "package",
      schema: "HR",
      name: "PAYROLL",
      connectionId: b.id,
    });
    const parsed = remoteTab(key);
    expect(parsed && tabKey(parsed)).toBe(key);

    useTableTabs.getState().openTab({ schema: "public", table: "orders" });
    expect(useSplitView.getState().panes).toEqual([users, key]);

    useSplitView.getState().setPaneTab(0, b.id, { kind: "package", schema: "HR", name: "PAYROLL" });
    expect(useSplitView.getState().panes).toEqual([users, key]);
    expect(useSplitView.getState().focusedPane).toBe(1);

    useSplitView
      .getState()
      .setPaneTab(1, b.id, { kind: "function", schema: "public", name: "f", oid: "42" });
    expect(remoteTab(useSplitView.getState().panes[1])).toEqual({
      kind: "function",
      schema: "public",
      name: "f",
      oid: "42",
      connectionId: b.id,
    });

    useSplitView.getState().setPaneTab(1, null, null);
    expect(useSplitView.getState().panes).toEqual([users, null]);
  });
});

describe("Master pro Bereich", () => {
  function fourPanes() {
    const a = addConnection("a");
    useConnectionsStore.getState().setActiveId(a.id);
    for (const table of ["t0", "t1", "t2", "t3"])
      useTableTabs.getState().openTab({ schema: "public", table });
    const keys = ["t0", "t1", "t2", "t3"].map((table) =>
      tabKey({ kind: "table", schema: "public", table }),
    );
    useSplitView.getState().addPane(keys[0]);
    return { a, keys };
  }

  test("neuer Bereich wird Detail des fokussierten Bereichs", () => {
    fourPanes();
    expect(useSplitView.getState().masters).toEqual([null, 0]);
    useSplitView.getState().addPane(null);
    expect(useSplitView.getState().masters).toEqual([null, 0, 1]);
    useSplitView.getState().focusPane(0);
    useSplitView.getState().addPane(null);
    expect(useSplitView.getState().masters).toEqual([null, 0, 1, 0]);
  });

  test("ein Master mit drei Details und vierfache Kette, Zyklen werden abgelehnt", () => {
    fourPanes();
    useSplitView.getState().addPane(null);
    useSplitView.getState().addPane(null);
    const { setMaster } = useSplitView.getState();
    setMaster(2, 0);
    setMaster(3, 0);
    expect(useSplitView.getState().masters).toEqual([null, 0, 0, 0]);
    setMaster(2, 1);
    setMaster(3, 2);
    expect(useSplitView.getState().masters).toEqual([null, 0, 1, 2]);
    setMaster(0, 3);
    setMaster(1, 1);
    setMaster(1, 9);
    expect(useSplitView.getState().masters).toEqual([null, 0, 1, 2]);
    setMaster(2, null);
    expect(useSplitView.getState().masters).toEqual([null, 0, null, 2]);
  });

  test("Tauschen, Schließen, Rehydrieren und Verbindungswechsel behalten die Beziehungen", async () => {
    const { keys } = fourPanes();
    useSplitView.getState().addPane(null);
    useSplitView.getState().addPane(null);
    useSplitView.getState().setMaster(3, 0);
    useSplitView.getState().swapPanes(0, 3);
    expect(useSplitView.getState().panes).toEqual([keys[3], keys[1], keys[2], keys[0]]);
    expect(useSplitView.getState().masters).toEqual([3, 3, 1, null]);
    useSplitView.getState().setPane(1, keys[0]);
    expect(useSplitView.getState().masters).toEqual([1, null, 3, 1]);
    await useSplitView.persist.rehydrate();
    expect(useSplitView.getState().masters).toEqual([1, null, 3, 1]);
    const b = addConnection("b");
    const a = useConnectionsStore.getState().activeId;
    useConnectionsStore.getState().setActiveId(b.id);
    expect(useSplitView.getState().masters).toEqual([]);
    useConnectionsStore.getState().setActiveId(a);
    expect(useSplitView.getState().masters).toEqual([1, null, 3, 1]);
    useSplitView.getState().closePane(1);
    expect(useSplitView.getState().masters).toEqual([null, 2, null]);
  });

  test("gespeicherte Splits ohne Master starten als Kette", async () => {
    const { a } = fourPanes();
    await useSplitView.persist.getOptions().storage?.setItem("l8db.split-view", {
      state: { byConnection: { [a.id]: { panes: ["x", "y", "z"], focusedPane: 0 } } },
      version: 0,
    } as never);
    await useSplitView.persist.rehydrate();
    expect(useSplitView.getState().masters).toEqual([null, 0, 1]);
  });
});

describe("Gespeicherte Ansichten", () => {
  function savedSplit() {
    const a = addConnection("a");
    useConnectionsStore.getState().setActiveId(a.id);
    useTableTabs.getState().openTab({ schema: "public", table: "users" });
    useTableTabs.getState().openTab({ schema: "public", table: "orders" });
    useTableTabs.getState().openTab({ schema: "public", table: "items" });
    const users = tabKey({ kind: "table", schema: "public", table: "users" });
    const orders = tabKey({ kind: "table", schema: "public", table: "orders" });
    const items = tabKey({ kind: "table", schema: "public", table: "items" });
    useSplitView.getState().addPane(users, orders);
    useSplitView.getState().setOrientation("vertical");
    const [group] = useSplitView.getState().groups[a.id];
    return { a, users, orders, items, group };
  }

  test("speichert jeden Split automatisch als Gruppe und folgt Änderungen", () => {
    const { a, users, orders, items, group } = savedSplit();
    expect(group.name).toBe("Ansicht 1");
    expect(group.tabs.map((tab) => tab && tabKey(tab))).toEqual([users, orders]);
    expect(useSplitView.getState().activeGroup).toBe(group.id);
    useSplitView.getState().setPane(1, items);
    expect(useSplitView.getState().groups[a.id][0].tabs.map((tab) => tab && tabKey(tab))).toEqual([
      users,
      items,
    ]);
  });

  test("Einzelansicht behält die Gruppe, Öffnen stellt sie wieder her", () => {
    const { a, users, orders, group } = savedSplit();
    useSplitView.getState().collapse();
    useSplitView.getState().setOrientation("horizontal");
    expect(useSplitView.getState().activeGroup).toBeNull();
    expect(useSplitView.getState().groups[a.id]).toHaveLength(1);

    const tab = useSplitView.getState().openGroup(group.id);
    expect(tab && tabKey(tab)).toBe(orders);
    expect(useSplitView.getState().panes).toEqual([users, orders]);
    expect(useSplitView.getState().orientation).toBe("vertical");
    expect(useSplitView.getState().activeGroup).toBe(group.id);
  });

  test("geschlossener Gruppen-Tab beendet den Split und wird beim Öffnen wieder geöffnet", () => {
    const { a, users, orders, group } = savedSplit();
    useTableTabs.getState().closeTab(orders);
    expect(useSplitView.getState().panes).toEqual([]);
    expect(useSplitView.getState().groups[a.id][0].tabs.map((tab) => tab && tabKey(tab))).toEqual([
      users,
      orders,
    ]);

    useSplitView.getState().openGroup(group.id);
    expect(useTableTabs.getState().tabs.map(tabKey)).toContain(orders);
    expect(useSplitView.getState().panes).toEqual([users, orders]);
  });

  test("Gruppen überstehen Neuladen und Verbindungswechsel", async () => {
    const { a, group } = savedSplit();
    const b = addConnection("b");
    useSplitView.getState().renameGroup(group.id, "  Bestellungen ");
    await useSplitView.persist.rehydrate();
    expect(useSplitView.getState().activeGroup).toBe(group.id);
    expect(useSplitView.getState().groups[a.id][0].name).toBe("Bestellungen");

    useConnectionsStore.getState().setActiveId(b.id);
    expect(useSplitView.getState().activeGroup).toBeNull();
    useConnectionsStore.getState().setActiveId(a.id);
    expect(useSplitView.getState().activeGroup).toBe(group.id);

    useSplitView.getState().deleteGroup(group.id);
    expect(useSplitView.getState().groups[a.id]).toEqual([]);
    expect(useSplitView.getState().activeGroup).toBeNull();
    expect(useSplitView.getState().panes).toEqual([]);
  });

  test("gleicher Split nutzt die vorhandene Gruppe, ein neuer legt eine weitere an", () => {
    const { a, users, orders, items, group } = savedSplit();
    useSplitView.getState().collapse();
    useSplitView.getState().setOrientation("horizontal");
    useSplitView.getState().addPane(users, orders);
    expect(useSplitView.getState().activeGroup).toBe(group.id);
    expect(useSplitView.getState().orientation).toBe("vertical");
    expect(useSplitView.getState().groups[a.id][0].orientation).toBe("vertical");
    expect(useSplitView.getState().groups[a.id]).toHaveLength(1);

    useSplitView.getState().collapse();
    useSplitView.getState().addPane(users, items);
    const groups = useSplitView.getState().groups[a.id];
    expect(groups.map((entry) => entry.name)).toEqual(["Ansicht 1", "Ansicht 2"]);
    expect(useSplitView.getState().activeGroup).toBe(groups[1].id);

    useSplitView.getState().collapse();
    useSplitView.getState().deleteGroup(group.id);
    useSplitView.getState().addPane(orders, items);
    expect(useSplitView.getState().groups[a.id].map((entry) => entry.name)).toEqual([
      "Ansicht 2",
      "Ansicht 1",
    ]);
  });
});
