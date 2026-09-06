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
  addWorkspace,
  createWorkspaceSnapshot,
  deleteWorkspace,
  renameWorkspace,
  restoreWorkspaceSnapshot,
  useWorkspacesStore,
  workspacesFor,
} = await import("../src/lib/workspaces");

type Tab = Parameters<typeof tabKey>[0];

await useConnectionsStore.persist.rehydrate();
await useWorkspacesStore.persist.rehydrate();

const ordersTab: Tab = { kind: "table", schema: "public", table: "orders", entityType: "table" };
const customersTab: Tab = {
  kind: "table",
  schema: "public",
  table: "customers",
  entityType: "table",
};
const queryTab: Tab = { kind: "query", id: "q1", title: "Query 1", sql: "select 1" };
const dirtyTab: Tab = {
  kind: "query",
  id: "q2",
  title: "report.sql",
  sql: "select 2",
  filePath: "/tmp/report.sql",
  savedSql: "select 1",
};

function reset() {
  storage.clear();
  useConnectionsStore.setState({ connections: [], activeId: null });
  useTableTabs.setState({ tabs: [], tabsByConnection: {}, queryCounter: 0 });
  useWorkspacesStore.setState({ byConnection: {} });
}

beforeEach(reset);

describe("createWorkspaceSnapshot", () => {
  test("erfasst Tabs, SQL-Text, Panes und aktiven Tab", () => {
    const snapshot = createWorkspaceSnapshot({
      tabs: [ordersTab, queryTab],
      panes: ["table:public.orders", "query:q1"],
      focusedPane: 1,
      activeTabKey: "query:q1",
    });
    expect(snapshot.tabs).toHaveLength(2);
    expect(snapshot.tabs[1]).toMatchObject({ kind: "query", sql: "select 1" });
    expect(snapshot.panes).toEqual(["table:public.orders", "query:q1"]);
    expect(snapshot.focusedPane).toBe(1);
    expect(snapshot.activeTabKey).toBe("query:q1");
  });

  test("verwaiste Panes und aktive Tabs werden bereinigt", () => {
    const snapshot = createWorkspaceSnapshot({
      tabs: [ordersTab],
      panes: ["table:public.orders", "query:gone"],
      focusedPane: 9,
      activeTabKey: "query:gone",
    });
    expect(snapshot.panes).toEqual(["table:public.orders", null]);
    expect(snapshot.focusedPane).toBe(0);
    expect(snapshot.activeTabKey).toBeNull();
  });

  test("Snapshot-Tabs sind Kopien und verlieren flüchtige Dateizustände", () => {
    const snapshot = createWorkspaceSnapshot({
      tabs: [{ ...dirtyTab, externalChange: true } as Tab],
      panes: [],
      focusedPane: 0,
      activeTabKey: null,
    });
    expect(snapshot.tabs[0]).not.toBe(dirtyTab);
    expect(snapshot.tabs[0]).toMatchObject({ externalChange: false, sql: "select 2" });
  });
});

