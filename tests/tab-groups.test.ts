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
const {
  MAX_SPLIT_GROUPS,
  foreignSplitGroups,
  groupPaneTabs,
  isTabSet,
  openDetached,
  standaloneTabs,
  useSplitView,
} = await import("../src/lib/split-view");
type Tab = import("../src/lib/table-tabs").Tab;
type SplitGroup = import("../src/lib/split-view").SplitGroup;

await useConnectionsStore.persist.rehydrate();
await useTableTabs.persist.rehydrate();
await useSplitView.persist.rehydrate();

const state = () => useSplitView.getState();
const tabs = () => useTableTabs.getState();
const openKeys = () => tabs().tabs.map(tabKey);
const keysOf = (group: SplitGroup) => groupPaneTabs(group).map((list) => list.map(tabKey));
const table = (name: string) => tabKey({ kind: "table", schema: "public", table: name });

const EMPTY = {
  panes: [],
  paneTabs: [],
  layout: null,
  masters: [],
  focusedPane: 0,
  byConnection: {},
  paneConnections: {},
  orientation: "horizontal" as const,
  activeGroup: null,
  groups: {},
  closedTabs: {},
  away: true,
};

function addConnection(name: string) {
  return useConnectionsStore.getState().addConnection({
    name,
    kind: "postgres",
    connectionString: `postgresql://${name}.example.com:5432/db`,
    sslMode: "prefer",
  });
}

function connect(name = "a") {
  const connection = addConnection(name);
  useConnectionsStore.getState().setActiveId(connection.id);
  return connection;
}

function open(...names: string[]) {
  for (const name of names) tabs().openTab({ schema: "public", table: name });
  return names.map(table);
}

function query(sql: string, title: string) {
  return `query:${tabs().openQueryTabWithSql(sql, title)}`;
}

async function restart() {
  const saved = storage.get("l8db.split-view") ?? "";
  useSplitView.setState(EMPTY);
  storage.set("l8db.split-view", saved);
  await useSplitView.persist.rehydrate();
}

function standalone() {
  return standaloneTabs(tabs().tabs, state().paneTabs).map(tabKey);
}

beforeEach(() => {
  storage.clear();
  useConnectionsStore.setState({ connections: [], activeId: null });
  useTableTabs.setState({ tabs: [], tabsByConnection: {}, recentlyClosed: [] });
  useSplitView.setState(EMPTY);
});

