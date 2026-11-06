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
const { MAX_SPLIT_PANES, isSplitShown, openDetached, standaloneTabs, useSplitView } = await import(
  "../src/lib/split-view"
);

await useConnectionsStore.persist.rehydrate();
await useTableTabs.persist.rehydrate();
await useSplitView.persist.rehydrate();

const state = () => useSplitView.getState();

function addConnection(name: string) {
  return useConnectionsStore.getState().addConnection({
    name,
    kind: "postgres",
    connectionString: "postgresql://localhost:5432/db",
    sslMode: "prefer",
  });
}

function connect(name = "a") {
  const connection = addConnection(name);
  useConnectionsStore.getState().setActiveId(connection.id);
  return connection;
}

function open(...tables: string[]) {
  for (const table of tables) useTableTabs.getState().openTab({ schema: "public", table });
  return tables.map((table) => tabKey({ kind: "table", schema: "public", table }));
}

function reset() {
  storage.clear();
  useConnectionsStore.setState({ connections: [], activeId: null });
  useTableTabs.setState({ tabs: [], tabsByConnection: {}, queryCounter: 0 });
  useSplitView.setState({
    panes: [],
    paneTabs: [],
    layout: null,
    masters: [],
    focusedPane: 0,
    byConnection: {},
    paneConnections: {},
    orientation: "horizontal",
    activeGroup: null,
    groups: {},
    away: true,
  });
}

function standalone() {
  return standaloneTabs(useTableTabs.getState().tabs, state().paneTabs).map(tabKey);
}

beforeEach(() => {
  reset();
});

