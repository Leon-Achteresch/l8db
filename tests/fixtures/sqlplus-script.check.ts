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
    if (command === "list_table_columns_detailed")
      return args.schema === "SCOTT" && args.table === "EMP"
        ? [
            { name: "EMPNO", data_type: "NUMBER(4,0)", is_nullable: false },
            { name: "ENAME", data_type: "VARCHAR2(10)", is_nullable: true },
          ]
        : [];
    if (command === "execute_query" && String(args.sql).includes("CURRENT_SCHEMA"))
      return { columns: ["S"], rows: [{ S: "SCOTT" }], rows_affected: null, execution_time_ms: 1 };
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

test("substitution variables are asked once per run and && values stay defined for the tab", async () => {
  const { substitutionSession } = await import("../../src/lib/sql-statements/sqlplus");
  const variables = substitutionSession("tab-script");
  const asked: string[][] = [];
  const askVariables = async (names: string[]) => {
    asked.push(names);
    return Object.fromEntries(names.map((name) => [name, name === "TAB" ? "emp" : "7"]));
  };
  const sql =
    "DEFINE col = name\nSELECT &col, '&&tab' -- &ignored\nFROM &tab WHERE id = &id;\nSET DEFINE OFF\nSELECT 'R&D' FROM dual;";
  const run = () =>
    runSqlScript({ connection, database: null, sql, mode: "autocommit", variables, askVariables });
  await run();
  expect(asked).toEqual([["TAB", "ID"]]);
  expect(executed()).toEqual([
    "SELECT name, 'emp' -- &ignored\nFROM emp WHERE id = 7;",
    "SELECT 'R&D' FROM dual;",
  ]);
  variables.state.marker = "&";
  await run();
  expect(asked).toEqual([["TAB", "ID"], ["ID"]]);
  calls.length = 0;
  const cancelled = runSqlScript({
    connection,
    database: null,
    sql: "SELECT &other FROM dual;",
    mode: "autocommit",
    variables: substitutionSession("tab-cancel"),
    askVariables: async () => null,
  });
  await expect(cancelled).rejects.toThrow("abgebrochen");
  expect(executed()).toEqual([]);
});

test("SET SERVEROUTPUT in a script switches the server output setting", async () => {
  const { useProvidersStore, FALLBACK_PROVIDERS } = await import("../../src/lib/providers");
  const { useServerOutputStore } = await import("../../src/lib/server-output");
  const base = FALLBACK_PROVIDERS[0];
  useProvidersStore.setState({
    providers: [
      {
        ...base,
        id: "oracle",
        kind: "oracle",
        capabilities: { ...base.capabilities, server_output: true },
      },
    ],
    loaded: true,
  });
  await runSqlScript({
    connection,
    database: null,
    sql: "SET SERVEROUTPUT ON SIZE UNLIMITED\nBEGIN dbms_output.put_line('x'); END;\n/\nset serverout off",
    mode: "autocommit",
  });
  expect(
    calls.filter((call) => call.command === "set_server_output").map((call) => call.args.enabled),
  ).toEqual([true, false]);
  expect(executed()).toEqual(["BEGIN dbms_output.put_line('x'); END;"]);
  expect(useServerOutputStore.getState().enabled[connection.id]).toBe(false);
  useProvidersStore.setState({ providers: FALLBACK_PROVIDERS, loaded: false });
});

test("WHENEVER SQLERROR switches stop-on-error for the run and EXIT ends it", async () => {
  failing.add("SELECT 1 FROM gone;");
  failing.add("SELECT 2 FROM gone;");
  const outcome = await runSqlScript({
    connection,
    database: null,
    sql: "WHENEVER SQLERROR CONTINUE\nSELECT 1 FROM gone;\nSELECT 1 FROM dual;\nWHENEVER SQLERROR EXIT ROLLBACK\nSELECT 2 FROM gone;\nSELECT 2 FROM dual;",
    mode: "autocommit",
    stopOnError: false,
  });
  expect(outcome.entries.map((entry) => entry.status)).toEqual([
    "success",
    "error",
    "success",
    "success",
    "error",
    "skipped",
  ]);
  calls.length = 0;
  const exited = await runSqlScript({
    connection,
    database: null,
    sql: "SELECT 1 FROM dual;\nEXIT\nSELECT 2 FROM dual;",
    mode: "autocommit",
  });
  expect(executed()).toEqual(["SELECT 1 FROM dual;"]);
  expect(exited.entries.map((entry) => entry.status)).toEqual(["success", "success", "skipped"]);
  expect(exited.error).toBeNull();
});

test("unsupported SQL*Plus commands are listed as ignored, remarks stay silent", async () => {
  const outcome = await runSqlScript({
    connection,
    database: null,
    sql: "REM setup\nSET ECHO ON\nSPOOL out.log\nPROMPT loading\nCOLUMN x FORMAT a10\nSELECT 1 FROM dual;",
    mode: "autocommit",
  });
  expect(outcome.entries.map((entry) => [entry.sql, entry.status])).toEqual([
    ["SET ECHO ON", "ignored"],
    ["SPOOL out.log", "ignored"],
    ["PROMPT loading", "success"],
    ["COLUMN x FORMAT a10", "ignored"],
    ["SELECT 1 FROM dual;", "success"],
  ]);
  expect(executed()).toEqual(["SELECT 1 FROM dual;"]);
});

test("DESC lists columns with nullability and type as a result grid", async () => {
  const outcome = await runSqlScript({
    connection,
    database: null,
    sql: 'DESC emp\nDESCRIBE "SCOTT".EMP\ndesc missing',
    mode: "autocommit",
    stopOnError: false,
  });
  const describe = calls.filter((call) => call.command === "list_table_columns_detailed");
  expect(describe.map((call) => [call.args.schema, call.args.table])).toEqual([
    ["SCOTT", "EMP"],
    ["SCOTT", "EMP"],
    ["SCOTT", "MISSING"],
  ]);
  expect(outcome.entries.map((entry) => entry.status)).toEqual(["success", "success", "error"]);
  expect(outcome.entries[0].result).toMatchObject({
    columns: ["Name", "Null?", "Typ"],
    rows: [
      { Name: "EMPNO", "Null?": "NOT NULL", Typ: "NUMBER(4,0)" },
      { Name: "ENAME", "Null?": "", Typ: "VARCHAR2(10)" },
    ],
  });
  expect(outcome.entries[2].error).toBe("Tabelle oder View nicht gefunden: missing");
  expect(outcome.lastResult?.rows).toHaveLength(2);
});