describe("Alle Tabs einer Gruppe", () => {
  function wideSplit() {
    const a = connect();
    const [users, orders, items, log] = open("users", "orders", "items", "log");
    state().split({ activeKey: users, key: orders, edge: "right" });
    state().moveTab(items, 0);
    state().moveTab(log, 1, 0);
    return { a, users, orders, items, log, id: state().activeGroup ?? "" };
  }

  test("speichert jeden Tab jedes Bereichs und folgt Änderungen", () => {
    const { a, users, orders, items, log } = wideSplit();
    const [group] = state().groups[a.id];
    expect(keysOf(group)).toEqual([
      [users, items],
      [log, orders],
    ]);
    expect(group.tabs.map((tab) => tab && tabKey(tab))).toEqual(state().panes);

    state().detach(items);
    expect(keysOf(state().groups[a.id][0])).toEqual([[users], [log, orders]]);
    state().detach(log);
    expect(state().groups[a.id][0].paneTabs).toBeUndefined();
    expect(keysOf(state().groups[a.id][0])).toEqual([[users], [orders]]);
  });

  test("öffnet nach Schließen aller Tabs und Neustart wieder alle Tabs je Bereich", async () => {
    const { a, users, orders, items, log, id } = wideSplit();
    state().collapse();
    tabs().closeAllTabs();
    expect(openKeys()).toEqual([]);
    await restart();
    expect(state().panes).toEqual([]);
    expect(keysOf(state().groups[a.id][0])).toEqual([
      [users, items],
      [log, orders],
    ]);

    const focused = state().openGroup(id);
    expect(focused && tabKey(focused)).toBe(state().panes[state().focusedPane]);
    expect(state().paneTabs).toEqual([
      [users, items],
      [log, orders],
    ]);
    expect(openKeys().sort()).toEqual([users, orders, items, log].sort());
    expect(standalone()).toEqual([]);
    expect(state().activeGroup).toBe(id);
    expect(state().away).toBe(false);
  });

  test("öffnet bereits offene Tabs nicht doppelt und lässt fremde Tabs eigenständig", () => {
    const { users, orders, items, log, id } = wideSplit();
    state().collapse();
    tabs().closeTab(items);
    const [extra] = open("extra");

    state().openGroup(id);
    expect(openKeys().filter((key) => key === users)).toHaveLength(1);
    expect(openKeys().sort()).toEqual([users, orders, items, log, extra].sort());
    expect(state().paneTabs).toEqual([
      [users, items],
      [log, orders],
    ]);
    expect(standalone()).toEqual([extra]);
  });

  test("Abfragen behalten ihr SQL, auch wenn sie nicht der angezeigte Tab waren", async () => {
    const a = connect();
    const [users, orders] = open("users", "orders");
    const draft = query("SELECT 42", "Entwurf");
    state().split({ activeKey: users, key: orders, edge: "right" });
    state().moveTab(draft, 0, 0);
    state().reveal(users);
    const id = state().activeGroup ?? "";
    expect(state().panes).toEqual([users, orders]);
    expect(keysOf(state().groups[a.id][0])).toEqual([[draft, users], [orders]]);
    expect(storage.get("l8db.split-view")).not.toContain("SELECT 42");

    state().collapse();
    tabs().closeTab(draft);
    await restart();
    expect(storage.get("l8db.split-view")).toContain("SELECT 42");

    state().openGroup(id);
    const restored = tabs().tabs.find((tab) => tabKey(tab) === draft);
    expect(restored).toMatchObject({ kind: "query", title: "Entwurf", sql: "SELECT 42" });
    expect(state().paneTabs).toEqual([[draft, users], [orders]]);
  });

  test("im laufenden Split geschlossene Tabs verlassen die Gruppe", () => {
    const { a, users, orders, items, log } = wideSplit();
    tabs().closeTab(items);
    expect(state().panes).toHaveLength(2);
    expect(keysOf(state().groups[a.id][0])).toEqual([[users], [log, orders]]);
  });

  test("alte Gruppen ohne Tab-Listen öffnen wie bisher", async () => {
    const a = connect();
    const [users, orders] = open("users", "orders");
    const legacy: SplitGroup = {
      id: "legacy",
      name: "Alt",
      tabs: [
        { kind: "table", schema: "public", table: "users" },
        { kind: "table", schema: "public", table: "orders" },
      ],
      masters: [null, 0],
      orientation: "vertical",
      focusedPane: 1,
    };
    storage.set(
      "l8db.split-view",
      JSON.stringify({ state: { groups: { [a.id]: [legacy] } }, version: 0 }),
    );
    await useSplitView.persist.rehydrate();

    const focused = state().openGroup("legacy");
    expect(focused && tabKey(focused)).toBe(orders);
    expect(state().paneTabs).toEqual([[users], [orders]]);
    expect(state().orientation).toBe("vertical");
  });
});

