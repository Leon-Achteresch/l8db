import { beforeEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SavedConnection } from "../src/lib/connections";

const invoked: string[] = [];
mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string) => {
    invoked.push(command);
    return null;
  },
}));
const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
  configurable: true,
});
Object.defineProperty(globalThis, "window", {
  value: { localStorage: globalThis.localStorage, addEventListener() {}, removeEventListener() {} },
  configurable: true,
});

const detailRows = [
  { id: 1, name: "a", __ctid__: "(0,1)@1@1" },
  { id: 2, name: "b", __ctid__: "(0,2)@1@1" },
];
mock.module("../src/lib/hooks/use-master-detail-query", () => ({
  useMasterDetailQuery: () => ({
    query: {
      data: { columns: ["id", "name"], rows: detailRows },
      isPending: false,
      isFetching: false,
      error: null,
      refetch: async () => undefined,
    },
    queryKey: ["detail"],
    selection: { rowIndex: 0 },
    supported: true,
    waiting: false,
    error: null,
    table: { schema: "public", table: "orders" },
  }),
}));
const writes: string[] = [];
const realQueries = await import("../src/lib/queries");
mock.module("../src/lib/queries", () => ({
  ...realQueries,
  useUpdateRowMutation: () => ({
    mutateAsync: async () => {
      writes.push("update");
      return { newCtid: "(0,9)@1@1" };
    },
  }),
  useDeleteRowMutation: () => ({
    mutateAsync: async () => {
      writes.push("delete");
    },
  }),
  useDetailedColumnsQuery: () => ({ data: undefined }),
}));
type GridProps = {
  data: Record<string, unknown>[];
  onSaveRow?: (
    ctid: string,
    updates: Record<string, string | null>,
    old: Record<string, unknown>,
  ) => Promise<unknown>;
  onDeleteRow?: (ctid: string, old: Record<string, unknown>) => Promise<unknown>;
};
let grid: GridProps | null = null;
mock.module("../src/features/table/data-table", () => ({
  DataTable: (props: GridProps) => {
    grid = props;
    return null;
  },
}));

const { POSTGRES_CAPABILITIES, useProvidersStore } = await import("../src/lib/providers");
const { useSettingsStore } = await import("../src/lib/settings");
const { useConnectionsStore } = await import("../src/lib/connections/store");
const { useTransactionStore } = await import("../src/lib/transactions");
const staged = await import("../src/lib/staged-edits");
const { MasterDetailResult } = await import("../src/features/shell/master-detail-result");

const prod: SavedConnection = {
  id: "prod",
  name: "Prod",
  kind: "postgres",
  connectionString: "postgres://prod/app",
  sslMode: "disable",
  environment: "production",
};
const key = staged.stagedTableKey({
  connectionId: "prod",
  database: "app",
  schema: "public",
  table: "orders",
});

function render(): GridProps {
  grid = null;
  Object.assign(useConnectionsStore.getInitialState(), useConnectionsStore.getState());
  Object.assign(staged.useStagedEdits.getInitialState(), staged.useStagedEdits.getState());
  renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(MasterDetailResult, { source: "master", sql: "select 1" }),
    ),
  );
  if (!grid) throw new Error("grid not rendered");
  return grid;
}

beforeEach(() => {
  writes.length = 0;
  staged.useStagedEdits.setState({ tables: {}, committing: [] });
  useTransactionStore.setState({
    transactions: [],
    busyTransactions: {},
    finalizingTransactions: [],
  });
  useConnectionsStore.setState({ connections: [prod], activeId: "prod" });
  useSettingsStore.setState({ collectCellEdits: "production" });
  useProvidersStore.setState({
    loaded: true,
    providers: [
      {
        id: "postgres",
        name: "postgres",
        group: "test",
        kind: "postgres",
        default_port: null,
        file_based: false,
        url_schemes: ["postgres"],
        placeholder: "",
        hint: "",
        hosts: [],
        driver: { type: "builtin" },
        driver_status: { available: true, detail: "", install: [], install_command: null },
        capabilities: POSTGRES_CAPABILITIES,
      },
    ],
  });
});

test("master-detail edits and deletes on production are collected, not written", async () => {
  const first = render();
  expect(await first.onSaveRow?.("(0,1)@1@1", { id: "1", name: "changed" }, detailRows[0])).toBe(
    "collected",
  );
  await first.onDeleteRow?.("(0,2)@1@1", detailRows[1]);
  expect(writes).toEqual([]);
  expect(staged.useStagedEdits.getState().tables[key]?.changes.map((c) => c.type)).toEqual([
    "update",
    "delete",
  ]);
  const shown = render().data;
  expect(shown.find((row) => row.id === 1)?.name).toBe("changed");
  expect(shown.map((row) => staged.stagedMarkOf(row)?.type)).toEqual(["update", "delete"]);
});

test("master-detail edits write directly when collecting is off", async () => {
  useSettingsStore.setState({ collectCellEdits: "off" });
  expect(await render().onSaveRow?.("(0,1)@1@1", { id: "1", name: "changed" }, detailRows[0])).toBe(
    "staged",
  );
  expect(writes).toEqual(["update"]);
  expect(staged.useStagedEdits.getState().tables[key]).toBeUndefined();
});
