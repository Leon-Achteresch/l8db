import { beforeEach, expect, mock, test } from "bun:test";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { localStorage: globalThis.localStorage },
});
const calls: { command: string; args: Record<string, unknown> }[] = [];
mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown> = {}) => {
    if (command === "list_providers") return [];
    calls.push({ command, args });
    if (command === "begin_transaction") return "tx-1";
    if (command === "execute_query" || command === "execute_in_transaction")
      return { columns: [], rows: [], rows_affected: 1, execution_time_ms: 1 };
    return true;
  },
}));
const { useSettingsStore } = await import("../../src/lib/settings");
const { useConnectionsStore } = await import("../../src/lib/connections");
const { useTransactionStore } = await import("../../src/lib/transactions");
const { useTasksStore } = await import("../../src/lib/tasks");
const { executeQuery } = await import("../../src/lib/db");
const { runSqlScript } = await import("../../src/lib/script-runner");
const connection = {
  id: "ms",
  name: "MS",
  kind: "mssql" as const,
  connectionString: "sqlserver://localhost/ms",
  sslMode: "disable" as const,
};

beforeEach(() => {
  calls.length = 0;
  useSettingsStore.getState().resetToDefaults();
  useConnectionsStore.setState({ connections: [connection], activeId: connection.id });
  useTransactionStore.setState({
    transactions: [],
    busyTransactions: {},
    finalizingTransactions: [],
  });
  useTasksStore.setState({ tasks: [] });
});

test("autocommit statements share one session per script run", async () => {
  const sql =
    "SET IDENTITY_INSERT dbo.t ON; INSERT INTO dbo.t (id) VALUES (1); SET IDENTITY_INSERT dbo.t OFF;";
  await runSqlScript({ connection, database: "ms", sql, mode: "autocommit" });
  const first = calls
    .filter((call) => call.command === "execute_query")
    .map((call) => call.args.session);
  expect(first).toHaveLength(3);
  expect(typeof first[0]).toBe("string");
  expect(new Set(first).size).toBe(1);
  calls.length = 0;
  await runSqlScript({ connection, database: "ms", sql, mode: "autocommit" });
  const second = calls
    .filter((call) => call.command === "execute_query")
    .map((call) => call.args.session);
  expect(new Set(second).size).toBe(1);
  expect(second[0]).not.toBe(first[0]);
});

test("single queries do not pin a session", async () => {
  await executeQuery("mssql", connection.connectionString, "SELECT 1", "ms");
  expect(calls.find((call) => call.command === "execute_query")?.args.session).toBeUndefined();
});