describe("Tab-Leiste als Gruppe speichern", () => {
  test("speichert die offenen Tabs und öffnet sie später ohne Split wieder", async () => {
    const a = connect();
    const [users, orders] = open("users", "orders");
    const draft = query("SELECT now()", "Zeit");

    const id = state().saveTabs(orders) ?? "";
    const [group] = state().groups[a.id];
    expect(group.id).toBe(id);
    expect(group.name).toBe("Gruppe 1");
    expect(isTabSet(group)).toBe(true);
    expect(keysOf(group)).toEqual([[users, orders, draft]]);
    expect(group.tabs.map((tab) => tab && tabKey(tab))).toEqual([orders]);
    expect(state().activeGroup).toBeNull();
    expect(state().panes).toEqual([]);

    tabs().closeAllTabs();
    await restart();
    const focused = state().openGroup(id);
    expect(focused && tabKey(focused)).toBe(orders);
    expect(openKeys()).toEqual([users, orders, draft]);
    expect(tabs().tabs.find((tab) => tabKey(tab) === draft)).toMatchObject({
      sql: "SELECT now()",
    });
    expect(state().panes).toEqual([]);
    expect(state().activeGroup).toBeNull();
  });

  test("nimmt neben einer geteilten Ansicht nur die Tabs der Tab-Leiste", () => {
    const a = connect();
    const [users, orders, items, log] = open("users", "orders", "items", "log");
    state().split({ activeKey: users, key: orders, edge: "right" });
    const split = state().activeGroup;

    const id = state().saveTabs(log) ?? "";
    const saved = state().groups[a.id].find((group) => group.id === id);
    expect(saved && keysOf(saved)).toEqual([[items, log]]);
    expect(state().activeGroup).toBe(split);
    expect(state().panes).toEqual([users, orders]);

    tabs().closeTabs([items, log]);
    const focused = state().openGroup(id);
    expect(focused && tabKey(focused)).toBe(log);
    expect(standalone()).toEqual([items, log]);
    expect(state().panes).toEqual([users, orders]);
    expect(state().away).toBe(true);
    expect(state().activeGroup).toBe(split);
  });

  test("zählt Namen hoch, überschreibt gezielt und lässt Umbenennen und Löschen zu", () => {
    const a = connect();
    const [users, orders] = open("users", "orders");
    const first = state().saveTabs(null) ?? "";
    const second = state().saveTabs(null) ?? "";
    expect(state().groups[a.id].map((group) => group.name)).toEqual(["Gruppe 1", "Gruppe 2"]);

    state().renameGroup(first, "  Bestellungen ");
    const [items] = open("items");
    expect(state().saveTabs(items, first)).toBe(first);
    const [renamed, untouched] = state().groups[a.id];
    expect(renamed.name).toBe("Bestellungen");
    expect(keysOf(renamed)).toEqual([[users, orders, items]]);
    expect(renamed.tabs.map((tab) => tab && tabKey(tab))).toEqual([items]);
    expect(keysOf(untouched)).toEqual([[users, orders]]);

    state().deleteGroup(second);
    expect(state().groups[a.id].map((group) => group.id)).toEqual([first]);
    expect(openKeys()).toEqual([users, orders, items]);
  });

  test("speichert nichts ohne Tabs, ohne Workbench und nie über eine geteilte Ansicht", () => {
    const a = connect();
    expect(state().saveTabs(null)).toBeNull();
    useTableTabs.setState({
      tabs: [{ kind: "tool", tool: "workbench", id: "w1" } as Tab],
      tabsByConnection: {},
    });
    expect(state().saveTabs(null)).toBeNull();
    expect(state().groups[a.id] ?? []).toEqual([]);

    const [users, orders] = open("users", "orders");
    state().split({ activeKey: users, key: orders, edge: "right" });
    const split = state().activeGroup ?? "";
    expect(state().saveTabs(null, split)).toBeNull();
    expect(state().saveTabs(null, "unbekannt")).toBeNull();
    expect(keysOf(state().groups[a.id][0])).toEqual([[users], [orders]]);
  });

  test("geschlossene Tabs einer gespeicherten Gruppe bleiben samt SQL erhalten", () => {
    const a = connect();
    const [users] = open("users");
    const draft = query("SELECT 7", "Sieben");
    const id = state().saveTabs(users) ?? "";
    tabs().updateQuerySql(draft.slice("query:".length), "SELECT 8");
    tabs().closeTab(draft);
    const [group] = state().groups[a.id];
    expect(groupPaneTabs(group)[0][1]).toMatchObject({ kind: "query", sql: "" });
    expect(state().closedTabs[a.id][draft]).toMatchObject({ kind: "query", sql: "SELECT 8" });

    state().openGroup(id);
    expect(tabs().tabs.find((tab) => tabKey(tab) === draft)).toMatchObject({ sql: "SELECT 8" });
    expect(state().closedTabs[a.id]).toEqual({});
    expect(storage.get("l8db.split-view")).not.toContain("SELECT 8");
  });

  test("hält die Obergrenze ein und verdrängt nur unbenannte, nicht aktive Ansichten", () => {
    const a = connect();
    const [users, orders] = open("users", "orders");
    state().split({ activeKey: users, key: orders, edge: "right" });
    const active = state().activeGroup ?? "";
    const named = (index: number): SplitGroup => ({
      id: `g${index}`,
      name: `Fest ${index}`,
      tabs: [{ kind: "table", schema: "public", table: "users" }],
      masters: [null],
      orientation: "horizontal",
      focusedPane: 0,
    });
    const [live] = state().groups[a.id];
    const full = [live, ...Array.from({ length: MAX_SPLIT_GROUPS - 1 }, (_, i) => named(i))];
    useSplitView.setState({ groups: { [a.id]: full } });
    expect(state().saveTabs(null)).toBeNull();
    expect(state().groups[a.id]).toHaveLength(MAX_SPLIT_GROUPS);

    const stale = { ...named(99), id: "stale", name: "Ansicht 7" };
    useSplitView.setState({ groups: { [a.id]: [...full.slice(0, -1), stale] } });
    const [items] = openDetached(() => open("items"));
    const id = state().saveTabs(items);
    const ids = state().groups[a.id].map((group) => group.id);
    expect(ids).toHaveLength(MAX_SPLIT_GROUPS);
    expect(ids).toContain(id ?? "");
    expect(ids).toContain(active);
    expect(ids).not.toContain("stale");
  });
});

