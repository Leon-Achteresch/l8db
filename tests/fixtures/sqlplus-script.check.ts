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
const files: Record<string, string> = {
  "/proj/a.sql": "INSERT INTO t VALUES (1);\n@@b\n",
  "/proj/b.sql": "BEGIN NULL; END;\n/\n",
  "/sqlpath/c.sql": "SELECT 3 FROM dual;",
};
mock.module("@tauri-apps/plugin-fs", () => ({
  readFile: async (path: string) => {
    if (!(path in files)) throw new Error(`not found: ${path}`);
    return new TextEncoder().encode(files[path]);
  },
}));
const calls: { command: string; args: Record<string, unknown> }[] = [];
const failing = new Set<string>();
mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown> = {}) => {
    if (command === "list_providers") return [];
    if (command === "sql_search_path") return ["/sqlpath"];
    calls.push({ command, args });
    if (command === "execute_query" && failing.has(String(args.sql)))
      throw new Error("ORA-00942: table or view does not exist");
    if (command === "execute_query")
      return { columns: [], rows: [], rows_affected: 1, execution_time_ms: 1 };
    return true;
  },
}));
const { useSettingsStore } = await import("../../src/lib/settings");
const { useConnectionsStore } = await import("../../src/lib/connections");
const { useTransactionStore } = await import("../../src/lib/transactions");
const { useTasksStore } = await import("../../src/lib/tasks");
const { runSqlScript } = await import("../../src/lib/script-runner");
const connection = {
  id: "ora",
  name: "ORA",
  kind: "oracle" as const,
  connectionString: "oracle://localhost/ora",
  sslMode: "disable" as const,
};
const executed = () =>
  calls.filter((call) => call.command === "execute_query").map((call) => String(call.args.sql));

beforeEach(() => {
  calls.length = 0;
  failing.clear();
  useSettingsStore.getState().resetToDefaults();
  useConnectionsStore.setState({ connections: [connection], activeId: connection.id });
  useTransactionStore.setState({
    transactions: [],
    busyTransactions: {},
    finalizingTransactions: [],
  });
  useTasksStore.setState({ tasks: [] });
});

test("@ and @@ include files beside the script and from SQLPATH", async () => {
  const sql = "@a\n@c.sql\nSELECT 9 FROM dual;";
  const outcome = await runSqlScript({
    connection,
    database: null,
    sql,
    mode: "autocommit",
    filePath: "/proj/main.sql",
  });
  expect(outcome.error).toBeNull();
  expect(executed()).toEqual([
    "INSERT INTO t VALUES (1);",
    "BEGIN NULL; END;",
    "SELECT 3 FROM dual;",
    "SELECT 9 FROM dual;",
  ]);
  expect(
    outcome.entries.map((entry) => [entry.source ?? null, sql.slice(entry.start, entry.end)]),
  ).toEqual([
    ["/proj/a.sql", "@a"],
    ["/proj/b.sql", "@a"],
    ["/sqlpath/c.sql", "@c.sql"],
    [null, "SELECT 9 FROM dual;"],
  ]);
});

test("a missing include stops the script before later statements and never reaches the server", async () => {
  const outcome = await runSqlScript({
    connection,
    database: null,
    sql: "SELECT 1 FROM dual;\n@missing\nSELECT 2 FROM dual;",
    mode: "autocommit",
  });
  expect(executed()).toEqual(["SELECT 1 FROM dual;"]);
  expect(outcome.entries.map((entry) => entry.status)).toEqual(["success", "error", "skipped"]);
  expect(outcome.error).toContain("Datei nicht gefunden: missing");
  expect(executed().some((sql) => sql.includes("@"))).toBe(false);
});
