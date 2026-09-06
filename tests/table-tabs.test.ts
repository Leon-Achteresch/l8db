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
const { useTableTabs } = await import("../src/lib/table-tabs");

await useConnectionsStore.persist.rehydrate();
await useTableTabs.persist.rehydrate();

function addConnection(name: string) {
  return useConnectionsStore.getState().addConnection({
    name,
    kind: "postgres",
    connectionString: "postgresql://localhost:5432/db",
    sslMode: "prefer",
  });
}

beforeEach(() => {
  storage.clear();
  useConnectionsStore.setState({ connections: [], activeId: null });
  useTableTabs.setState({ tabs: [], tabsByConnection: {}, queryCounter: 0 });
});

describe("tabs per connection", () => {
  test("neue Connection zeigt keine Tabs der alten, Wechsel zurück stellt wieder her", () => {
    const a = addConnection("a");
    const b = addConnection("b");
    useConnectionsStore.getState().setActiveId(a.id);
    useTableTabs.getState().openTab({ schema: "public", table: "users" });
    const queryId = useTableTabs.getState().openQueryTab();
    expect(useTableTabs.getState().tabs).toHaveLength(2);

    useConnectionsStore.getState().setActiveId(b.id);
    expect(useTableTabs.getState().tabs).toHaveLength(0);

    useTableTabs.getState().openTab({ schema: "public", table: "orders" });
    expect(useTableTabs.getState().tabs).toHaveLength(1);

    useConnectionsStore.getState().setActiveId(a.id);
    const tabs = useTableTabs.getState().tabs;
    expect(tabs).toHaveLength(2);
    expect(tabs.some((t) => t.kind === "table" && t.table === "users")).toBe(true);
    expect(tabs.some((t) => t.kind === "query" && t.id === queryId)).toBe(true);
  });

  test("Trennen blendet Tabs aus, erneutes Verbinden stellt wieder her", () => {
    const a = addConnection("a");
    useConnectionsStore.getState().setActiveId(a.id);
    useTableTabs.getState().openTab({ schema: "public", table: "users" });
    expect(useTableTabs.getState().tabs).toHaveLength(1);

    useConnectionsStore.getState().setActiveId(null);
    expect(useTableTabs.getState().tabs).toHaveLength(0);

    useConnectionsStore.getState().setActiveId(a.id);
    expect(useTableTabs.getState().tabs).toHaveLength(1);
  });

  test("Query-SQL bleibt pro Connection erhalten", () => {
    const a = addConnection("a");
    const b = addConnection("b");
    useConnectionsStore.getState().setActiveId(a.id);
    const queryId = useTableTabs.getState().openQueryTab();
    useTableTabs.getState().updateQuerySql(queryId, "SELECT 1");

    useConnectionsStore.getState().setActiveId(b.id);
    expect(useTableTabs.getState().tabs).toHaveLength(0);

    useConnectionsStore.getState().setActiveId(a.id);
    const tab = useTableTabs.getState().tabs.find((t) => t.kind === "query" && t.id === queryId);
    expect(tab?.kind === "query" ? tab.sql : null).toBe("SELECT 1");
  });

  test("clearTabsForConnection verwirft gespeicherte Tabs", () => {
    const a = addConnection("a");
    const b = addConnection("b");
    useConnectionsStore.getState().setActiveId(a.id);
    useTableTabs.getState().openTab({ schema: "public", table: "users" });

    useConnectionsStore.getState().setActiveId(b.id);
    useTableTabs.getState().clearTabsForConnection(a.id);

    useConnectionsStore.getState().setActiveId(a.id);
    expect(useTableTabs.getState().tabs).toHaveLength(0);
  });
});

const { isQueryTabDirty } = await import("../src/lib/table-tabs");
const { defaultSqlFileName, fileMtimeChanged, sqlFileSizeError, sqlFileTitle } = await import(
  "../src/lib/sql-file"
);