describe("Gruppen in einer anderen Verbindung öffnen", () => {
  function sharedSplit() {
    const a = connect("a");
    const [users, orders, items] = open("users", "orders", "items");
    const draft = query("SELECT * FROM orders", "Bestellungen prüfen");
    state().split({ activeKey: users, key: orders, edge: "right" });
    state().moveTab(items, 0);
    state().moveTab(draft, 1);
    state().setOrientation("vertical");
    const id = state().activeGroup ?? "";
    state().renameGroup(id, "Bestellungen");
    state().setGroupShared(id, true);
    const b = addConnection("b");
    useConnectionsStore.getState().setActiveId(b.id);
    return { a, b, users, orders, items, draft, id };
  }

  test("übernimmt Tabellen und Abfragen in die aktive Verbindung", () => {
    const { a, b, users, orders, items, draft, id } = sharedSplit();
    const { connections } = useConnectionsStore.getState();
    expect(foreignSplitGroups(state().groups, b.id, connections).map((e) => e.group.id)).toEqual([
      id,
    ]);
    expect(openKeys()).toEqual([]);

    const copyId = state().adoptGroup(id, a.id) ?? "";
    expect(copyId).not.toBe(id);
    const [copy] = state().groups[b.id];
    expect(copy).toMatchObject({ id: copyId, name: "Bestellungen", origin: id });
    expect(copy.shared).toBeUndefined();
    expect(copy.orientation).toBe("vertical");
    const [left, right] = groupPaneTabs(copy);
    expect(left.map(tabKey)).toEqual([users, items]);
    expect(tabKey(right[0])).toBe(orders);
    expect(right[0].connectionId).toBeUndefined();
    expect(right[1]).toMatchObject({ kind: "query", title: "Bestellungen prüfen", sql: "" });
    expect(tabKey(right[1])).not.toBe(draft);
    expect(state().closedTabs[b.id][tabKey(right[1])]).toMatchObject({
      sql: "SELECT * FROM orders",
    });

    const focused = state().openGroup(copyId);
    expect(focused).not.toBeNull();
    expect(state().paneTabs).toEqual([
      [users, items],
      [orders, tabKey(right[1])],
    ]);
    expect(state().orientation).toBe("vertical");
    expect(state().activeGroup).toBe(copyId);
    expect(tabs().tabs.find((tab) => tab.kind === "query")).toMatchObject({
      sql: "SELECT * FROM orders",
    });
    expect(state().closedTabs[b.id]).toEqual({});
    expect(tabs().tabsByConnection[a.id].map(tabKey)).toEqual([users, orders, items, draft]);
    expect(state().groups[a.id][0]).toMatchObject({ id, shared: true });
    expect(keysOf(state().groups[a.id][0])).toEqual([
      [users, items],
      [orders, draft],
    ]);
  });

  test("legt nur eine Kopie an und blendet die Quelle aus, bis die Kopie gelöscht ist", () => {
    const { a, b, id } = sharedSplit();
    const { connections } = useConnectionsStore.getState();
    const copyId = state().adoptGroup(id, a.id) ?? "";
    expect(state().adoptGroup(id, a.id)).toBe(copyId);
    expect(state().groups[b.id]).toHaveLength(1);
    expect(foreignSplitGroups(state().groups, b.id, connections)).toEqual([]);

    expect(Object.keys(state().closedTabs[b.id])).toHaveLength(1);
    state().deleteGroup(copyId);
    expect(state().closedTabs[b.id]).toEqual({});
    state().openGroup(state().adoptGroup(id, a.id) ?? "");
    state().deleteGroup(state().activeGroup ?? "");
    expect(state().panes).toEqual([]);
    expect(foreignSplitGroups(state().groups, b.id, connections).map((e) => e.group.id)).toEqual([
      id,
    ]);
    expect(state().groups[a.id]).toHaveLength(1);
  });

  test("die Kopie folgt nur der eigenen Verbindung", () => {
    const { a, b, users, id } = sharedSplit();
    const copyId = state().adoptGroup(id, a.id) ?? "";
    state().openGroup(copyId);
    const before = JSON.stringify(state().groups[a.id]);
    state().detach(users);
    tabs().closeTab(users);
    expect(keysOf(state().groups[b.id][0])[0]).not.toContain(users);
    expect(JSON.stringify(state().groups[a.id])).toBe(before);

    useConnectionsStore.getState().setActiveId(a.id);
    expect(state().activeGroup).toBe(id);
    expect(openKeys()).toContain(users);
    useConnectionsStore.getState().setActiveId(b.id);
    expect(state().activeGroup).toBe(copyId);
  });

  test("überträgt Bereiche fremder Verbindungen, eigene werden lokal, OID-Tabs entfallen", () => {
    const a = connect("a");
    const b = addConnection("b");
    const c = addConnection("c");
    const [users] = open("users");
    const draft = query("SELECT 1", "Eins");
    const fn: Tab = { kind: "function", schema: "public", name: "f", oid: "42" };
    const remoteB: Tab = { kind: "table", schema: "public", table: "audit", connectionId: b.id };
    const remoteC: Tab = { kind: "table", schema: "public", table: "audit", connectionId: c.id };
    const source: SplitGroup = {
      id: "source",
      name: "Vergleich",
      tabs: [{ kind: "table", schema: "public", table: "users" }, remoteB, remoteC, fn],
      paneTabs: [
        [
          { kind: "table", schema: "public", table: "users" },
          { kind: "query", id: draft.slice("query:".length), title: "Eins", sql: "" },
        ],
        [remoteB],
        [remoteC],
        [fn],
      ],
      masters: [null, 0, 0, 0],
      orientation: "horizontal",
      focusedPane: 0,
      shared: true,
    };
    useSplitView.setState({
      groups: { [a.id]: [source] },
      paneConnections: { [`${a.id}|${draft}`]: c.id, [`${a.id}|${users}`]: b.id },
    });
    useConnectionsStore.getState().setActiveId(b.id);

    const copyId = state().adoptGroup("source", a.id) ?? "";
    const [copy] = state().groups[b.id];
    const lists = groupPaneTabs(copy);
    expect(lists[0][0]).toEqual({ kind: "table", schema: "public", table: "users" } as Tab);
    expect(state().closedTabs[b.id][tabKey(lists[0][1])]).toMatchObject({ sql: "SELECT 1" });
    expect(lists[1]).toEqual([{ kind: "table", schema: "public", table: "audit" } as Tab]);
    expect(lists[2]).toEqual([remoteC]);
    expect(lists[3]).toEqual([]);
    expect(copy.tabs[3]).toBeNull();
    expect(state().paneConnections[`${b.id}|${tabKey(lists[0][1])}`]).toBe(c.id);
    expect(state().paneConnections[`${b.id}|${users}`]).toBeUndefined();

    state().openGroup(copyId);
    expect(state().panes.slice(0, 3)).toEqual([users, table("audit"), tabKey(remoteC)]);
    expect(openKeys()).toContain(table("audit"));
    expect(openKeys()).not.toContain(tabKey(remoteC));
  });

  test("übernimmt gespeicherte Tab-Leisten und meldet nicht Übertragbares", () => {
    const a = connect("a");
    const [users, orders] = open("users", "orders");
    const id = state().saveTabs(orders) ?? "";
    state().setGroupShared(id, true);
    const onlyFunction: SplitGroup = {
      id: "fn",
      name: "Funktion",
      tabs: [{ kind: "function", schema: "public", name: "f", oid: "1" }],
      masters: [null],
      orientation: "horizontal",
      focusedPane: 0,
      shared: true,
    };
    useSplitView.setState({ groups: { [a.id]: [...state().groups[a.id], onlyFunction] } });
    const b = addConnection("b");
    useConnectionsStore.getState().setActiveId(b.id);

    expect(state().adoptGroup("fn", a.id)).toBeNull();
    expect(state().adoptGroup("fehlt", a.id)).toBeNull();
    const copyId = state().adoptGroup(id, a.id) ?? "";
    const [copy] = state().groups[b.id];
    expect(isTabSet(copy)).toBe(true);
    const focused = state().openGroup(copyId);
    expect(focused && tabKey(focused)).toBe(orders);
    expect(openKeys()).toEqual([users, orders]);
    expect(state().panes).toEqual([]);

    useConnectionsStore.getState().setActiveId(a.id);
    expect(state().adoptGroup(id, a.id)).toBe(id);
    expect(state().groups[a.id]).toHaveLength(2);
  });

  test("Kopie und Quelle überstehen einen Neustart", async () => {
    const { a, b, id } = sharedSplit();
    const copyId = state().adoptGroup(id, a.id) ?? "";
    const expected = JSON.stringify(state().groups);
    await restart();
    expect(JSON.stringify(state().groups)).toBe(expected);
    expect(state().groups[b.id][0].origin).toBe(id);
    expect(state().adoptGroup(id, a.id)).toBe(copyId);
  });
});