describe("split view", () => {
  test("Ansicht teilen öffnet einen leeren Bereich neben dem aktiven Tab", () => {
    connect();
    const [users, orders] = open("users", "orders");

    state().split({ activeKey: users });
    expect(state().panes).toEqual([users, null]);
    expect(state().paneTabs).toEqual([[users], []]);
    expect(standalone()).toEqual([orders]);
    expect(state().focusedPane).toBe(1);
    expect(state().masters).toEqual([null, 0]);
    expect(state().layout).toBeNull();
  });

  test("neue Tabs landen im fokussierten Bereich", () => {
    connect();
    const [users, orders] = open("users", "orders");
    state().split({ activeKey: users });

    const [items] = open("items");
    expect(state().panes).toEqual([users, items]);
    expect(state().paneTabs).toEqual([[users], [items]]);
    expect(standalone()).toEqual([orders]);
  });

  test("Hintergrund-Tabs und Tabs bei ausgeblendetem Split bleiben eigenständig", () => {
    connect();
    const [users, orders] = open("users", "orders");
    state().split({ activeKey: users });

    const [items] = openDetached(() => open("items"));
    expect(state().paneTabs).toEqual([[users], []]);
    expect(standalone()).toEqual([orders, items]);

    state().reveal(orders);
    expect(state().away).toBe(true);
    expect(isSplitShown(state(), orders)).toBe(false);
    const [logs] = open("logs");
    expect(state().paneTabs).toEqual([[users], []]);
    expect(standalone()).toEqual([orders, items, logs]);

    state().reveal(users);
    expect(state().away).toBe(false);
    expect(isSplitShown(state(), users)).toBe(true);
    const [notes] = open("notes");
    expect(state().paneTabs).toEqual([[users, notes], []]);
    expect(state().panes).toEqual([users, null]);
  });

  test("Lösen holt einen Tab aus seinem Bereich in die Tab-Leiste", () => {
    connect();
    const [users, orders, items] = open("users", "orders", "items");
    state().split({ activeKey: users, key: orders, edge: "right" });
    state().moveTab(items, 1);
    expect(state().paneTabs).toEqual([[users], [orders, items]]);

    state().detach(items, null);
    expect(state().paneTabs).toEqual([[users], [orders]]);
    expect(standalone()).toEqual([items]);
    expect(useTableTabs.getState().tabs.map(tabKey)).toEqual([users, orders, items]);

    state().detach(orders, items);
    expect(state().panes).toEqual([]);
    expect(useTableTabs.getState().tabs.map(tabKey)).toEqual([users, orders, items]);
    expect(standalone()).toEqual([users, orders, items]);
  });

  test("Tab an den Rand ziehen verschiebt ihn in einen neuen Bereich", () => {
    connect();
    const [users, orders, items] = open("users", "orders", "items");

    state().split({ activeKey: users, key: orders, edge: "left" });
    expect(state().panes).toEqual([orders, users]);
    expect(state().paneTabs).toEqual([[orders], [users]]);
    expect(standalone()).toEqual([items]);
    expect(state().focusedPane).toBe(0);
    expect(state().masters).toEqual([1, null]);
    expect(state().layout).toEqual({ dir: "row", children: [null, null] });

    state().split({ activeKey: orders, key: items, target: 1, edge: "bottom" });
    expect(state().panes).toEqual([orders, users, items]);
    expect(state().paneTabs).toEqual([[orders], [users], [items]]);
    expect(state().focusedPane).toBe(2);
    expect(state().layout).toEqual({
      dir: "row",
      children: [null, { dir: "column", children: [null, null] }],
    });
  });

  test("den angezeigten Tab an den Rand ziehen legt ihn dorthin und lässt die andere Seite leer", () => {
    connect();
    const [users, orders] = open("users", "orders");

    state().split({ activeKey: orders, key: orders, edge: "left" });
    expect(state().panes).toEqual([orders, null]);
    expect(standalone()).toEqual([users]);

    state().collapse();
    state().split({ activeKey: orders, key: orders, edge: "right" });
    expect(state().panes).toEqual([null, orders]);
    expect(state().focusedPane).toBe(1);
  });

  test("unten teilen aus der Einzelansicht ordnet die Bereiche untereinander an", () => {
    connect();
    const [users, orders] = open("users", "orders");

    state().split({ activeKey: users, key: orders, edge: "bottom" });
    expect(state().orientation).toBe("vertical");
    expect(state().layout).toEqual({ dir: "column", children: [null, null] });
  });

  test("stoppt bei vier Bereichen", () => {
    connect();
    const [users] = open("users");
    for (let i = 0; i < 6; i++) state().split({ activeKey: users });
    expect(state().panes).toHaveLength(MAX_SPLIT_PANES);
  });

  test("reveal aktiviert einen Tab in seinem Bereich und ignoriert unbekannte", () => {
    connect();
    const [users, orders, items] = open("users", "orders", "items");
    state().split({ activeKey: users, key: items, edge: "right" });

    state().moveTab(orders, 0);
    state().reveal(users);
    expect(state().panes).toEqual([users, items]);
    expect(state().focusedPane).toBe(0);

    state().reveal(orders);
    expect(state().panes).toEqual([orders, items]);
    expect(state().focusedPane).toBe(0);

    state().reveal(tabKey({ kind: "table", schema: "public", table: "missing" }));
    expect(state().panes).toEqual([orders, items]);
    expect(state().away).toBe(false);
  });

  test("Bereich schließen lässt seine Tabs eigenständig offen, ein Bereich beendet den Split", () => {
    connect();
    const [users, orders, items] = open("users", "orders", "items");
    state().split({ activeKey: users, key: orders, edge: "right" });
    state().split({ activeKey: orders, key: items, target: 0, edge: "bottom" });
    expect(state().panes).toEqual([users, items, orders]);

    expect(state().closePane(1)).toBe(users);
    expect(state().panes).toEqual([users, orders]);
    expect(state().paneTabs).toEqual([[users], [orders]]);
    expect(standalone()).toEqual([items]);
    expect(state().focusedPane).toBe(0);
    expect(state().layout).toEqual({ dir: "row", children: [null, null] });

    expect(state().closePane(1)).toBe(users);
    expect(state().panes).toEqual([]);
    expect(useTableTabs.getState().tabs.map(tabKey)).toEqual([users, orders, items]);
  });

  test("letzter geschlossener Tab eines Bereichs schließt den Bereich, die Gruppe bleibt", () => {
    const a = connect();
    const [users, orders] = open("users", "orders");
    state().split({ activeKey: users, key: orders, edge: "right" });

    useTableTabs.getState().closeTab(orders);
    expect(state().panes).toEqual([]);
    expect(state().groups[a.id]).toHaveLength(1);
  });

  test("Split bleibt pro Connection erhalten", () => {
    const a = addConnection("a");
    const b = addConnection("b");
    useConnectionsStore.getState().setActiveId(a.id);
    const [users] = open("users");
    state().split({ activeKey: users });

    useConnectionsStore.getState().setActiveId(b.id);
    expect(state().panes).toEqual([]);

    useConnectionsStore.getState().setActiveId(a.id);
    expect(state().panes).toEqual([users, null]);
    expect(state().paneTabs).toEqual([[users], []]);
  });

  test("Ausrichtung bleibt beim Tauschen, Rehydrieren und Verbindungswechsel erhalten", async () => {
    const a = addConnection("a");
    const b = addConnection("b");
    useConnectionsStore.getState().setActiveId(a.id);
    const [users] = open("users");
    state().split({ activeKey: users });
    state().setOrientation("vertical");
    state().swapPanes(0, 1);
    await useSplitView.persist.rehydrate();
    expect(state().orientation).toBe("vertical");
    expect(state().panes).toEqual([null, users]);
    useConnectionsStore.getState().setActiveId(b.id);
    expect(state().orientation).toBe("horizontal");
    useConnectionsStore.getState().setActiveId(a.id);
    expect(state().orientation).toBe("vertical");
    expect(state().panes).toHaveLength(2);
  });

  test("moveTab verschiebt Tabs zwischen Bereichen und entfernt leere Bereiche", () => {
    connect();
    const [users, orders, items] = open("users", "orders", "items");
    state().split({ activeKey: users });
    state().moveTab(orders, 0);

    state().moveTab(items, 1);
    expect(state().panes).toEqual([orders, items]);
    expect(state().paneTabs).toEqual([[users, orders], [items]]);
    expect(state().focusedPane).toBe(1);

    state().moveTab(users, 1, 0);
    expect(state().panes).toEqual([orders, users]);
    expect(state().paneTabs).toEqual([[orders], [users, items]]);

    state().moveTab(orders, 1, 2);
    expect(state().panes).toEqual([]);
    expect(useTableTabs.getState().tabs.map(tabKey)).toEqual([users, items, orders]);
  });

  test("ein während des Ziehens geschlossener Tab wird weder verschoben noch abgespalten", () => {
    connect();
    const [users, orders, items] = open("users", "orders", "items");
    state().split({ activeKey: users, key: orders, edge: "right" });
    useTableTabs.getState().closeTab(items);
    const before = state().paneTabs;
    expect(before.flat()).not.toContain(items);

    state().moveTab(items, 1);
    state().split({ activeKey: users, key: items, edge: "right" });
    expect(state().paneTabs).toEqual(before);
  });

  test("swapPanes vertauscht zwei Bereiche samt Tabs", () => {
    connect();
    const [users, orders] = open("users", "orders");
    state().split({ activeKey: users, key: orders, edge: "right" });

    state().swapPanes(0, 1);
    expect(state().panes).toEqual([orders, users]);
    expect(state().paneTabs).toEqual([[orders], [users]]);
    expect(state().focusedPane).toBe(1);
    state().swapPanes(0, 5);
    expect(state().panes).toEqual([orders, users]);
  });

  test("Anordnung drehen transponiert ein gezogenes Layout", () => {
    connect();
    const [users, orders, items] = open("users", "orders", "items");
    state().split({ activeKey: users, key: orders, edge: "right" });
    state().split({ activeKey: orders, key: items, target: 1, edge: "bottom" });

    state().setOrientation("vertical");
    expect(state().layout).toEqual({
      dir: "column",
      children: [null, { dir: "row", children: [null, null] }],
    });
  });

  test("Neuladen stellt Tab-Listen und Layout pro Bereich wieder her", async () => {
    connect();
    const [users, orders, items] = open("users", "orders", "items");
    state().split({ activeKey: users, key: orders, edge: "right" });
    state().split({ activeKey: orders, key: items, target: 0, edge: "bottom" });
    const { paneTabs, layout, panes } = state();

    await useSplitView.persist.rehydrate();
    expect(state().panes).toEqual(panes);
    expect(state().paneTabs).toEqual(paneTabs);
    expect(state().layout).toEqual(layout);
  });

  test("alte Splits behalten nur die angezeigten Tabs, alle anderen werden eigenständig", async () => {
    const a = connect();
    const [users, orders, items, logs] = open("users", "orders", "items", "logs");
    await useSplitView.persist.getOptions().storage?.setItem("l8db.split-view", {
      state: {
        byConnection: {
          [a.id]: {
            panes: [users, orders],
            paneTabs: [
              [users, logs],
              [orders, items],
            ],
            focusedPane: 1,
          },
        },
      },
      version: 0,
    } as never);

    await useSplitView.persist.rehydrate();
    expect(state().panes).toEqual([users, orders]);
    expect(state().paneTabs).toEqual([[users], [orders]]);
    expect(standalone()).toEqual([items, logs]);
    expect(state().focusedPane).toBe(1);
    expect(state().layout).toBeNull();
    expect(state().away).toBe(true);

    state().moveTab(items, 1);
    await useSplitView.persist.rehydrate();
    expect(state().paneTabs).toEqual([[users], [orders, items]]);
  });
});