describe("dateigebundene Query-Tabs", () => {
  test("openFileQueryTab erzeugt Tab mit Dateiname und unverändertem Text", () => {
    const a = addConnection("a");
    useConnectionsStore.getState().setActiveId(a.id);
    const id = useTableTabs
      .getState()
      .openFileQueryTab({ path: "/tmp/x/report.sql", sql: "SELECT 1;\n", title: "report.sql", mtime: 100 });
    const tab = useTableTabs.getState().tabs.find((t) => t.kind === "query" && t.id === id);
    expect(tab?.kind === "query" ? tab.title : null).toBe("report.sql");
    expect(tab?.kind === "query" ? tab.sql : null).toBe("SELECT 1;\n");
    expect(tab?.kind === "query" ? isQueryTabDirty(tab) : null).toBe(false);
    const again = useTableTabs
      .getState()
      .openFileQueryTab({ path: "/tmp/x/report.sql", sql: "other", title: "report.sql", mtime: 200 });
    expect(again).toBe(id);
    expect(useTableTabs.getState().tabs).toHaveLength(1);
  });

  test("Änderungsmarkierung verschwindet nach markQueryTabSaved", () => {
    const a = addConnection("a");
    useConnectionsStore.getState().setActiveId(a.id);
    const id = useTableTabs
      .getState()
      .openFileQueryTab({ path: "/tmp/a.sql", sql: "SELECT 1", title: "a.sql", mtime: 1 });
    useTableTabs.getState().updateQuerySql(id, "SELECT 2");
    const find = () => {
      const t = useTableTabs.getState().tabs.find((x) => x.kind === "query" && x.id === id);
      return t?.kind === "query" ? t : null;
    };
    expect(isQueryTabDirty(find()!)).toBe(true);
    useTableTabs.getState().markQueryTabSaved(id, 2);
    expect(isQueryTabDirty(find()!)).toBe(false);
    expect(find()!.fileMtime).toBe(2);
    expect(find()!.sql).toBe("SELECT 2");
  });

  test("neuer Tab ohne Datei ist nie dirty, bindQueryTabFile bindet an Pfad", () => {
    const a = addConnection("a");
    useConnectionsStore.getState().setActiveId(a.id);
    const id = useTableTabs.getState().openQueryTab();
    useTableTabs.getState().updateQuerySql(id, "SELECT 3");
    const find = () => {
      const t = useTableTabs.getState().tabs.find((x) => x.kind === "query" && x.id === id);
      return t?.kind === "query" ? t : null;
    };
    expect(isQueryTabDirty(find()!)).toBe(false);
    useTableTabs.getState().bindQueryTabFile(id, { path: "/tmp/b.sql", title: "b.sql", mtime: 5 });
    expect(find()!.filePath).toBe("/tmp/b.sql");
    expect(find()!.title).toBe("b.sql");
    expect(isQueryTabDirty(find()!)).toBe(false);
    useTableTabs.getState().updateQuerySql(id, "SELECT 4");
    expect(isQueryTabDirty(find()!)).toBe(true);
  });

  test("externe Änderung: Reload ersetzt Text, Behalten lässt lokalen Text unverändert", () => {
    const a = addConnection("a");
    useConnectionsStore.getState().setActiveId(a.id);
    const id = useTableTabs
      .getState()
      .openFileQueryTab({ path: "/tmp/c.sql", sql: "old", title: "c.sql", mtime: 1 });
    useTableTabs.getState().updateQuerySql(id, "local");
    useTableTabs.getState().setQueryTabExternalChange(id, true);
    const find = () => {
      const t = useTableTabs.getState().tabs.find((x) => x.kind === "query" && x.id === id);
      return t?.kind === "query" ? t : null;
    };
    expect(find()!.externalChange).toBe(true);
    expect(find()!.sql).toBe("local");
    useTableTabs.getState().setQueryTabExternalChange(id, false, 9);
    expect(find()!.externalChange).toBe(false);
    expect(find()!.fileMtime).toBe(9);
    expect(find()!.sql).toBe("local");
    expect(isQueryTabDirty(find()!)).toBe(true);
    useTableTabs.getState().reloadQueryTabFromFile(id, "disk", 10);
    expect(find()!.sql).toBe("disk");
    expect(isQueryTabDirty(find()!)).toBe(false);
    expect(find()!.externalChange).toBe(false);
  });

  test("sql-file Helfer", () => {
    expect(sqlFileTitle("/a/b/c.sql")).toBe("c.sql");
    expect(sqlFileTitle("C:\\x\\y.sql")).toBe("y.sql");
    expect(defaultSqlFileName("Query 1")).toBe("Query 1.sql");
    expect(defaultSqlFileName("x.SQL")).toBe("x.SQL");
    expect(sqlFileSizeError(10)).toBeNull();
    expect(sqlFileSizeError(null)).toBeNull();
    expect(sqlFileSizeError(11 * 1024 * 1024)).toContain("zu groß");
    expect(fileMtimeChanged(1, 2)).toBe(true);
    expect(fileMtimeChanged(1, 1)).toBe(false);
    expect(fileMtimeChanged(null, 2)).toBe(false);
    expect(fileMtimeChanged(1, null)).toBe(false);
  });
});
