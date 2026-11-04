import { beforeEach, expect, mock, test } from "bun:test";

const calls: string[] = [];
mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string) => {
    calls.push(command);
    if (command === "list_foreign_keys")
      return [
        {
          constraint_name: "orders_customer_fk",
          from_schema: "public",
          from_table: "orders",
          from_column: "customer_id",
          to_schema: "public",
          to_table: "customers",
          to_column: "id",
        },
      ];
    return [];
  },
}));
const navigated: unknown[] = [];
mock.module("@/router", () => ({
  router: {
    navigate: async (options: unknown) => void navigated.push(options),
    preloadRoute: async () => undefined,
  },
}));

const { useConnectionsStore } = await import("../src/lib/connections");
const { useTableTabs, tabKey } = await import("../src/lib/table-tabs");
const { useSplitView } = await import("../src/lib/split-view");
const { useMasterDetail } = await import("../src/lib/master-detail");
const { useAutoRefreshStore } = await import("../src/lib/auto-refresh");
const { tableViewStateKey, useTableViewStateStore } = await import("../src/lib/table-view-state");
const { applyMcpOpen } = await import("../src/lib/mcp-open");

let connectionId = "";

beforeEach(() => {
  calls.length = 0;
  useConnectionsStore.setState({ connections: [], activeId: null });
  useTableTabs.setState({ tabs: [], tabsByConnection: {}, queryCounter: 0 });
  useSplitView.setState({ panes: [], paneTabs: [], layout: null, masters: [], focusedPane: 0 });
  useMasterDetail.setState({ scripts: {}, sourceColumns: {}, savedScripts: {}, selections: {} });
  useAutoRefreshStore.setState({ intervals: {} });
  const connection = useConnectionsStore.getState().addConnection({
    name: "shop",
    kind: "postgres",
    connectionString: "postgresql://localhost:5432/shop",
    sslMode: "prefer",
  });
  useConnectionsStore.getState().setActiveId(connection.id);
  connectionId = connection.id;
});

test("opens a linked master-detail split with auto-refresh from one AI request", async () => {
  await applyMcpOpen({
    connectionId,
    schema: "public",
    table: "customers",
    autoRefresh: 15,
    split: [
      { schema: "public", table: "orders", filter: "total > 10", master: 0 },
      { sql: "SELECT * FROM public.items WHERE order_id = :master.id", master: 1 },
    ],
    orientation: "vertical",
  });
  const split = useSplitView.getState();
  const customers = tabKey({ kind: "table", schema: "public", table: "customers" });
  const orders = tabKey({ kind: "table", schema: "public", table: "orders" });
  expect(split.panes.length).toBe(3);
  expect(split.orientation).toBe("vertical");
  const [c, o] = [split.panes.indexOf(customers), split.panes.indexOf(orders)];
  const items = split.panes.findIndex((key) => key !== customers && key !== orders);
  expect(split.masters[o]).toBe(c);
  expect(split.masters[items]).toBe(o);
  const scripts = Object.values(useMasterDetail.getState().scripts);
  expect(scripts).toHaveLength(2);
  expect(scripts.some((sql) => sql.includes('"customer_id" = :master.id'))).toBe(true);
  expect(scripts).toContain("SELECT * FROM public.items WHERE order_id = :master.id");
  const key = (table: string) => tableViewStateKey(connectionId, "shop", "public", table) ?? "";
  expect(useAutoRefreshStore.getState().intervals[key("customers")]).toBe(15000);
  expect(useTableViewStateStore.getState().views[key("orders")]?.filter).toBe("total > 10");
  expect(calls.filter((command) => command === "list_foreign_keys")).toHaveLength(1);
});

test("fails loudly when two tables share no foreign key", async () => {
  await expect(
    applyMcpOpen({
      connectionId,
      schema: "public",
      table: "customers",
      split: [{ schema: "public", table: "logs", master: 0 }],
    }),
  ).rejects.toThrow("Keine Fremdschlüssel-Beziehung");
  expect(Object.keys(useMasterDetail.getState().scripts)).toHaveLength(0);
  expect(useSplitView.getState().panes.length).toBe(2);
});

test("auto-refresh 0 turns a running interval off", async () => {
  await applyMcpOpen({ connectionId, schema: "public", table: "customers", autoRefresh: 30 });
  await applyMcpOpen({ connectionId, schema: "public", table: "customers", autoRefresh: 0 });
  expect(useAutoRefreshStore.getState().intervals).toEqual({});
});