describe("restoreWorkspaceSnapshot", () => {
  const saved = createWorkspaceSnapshot({
    tabs: [customersTab, queryTab],
    panes: ["table:public.customers", "query:q1"],
    focusedPane: 1,
    activeTabKey: "query:q1",
  });

  test("ersetzen übernimmt Tabs, Layout und aktiven Tab", () => {
    const current = createWorkspaceSnapshot({
      tabs: [ordersTab],
      panes: [],
      focusedPane: 0,
      activeTabKey: "table:public.orders",
    });
    const { snapshot, warnings } = restoreWorkspaceSnapshot(current, saved, "replace");
    expect(snapshot.tabs.map(tabKey)).toEqual(["table:public.customers", "query:q1"]);
    expect(snapshot.panes).toEqual(["table:public.customers", "query:q1"]);
    expect(snapshot.activeTabKey).toBe("query:q1");
    expect(warnings).toEqual([]);
  });

  test("ergänzen behält bestehende Tabs und dedupliziert", () => {
    const current = createWorkspaceSnapshot({
      tabs: [ordersTab, queryTab],
      panes: [],
      focusedPane: 0,
      activeTabKey: "table:public.orders",
    });
    const { snapshot } = restoreWorkspaceSnapshot(current, saved, "merge");
    expect(snapshot.tabs.map(tabKey)).toEqual([
      "table:public.orders",
      "query:q1",
      "table:public.customers",
    ]);
    expect(snapshot.activeTabKey).toBe("table:public.orders");
  });

  test("ungespeicherte Dateiänderungen werden beim Ersetzen gemeldet", () => {
    const current = createWorkspaceSnapshot({
      tabs: [dirtyTab],
      panes: [],
      focusedPane: 0,
      activeTabKey: "query:q2",
    });
    const { warnings } = restoreWorkspaceSnapshot(current, saved, "replace");
    expect(warnings.some((entry) => entry.includes("report.sql"))).toBe(true);
  });

  test("fehlende Objekte werden übersprungen und gemeldet", () => {
    const current = createWorkspaceSnapshot({
      tabs: [],
      panes: [],
      focusedPane: 0,
      activeTabKey: null,
    });
    const { snapshot, warnings } = restoreWorkspaceSnapshot(current, saved, "replace", [
      "public.orders",
    ]);
    expect(snapshot.tabs.map(tabKey)).toEqual(["query:q1"]);
    expect(warnings.some((entry) => entry.includes("public.customers"))).toBe(true);
    expect(snapshot.panes).toEqual([null, "query:q1"]);
  });

  test("leerer Stand wird gemeldet", () => {
    const empty = createWorkspaceSnapshot({
      tabs: [],
      panes: [],
      focusedPane: 0,
      activeTabKey: null,
    });
    const { warnings } = restoreWorkspaceSnapshot(empty, empty, "replace");
    expect(warnings).toHaveLength(1);
  });
});

describe("Workspace-Liste", () => {
  const snapshot = createWorkspaceSnapshot({
    tabs: [ordersTab],
    panes: [],
    focusedPane: 0,
    activeTabKey: "table:public.orders",
  });

  test("anlegen, umbenennen und löschen", () => {
    let list = addWorkspace([], "Analyse", snapshot, { id: "a", now: 1 });
    expect(list).toHaveLength(1);
    list = addWorkspace(list, "  ", snapshot, { id: "b", now: 2 });
    expect(list).toHaveLength(1);
    list = addWorkspace(list, "analyse", snapshot, { id: "c", now: 5 });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "a", name: "analyse", updatedAt: 5 });
    list = addWorkspace(list, "Zweitens", snapshot, { id: "d", now: 6 });
    list = renameWorkspace(list, "d", "Drittens", 7);
    expect(list[1]).toMatchObject({ name: "Drittens", updatedAt: 7 });
    list = renameWorkspace(list, "d", "analyse", 8);
    expect(list[1].name).toBe("Drittens");
    list = deleteWorkspace(list, "a");
    expect(list.map((entry) => entry.id)).toEqual(["d"]);
  });

  test("Stände werden pro Verbindung gehalten", () => {
    const first = useConnectionsStore.getState().addConnection({
      name: "A",
      kind: "postgres",
      connectionString: "postgresql://localhost:5432/a",
      sslMode: "prefer",
    });
    useWorkspacesStore.getState().saveWorkspace("Erster", snapshot);
    const second = useConnectionsStore.getState().addConnection({
      name: "B",
      kind: "postgres",
      connectionString: "postgresql://localhost:5432/b",
      sslMode: "prefer",
    });
    useConnectionsStore.setState({ activeId: second });
    expect(workspacesFor(useWorkspacesStore.getState().byConnection, second)).toHaveLength(0);
    useWorkspacesStore.getState().saveWorkspace("Zweiter", snapshot);
    expect(workspacesFor(useWorkspacesStore.getState().byConnection, first)).toHaveLength(1);
    expect(workspacesFor(useWorkspacesStore.getState().byConnection, second)[0].name).toBe(
      "Zweiter",
    );
  });
});
