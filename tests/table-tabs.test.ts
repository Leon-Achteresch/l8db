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