describe("Randfälle", () => {
  test("erneutes Teilen derselben Tabs überschreibt keine Gruppe mit mehr Tabs", () => {
    const a = connect();
    const [users, orders, items] = open("users", "orders", "items");
    state().split({ activeKey: users, key: orders, edge: "right" });
    state().moveTab(items, 0, 0);
    const [first, second] = state().panes;
    state().collapse();
    state().split({ activeKey: first ?? "", key: second ?? "", edge: "right" });
    const groups = state().groups[a.id];
    expect(groups).toHaveLength(2);
    expect(keysOf(groups[0])).toEqual([[items, users], [orders]]);
    expect(keysOf(groups[1])).toEqual([[first ?? ""], [second ?? ""]]);

    state().collapse();
    state().split({ activeKey: first ?? "", key: second ?? "", edge: "right" });
    expect(state().groups[a.id]).toHaveLength(2);
    expect(state().activeGroup).toBe(groups[1].id);
  });

  test("geschlossene Werkzeug-Tabs kommen mit ihrem letzten Stand zurück", () => {
    const a = connect();
    const [users] = open("users");
    tabs().openToolTab("compare", "c1");
    const id = state().saveTabs(users) ?? "";
    tabs().setToolTabTitle("compare", "c1", "Kunden gegen Staging");
    tabs().closeTab("tool:compare:c1");
    expect(state().closedTabs[a.id]["tool:compare:c1"]).toMatchObject({
      title: "Kunden gegen Staging",
    });

    state().openGroup(id);
    expect(tabs().tabs.find((tab) => tabKey(tab) === "tool:compare:c1")).toMatchObject({
      title: "Kunden gegen Staging",
    });
    expect(state().closedTabs[a.id]).toEqual({});
  });

  test("Workbench-Tabs aus alten Gruppen werden nicht wieder geöffnet", () => {
    const a = connect();
    const workbench: Tab = { kind: "tool", tool: "workbench" };
    const source: SplitGroup = {
      id: "alt",
      name: "Alt",
      tabs: [
        { kind: "table", schema: "public", table: "users" },
        { kind: "table", schema: "public", table: "orders" },
      ],
      paneTabs: [
        [{ kind: "table", schema: "public", table: "users" }, workbench],
        [{ kind: "table", schema: "public", table: "orders" }],
      ],
      masters: [null, 0],
      orientation: "horizontal",
      focusedPane: 0,
    };
    useSplitView.setState({ groups: { [a.id]: [source] } });
    state().openGroup("alt");
    expect(openKeys()).toEqual([table("users"), table("orders")]);
    expect(state().panes).toEqual([table("users"), table("orders")]);
  });

  test("im laufenden Split geschlossene Abfragen hinterlassen keine Kopie", () => {
    const a = connect();
    const [users, orders] = open("users", "orders");
    const draft = query("SELECT 1", "Eins");
    state().split({ activeKey: users, key: orders, edge: "right" });
    state().moveTab(draft, 1);
    tabs().closeTab(draft);
    expect(keysOf(state().groups[a.id][0])).toEqual([[users], [orders]]);
    expect(state().closedTabs[a.id] ?? {}).toEqual({});
  });

  test("Überschreiben und Löschen räumen nicht mehr gebrauchte Kopien ab", () => {
    const a = connect();
    const [users] = open("users");
    const draft = query("SELECT 1", "Eins");
    const id = state().saveTabs(users) ?? "";
    const other = state().saveTabs(users) ?? "";
    tabs().closeTab(draft);
    expect(Object.keys(state().closedTabs[a.id])).toEqual([draft]);

    state().saveTabs(users, id);
    expect(Object.keys(state().closedTabs[a.id])).toEqual([draft]);
    state().saveTabs(users, other);
    expect(state().closedTabs[a.id]).toEqual({});
  });

  test("Kopien starten nicht von selbst und leere Entwürfe überschreiben kein SQL", () => {
    const a = connect();
    const [users] = open("users");
    const run = `query:${tabs().openQueryTabWithSql("DELETE FROM users", "Löschen")}`;
    useTableTabs.setState({
      tabs: tabs().tabs.map((tab) => (tabKey(tab) === run ? { ...tab, autoRun: true } : tab)),
    });
    const empty = query("", "Leer");
    state().saveTabs(users);
    useSplitView.setState({
      closedTabs: {
        [a.id]: { [empty]: { kind: "query", id: empty.slice(6), title: "Leer", sql: "SELECT 9" } },
      },
    });
    tabs().closeTab(run);
    tabs().closeTab(empty);
    expect(state().closedTabs[a.id][run]).toMatchObject({ sql: "DELETE FROM users" });
    expect((state().closedTabs[a.id][run] as { autoRun?: boolean }).autoRun).toBe(false);
    expect(state().closedTabs[a.id][empty]).toMatchObject({ sql: "SELECT 9" });
  });

  test("gleichnamige Tabellen beider Verbindungen bleiben nach der Übernahme ein Vergleich", () => {
    const a = connect("a");
    const b = addConnection("b");
    open("users");
    const local: Tab = { kind: "table", schema: "public", table: "users" };
    const source: SplitGroup = {
      id: "vergleich",
      name: "Vergleich",
      tabs: [local, { ...local, connectionId: b.id }],
      masters: [null, 0],
      orientation: "horizontal",
      focusedPane: 0,
      shared: true,
    };
    useSplitView.setState({
      groups: { [a.id]: [source] },
      paneConnections: { [`${a.id}|${table("users")}`]: b.id },
    });
    useConnectionsStore.getState().setActiveId(b.id);

    const copyId = state().adoptGroup("vergleich", a.id) ?? "";
    const [copy] = state().groups[b.id];
    expect(copy.tabs).toEqual([{ ...local, connectionId: a.id }, local]);
    expect(state().paneConnections[`${b.id}|${table("users")}`]).toBeUndefined();

    state().openGroup(copyId);
    expect(state().panes).toEqual([tabKey({ ...local, connectionId: a.id }), table("users")]);
    expect(openKeys()).toEqual([table("users")]);
  });
});