describe("Verbindung pro Bereich", () => {
  test("Tabs mit eigener Verbindung bleiben beim Lösen und Bereich schließen in der geteilten Ansicht", () => {
    const a = connect("A");
    const b = addConnection("B");
    const [users, orders, items, logs] = open("users", "orders", "items", "logs");
    state().split({ activeKey: users, key: orders, edge: "right" });
    state().split({ activeKey: orders, key: items, target: 1, edge: "right" });
    state().moveTab(logs, 2);
    state().setPaneConnection(logs, b.id);
    const remoteUsers = tabKey({
      kind: "table",
      schema: "public",
      table: "users",
      connectionId: b.id,
    });
    state().focusPane(2);
    state().setPaneTab(2, b.id, { kind: "table", schema: "public", table: "users" });
    expect(state().paneTabs).toEqual([[users], [orders], [items, logs, remoteUsers]]);
    expect(state().paneConnections).toEqual({ [`${a.id}|${logs}`]: b.id });

    state().detach(logs, null);
    state().detach(remoteUsers, null);
    expect(state().paneTabs[2]).toEqual([items, logs, remoteUsers]);

    state().closePane(2);
    expect(state().paneTabs).toEqual([[users], [orders, logs, remoteUsers]]);
    expect(state().panes).toEqual([users, orders]);
    expect(standalone()).toEqual([items]);
  });

  test("alte Splits behalten Tabs mit eigener Verbindung in ihrem Bereich", async () => {
    const a = connect("A");
    const b = addConnection("B");
    const [users, orders, items, logs] = open("users", "orders", "items", "logs");
    await useSplitView.persist.getOptions().storage?.setItem("l8db.split-view", {
      state: {
        byConnection: {
          [a.id]: {
            panes: [users, orders],
            paneTabs: [
              [users, logs],
              [orders, items],
            ],
            focusedPane: 1,
          },
        },
        paneConnections: { [`${a.id}|${logs}`]: b.id },
      },
      version: 0,
    } as never);

    await useSplitView.persist.rehydrate();
    expect(state().paneTabs).toEqual([[users, logs], [orders]]);
    expect(standalone()).toEqual([items]);
  });

  test("override is scoped to the active connection and cleared with it", () => {
    const a = addConnection("A");
    const b = addConnection("B");
    useConnectionsStore.setState({ activeId: a.id });
    state().setPaneConnection("table:public.t", b.id);
    expect(state().paneConnections).toEqual({ [`${a.id}|table:public.t`]: b.id });
    state().setPaneConnection("table:public.t", null);
    expect(state().paneConnections).toEqual({});
    state().setPaneConnection("table:public.t", b.id);
    state().clearForConnection(b.id);
    expect(state().paneConnections).toEqual({});
  });

  test("Bereich einer anderen Verbindung zeigt eigene Tabellen und bereits offene dort, wo sie sind", () => {
    const a = addConnection("A");
    const b = addConnection("B");
    useConnectionsStore.getState().setActiveId(a.id);
    const [users, orders] = open("users", "orders");
    const remoteUsers = tabKey({
      kind: "table",
      schema: "public",
      table: "users",
      connectionId: b.id,
    });
    const remoteOrders = tabKey({
      kind: "table",
      schema: "public",
      table: "orders",
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

    state().split({ activeKey: users });
    state().setPaneConnection("split-detail:1", b.id);
    state().setPaneTab(1, b.id, { kind: "table", schema: "public", table: "users" });
    expect(state().panes).toEqual([users, remoteUsers]);
    expect(state().paneTabs).toEqual([[users], [remoteUsers]]);
    expect(state().paneConnections).toEqual({});

    useTableTabs.getState().closeTab(orders);
    expect(state().panes).toEqual([users, remoteUsers]);

    state().setPaneTab(0, b.id, { kind: "table", schema: "public", table: "users" });
    expect(state().panes).toEqual([users, remoteUsers]);
    expect(state().focusedPane).toBe(1);

    state().focusPane(0);
    state().setPaneTab(1, b.id, { kind: "table", schema: "public", table: "orders" });
    expect(state().paneTabs).toEqual([[users], [remoteUsers, remoteOrders]]);
    expect(state().panes).toEqual([users, remoteOrders]);
    expect(state().focusedPane).toBe(1);
  });

  test("Bereich einer anderen Verbindung zeigt auch Packages und Funktionen", () => {
    const a = addConnection("A");
    const b = addConnection("B");
    useConnectionsStore.getState().setActiveId(a.id);
    const [users] = open("users");
    state().split({ activeKey: users });

    state().setPaneTab(1, b.id, { kind: "package", schema: "HR", name: "PAYROLL" });
    const key = state().panes[1];
    expect(remoteTableTab(key)).toBeNull();
    expect(remoteTab(key)).toEqual({
      kind: "package",
      schema: "HR",
      name: "PAYROLL",
      connectionId: b.id,
    });
    const parsed = remoteTab(key);
    expect(parsed && tabKey(parsed)).toBe(key);

    open("orders");
    expect(state().panes).toEqual([users, key]);

    state().setPaneTab(0, b.id, { kind: "package", schema: "HR", name: "PAYROLL" });
    expect(state().panes).toEqual([users, key]);
    expect(state().focusedPane).toBe(1);

    state().setPaneTab(1, b.id, { kind: "function", schema: "public", name: "f", oid: "42" });
    expect(remoteTab(state().panes[1])).toEqual({
      kind: "function",
      schema: "public",
      name: "f",
      oid: "42",
      connectionId: b.id,
    });

    state().setPaneTab(1, null, null);
    expect(state().panes).toEqual([users, null]);
  });
});

describe("Master pro Bereich", () => {
  function chain() {
    const a = connect();
    const keys = open("t0", "t1", "t2", "t3");
    state().split({ activeKey: keys[0] });
    return { a, keys };
  }

  function fourPanes() {
    const a = connect();
    const keys = open("t0", "t1", "t2", "t3");
    for (let pane = 0; pane < 3; pane++)
      state().split({ activeKey: keys[pane], key: keys[pane + 1], target: pane, edge: "right" });
    return { a, keys };
  }

  test("neuer Bereich wird Detail des fokussierten Bereichs", () => {
    chain();
    expect(state().masters).toEqual([null, 0]);
    state().split({ activeKey: null });
    expect(state().masters).toEqual([null, 0, 1]);
    state().focusPane(0);
    state().split({ activeKey: null });
    expect(state().masters).toEqual([null, 0, 0, 2]);
  });

  test("ein Master mit drei Details und vierfache Kette, Zyklen werden abgelehnt", () => {
    chain();
    state().split({ activeKey: null });
    state().split({ activeKey: null });
    const { setMaster } = state();
    setMaster(2, 0);
    setMaster(3, 0);
    expect(state().masters).toEqual([null, 0, 0, 0]);
    setMaster(2, 1);
    setMaster(3, 2);
    expect(state().masters).toEqual([null, 0, 1, 2]);
    setMaster(0, 3);
    setMaster(1, 1);
    setMaster(1, 9);
    expect(state().masters).toEqual([null, 0, 1, 2]);
    setMaster(2, null);
    expect(state().masters).toEqual([null, 0, null, 2]);
  });

  test("Tauschen, Schließen, Rehydrieren und Verbindungswechsel behalten die Beziehungen", async () => {
    const { a, keys } = fourPanes();
    expect(state().masters).toEqual([null, 0, 1, 2]);
    state().setMaster(3, 0);
    state().swapPanes(0, 3);
    expect(state().panes).toEqual([keys[3], keys[1], keys[2], keys[0]]);
    expect(state().masters).toEqual([3, 3, 1, null]);
    await useSplitView.persist.rehydrate();
    expect(state().masters).toEqual([3, 3, 1, null]);
    const b = addConnection("b");
    useConnectionsStore.getState().setActiveId(b.id);
    expect(state().masters).toEqual([]);
    useConnectionsStore.getState().setActiveId(a.id);
    expect(state().masters).toEqual([3, 3, 1, null]);
    state().closePane(1);
    expect(state().masters).toEqual([2, null, null]);
    expect(state().paneTabs).toEqual([[keys[3]], [keys[2]], [keys[0]]]);
  });

  test("gespeicherte Splits ohne Master starten als Kette", async () => {
    const { a, keys } = chain();
    await useSplitView.persist.getOptions().storage?.setItem("l8db.split-view", {
      state: {
        byConnection: { [a.id]: { panes: [keys[0], keys[1], keys[2]], focusedPane: 0 } },
      },
      version: 0,
    } as never);
    await useSplitView.persist.rehydrate();
    expect(state().masters).toEqual([null, 0, 1]);
  });
});

describe("Gespeicherte Ansichten", () => {
  function savedSplit() {
    const a = connect();
    const [users, orders, items] = open("users", "orders", "items");
    state().split({ activeKey: users, key: orders, edge: "right" });
    state().setOrientation("vertical");
    const [group] = state().groups[a.id];
    return { a, users, orders, items, group };
  }

  test("speichert jeden Split automatisch als Gruppe und folgt Änderungen", () => {
    const { a, users, orders, items, group } = savedSplit();
    expect(group.name).toBe("Ansicht 1");
    expect(group.tabs.map((tab) => tab && tabKey(tab))).toEqual([users, orders]);
    expect(state().activeGroup).toBe(group.id);
    state().moveTab(items, 1);
    const [synced] = state().groups[a.id];
    expect(synced.tabs.map((tab) => tab && tabKey(tab))).toEqual([users, items]);
  });

  test("Einzelansicht behält die Gruppe, Öffnen stellt sie samt Layout wieder her", () => {
    const { a, users, orders, items, group } = savedSplit();
    state().collapse();
    state().setOrientation("horizontal");
    expect(state().activeGroup).toBeNull();
    expect(state().groups[a.id]).toHaveLength(1);

    const tab = state().openGroup(group.id);
    expect(tab && tabKey(tab)).toBe(orders);
    expect(state().panes).toEqual([users, orders]);
    expect(state().paneTabs).toEqual([[users], [orders]]);
    expect(standalone()).toEqual([items]);
    expect(state().orientation).toBe("vertical");
    expect(state().layout).toEqual({ dir: "column", children: [null, null] });
    expect(state().activeGroup).toBe(group.id);
  });

  test("Wechsel zwischen Ansichten stellt die Tab-Listen jedes Bereichs wieder her", () => {
    const { a, users, orders, items, group } = savedSplit();
    state().collapse();
    state().split({ activeKey: users, key: items, edge: "right" });
    state().moveTab(orders, 0);
    const other = state().groups[a.id][1];
    const otherTabs = state().paneTabs;
    expect(otherTabs).toEqual([[users, orders], [items]]);

    state().openGroup(group.id);
    expect(state().paneTabs).toEqual([[users], [orders]]);
    expect(standalone()).toEqual([items]);
    state().openGroup(other.id);
    expect(state().paneTabs).toEqual(otherTabs);
  });

  test("geschlossener Gruppen-Tab beendet den Split und wird beim Öffnen wieder geöffnet", () => {
    const { a, users, orders, group } = savedSplit();
    useTableTabs.getState().closeTab(orders);
    expect(state().panes).toEqual([]);
    expect(state().groups[a.id][0].tabs.map((tab) => tab && tabKey(tab))).toEqual([users, orders]);

    state().openGroup(group.id);
    expect(useTableTabs.getState().tabs.map(tabKey)).toContain(orders);
    expect(state().panes).toEqual([users, orders]);
  });

  test("Gruppen überstehen Neuladen und Verbindungswechsel", async () => {
    const { a, group } = savedSplit();
    const b = addConnection("b");
    state().renameGroup(group.id, "  Bestellungen ");
    await useSplitView.persist.rehydrate();
    expect(state().activeGroup).toBe(group.id);
    expect(state().groups[a.id][0].name).toBe("Bestellungen");

    useConnectionsStore.getState().setActiveId(b.id);
    expect(state().activeGroup).toBeNull();
    useConnectionsStore.getState().setActiveId(a.id);
    expect(state().activeGroup).toBe(group.id);

    state().deleteGroup(group.id);
    expect(state().groups[a.id]).toEqual([]);
    expect(state().activeGroup).toBeNull();
    expect(state().panes).toEqual([]);
  });

  test("Gruppe lässt sich nach Schließen aller Tabs und Neustart wieder öffnen", async () => {
    const { a, users, orders, group } = savedSplit();
    state().renameGroup(group.id, "Bestellungen");
    state().collapse();
    useTableTabs.getState().closeAllTabs();
    expect(useTableTabs.getState().tabs).toEqual([]);
    await useSplitView.persist.rehydrate();
    const [restored] = state().groups[a.id];
    expect(restored.name).toBe("Bestellungen");

    state().openGroup(restored.id);
    expect(useTableTabs.getState().tabs.map(tabKey)).toEqual([users, orders]);
    expect(state().panes).toEqual([users, orders]);
    expect(state().orientation).toBe("vertical");
  });

  test("gleicher Split nutzt die vorhandene Gruppe, ein neuer legt eine weitere an", () => {
    const { a, users, orders, items, group } = savedSplit();
    state().collapse();
    state().split({ activeKey: users, key: orders, edge: "right" });
    expect(state().activeGroup).toBe(group.id);
    expect(state().groups[a.id]).toHaveLength(1);

    state().collapse();
    state().split({ activeKey: users, key: items, edge: "right" });
    const groups = state().groups[a.id];
    expect(groups.map((entry) => entry.name)).toEqual(["Ansicht 1", "Ansicht 2"]);
    expect(state().activeGroup).toBe(groups[1].id);

    state().collapse();
    state().deleteGroup(group.id);
    state().split({ activeKey: orders, key: items, edge: "right" });
    expect(state().groups[a.id].map((entry) => entry.name)).toEqual(["Ansicht 2", "Ansicht 1"]);
  });
});
