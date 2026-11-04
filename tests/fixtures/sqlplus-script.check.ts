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
  stat: async (path: string) => {
    if (!(path in files)) throw new Error(`not found: ${path}`);
    return { size: files[path].length };
  },
  readFile: async (path: string) => {
    if (!(path in files)) throw new Error(`not found: ${path}`);
    return new TextEncoder().encode(files[path]);
  },
  lstat: async (path: string) => {
    if (!(path in files)) throw new Error(`not found: ${path}`);
    return { isFile: true, isSymlink: false, size: files[path].length };
  },
  writeTextFile: async (path: string, text: string, options: { append?: boolean } = {}) => {
    written.push({ path, text, append: options.append === true });
  },
}));
const written: { path: string; text: string; append: boolean }[] = [];
const calls: { command: string; args: Record<string, unknown> }[] = [];
const failing = new Set<string>();
let handle: ((command: string, args: Record<string, unknown>) => unknown) | null = null;
mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown> = {}) => {
    if (command === "list_providers") return [];
    if (command === "sql_search_path") return ["/sqlpath"];
    calls.push({ command, args });
    const handled = handle?.(command, args);
    if (handled !== undefined) {
      if (handled instanceof Error) throw handled;
      return handled;
    }
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
const { useSqlConfirmation, answerSqlConfirmation } = await import(
  "../../src/lib/sql-confirmation"
);
let confirmAnswer = true;
const confirmations: string[] = [];
useSqlConfirmation.subscribe((state) => {
  for (const request of state.requests) {
    confirmations.push(request.title ?? request.statements.map((item) => item.sql).join(", "));
    queueMicrotask(() => answerSqlConfirmation(request.id, confirmAnswer));
  }
});
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
  written.length = 0;
  confirmations.length = 0;
  confirmAnswer = true;
  handle = null;
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

test("display-only SQL*Plus commands are listed as ignored with a reason, remarks stay silent", async () => {
  const outcome = await runSqlScript({
    connection,
    database: null,
    sql: "REM setup\nSET ECHO ON\nSET LINESIZE 200;\nPROMPT loading\nCOLUMN x FORMAT a10\nTTITLE 'Report'\nSELECT 1 FROM dual;",
    mode: "autocommit",
  });
  expect(outcome.entries.map((entry) => [entry.sql, entry.status])).toEqual([
    ["SET ECHO ON", "ignored"],
    ["SET LINESIZE 200;", "ignored"],
    ["PROMPT loading", "success"],
    ["COLUMN x FORMAT a10", "ignored"],
    ["TTITLE 'Report'", "ignored"],
    ["SELECT 1 FROM dual;", "success"],
  ]);
  expect(outcome.entries[0].note).toContain("Darstellungsoption");
  expect(outcome.entries[2].output).toEqual([{ level: "PROMPT", message: "loading" }]);
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

test("CONNECT stops the script so later statements never run in another schema", async () => {
  const outcome = await runSqlScript({
    connection,
    database: null,
    sql: "SELECT 1 FROM dual;\nCONN hr/hr@db\nSELECT 2 FROM dual;",
    mode: "autocommit",
    stopOnError: false,
  });
  expect(outcome.entries.map((entry) => entry.status)).toEqual(["success", "error", "skipped"]);
  expect(outcome.entries[1].error).toContain("CONNECT/DISCONNECT wird nicht unterstützt");
  expect(executed()).toEqual(["SELECT 1 FROM dual;"]);
});

test("other dialects keep the policy check on the original script with GO separators", async () => {
  const mssql = { ...connection, id: "ms", kind: "mssql" as const };
  const run = runSqlScript({
    connection: mssql,
    database: null,
    sql: "CREATE PROCEDURE p AS SELECT 1\nGO\nCOMMIT",
    mode: "new-transaction",
  });
  await expect(run).rejects.toThrow();
  expect(executed()).toEqual([]);
});

const ROLLOUT = `-- SOLAGO: Planungen (Stand DEV)
set serveroutput on
whenever sqlerror exit failure rollback

declare
  n number;
begin
  update auftrag_art_planung set komm_lb_planen = '1' where ref in (3884, 3896) and ref_buffer_relation is null;
  n := sql%rowcount;
  dbms_output.put_line('EXP/SOL/FIX/BKW: ' || n || ' von 2');
  if n <> 2 then
    raise_application_error(-20001, 'EXP/SOL/FIX/BKW: erwartet 2 Zeilen, ' || n || ' gefunden - Stand weicht ab');
  end if;
end;
/

commit;

select p.ref, p.komm_lb_planen
  from auftrag_art_planung p
 where p.ref in (3884, 3896)
 order by p.ref;
`;

async function withOracleCapabilities(run: () => Promise<void>) {
  const { useProvidersStore, FALLBACK_PROVIDERS } = await import("../../src/lib/providers");
  const base = FALLBACK_PROVIDERS[0];
  useProvidersStore.setState({
    providers: [
      {
        ...base,
        id: "oracle",
        kind: "oracle",
        capabilities: { ...base.capabilities, server_output: true, transactions: true },
      },
    ],
    loaded: true,
  });
  try {
    await run();
  } finally {
    useProvidersStore.setState({ providers: FALLBACK_PROVIDERS, loaded: false });
  }
}

function sqlplusSession(options: { failBlock?: boolean; openAtEnd?: boolean } = {}) {
  const txSql: string[] = [];
  const pendingOutput: { level: string; message: string }[][] = [];
  handle = (command, args) => {
    if (command === "begin_transaction") return "tx-1";
    if (command === "transaction_database_changes") return [];
    if (command === "transaction_server_output") return pendingOutput.shift() ?? [];
    if (command === "execute_in_transaction") {
      const sql = String(args.sql);
      txSql.push(sql);
      if (sql.includes("LOCAL_TRANSACTION_ID"))
        return {
          columns: ["ID"],
          rows: [{ ID: options.openAtEnd ? "1.2.3" : null }],
          rows_affected: null,
          execution_time_ms: 1,
        };
      if (/^declare/i.test(sql.trim())) {
        pendingOutput.push([
          {
            level: "OUTPUT",
            message: options.failBlock ? "EXP/SOL/FIX/BKW: 1 von 2" : "EXP/SOL/FIX/BKW: 2 von 2",
          },
        ]);
        if (options.failBlock)
          return new Error(
            "ORA-20001: EXP/SOL/FIX/BKW: erwartet 2 Zeilen, 1 gefunden - Stand weicht ab\nORA-06512: in Zeile 8",
          );
        return { columns: [], rows: [], rows_affected: null, execution_time_ms: 3 };
      }
      if (/^select/i.test(sql.trim()))
        return {
          columns: ["REF", "KOMM_LB_PLANEN"],
          rows: [
            { REF: 3884, KOMM_LB_PLANEN: "1" },
            { REF: 3896, KOMM_LB_PLANEN: "1" },
          ],
          rows_affected: null,
          execution_time_ms: 2,
        };
      return { columns: [], rows: [], rows_affected: 1, execution_time_ms: 1 };
    }
    return undefined;
  };
  return txSql;
}

test("the rollout script runs like SQL*Plus: DBMS_OUTPUT per block, COMMIT in the session, final SELECT", async () => {
  await withOracleCapabilities(async () => {
    const txSql = sqlplusSession();
    const outcome = await runSqlScript({
      connection,
      database: null,
      sql: ROLLOUT,
      mode: "new-transaction",
    });
    expect(outcome.error).toBeNull();
    expect(outcome.entries.map((entry) => entry.status)).toEqual([
      "success",
      "success",
      "success",
      "success",
      "success",
    ]);
    const [, , block, commit, select] = outcome.entries;
    expect(block.output).toEqual([{ level: "OUTPUT", message: "EXP/SOL/FIX/BKW: 2 von 2" }]);
    expect(block.feedback).toBe("PL/SQL-Prozedur erfolgreich abgeschlossen.");
    expect(commit.feedback).toBe("Transaktion mit COMMIT abgeschlossen.");
    expect(select.rowCount).toBe(2);
    expect(select.feedback).toBe("2 Zeilen ausgewählt.");
    expect(
      txSql.filter((sql) => !sql.includes("LOCAL_TRANSACTION_ID") && !sql.includes("DBMS_OUTPUT")),
    ).toEqual([
      expect.stringMatching(/^declare/),
      "commit;",
      expect.stringMatching(/^select p\.ref/),
    ]);
    expect(calls.some((call) => call.command === "commit_transaction")).toBe(false);
    expect(calls.filter((call) => call.command === "rollback_transaction")).toHaveLength(1);
    expect(useTransactionStore.getState().transactions).toEqual([]);
    expect(outcome.exit).toBeNull();
  });
});

test("WHENEVER SQLERROR EXIT FAILURE ROLLBACK shows the block output, rolls back and skips the rest", async () => {
  await withOracleCapabilities(async () => {
    const txSql = sqlplusSession({ failBlock: true });
    const outcome = await runSqlScript({
      connection,
      database: null,
      sql: ROLLOUT,
      mode: "new-transaction",
    });
    expect(outcome.entries.map((entry) => entry.status)).toEqual([
      "success",
      "success",
      "error",
      "skipped",
      "skipped",
    ]);
    const block = outcome.entries[2];
    expect(block.output?.[0]).toEqual({ level: "OUTPUT", message: "EXP/SOL/FIX/BKW: 1 von 2" });
    expect(block.output?.at(-1)?.message).toBe("EXIT FAILURE (Code 1) mit ROLLBACK");
    expect(outcome.error).toContain("ORA-20001");
    expect(outcome.exit).toEqual({ code: 1, label: "FAILURE", action: "ROLLBACK" });
    expect(txSql.some((sql) => sql === "commit;")).toBe(false);
    expect(calls.filter((call) => call.command === "rollback_transaction")).toHaveLength(1);
    expect(calls.some((call) => call.command === "commit_transaction")).toBe(false);
    expect(useTransactionStore.getState().transactions).toEqual([]);
  });
});

test("WHENEVER SQLERROR EXIT without an action commits pending work like SQL*Plus", async () => {
  await withOracleCapabilities(async () => {
    sqlplusSession({ failBlock: true });
    const outcome = await runSqlScript({
      connection,
      database: null,
      sql: ROLLOUT.replace("exit failure rollback", "exit sql.sqlcode"),
      mode: "new-transaction",
    });
    expect(outcome.exit).toEqual({ code: 20001, label: "SQL.SQLCODE", action: "COMMIT" });
    expect(calls.filter((call) => call.command === "commit_transaction")).toHaveLength(1);
  });
});

test("an open transaction stays in the panel when the script ends without COMMIT or EXIT", async () => {
  await withOracleCapabilities(async () => {
    sqlplusSession({ openAtEnd: true });
    const outcome = await runSqlScript({
      connection,
      database: null,
      sql: "UPDATE t SET x = 1;\nBEGIN NULL; END;\n/",
      mode: "new-transaction",
    });
    expect(outcome.error).toBeNull();
    expect(useTransactionStore.getState().transactions.map((tx) => tx.txId)).toEqual(["tx-1"]);
    expect(
      calls.some(
        (call) =>
          call.command.endsWith("_transaction") &&
          call.command !== "begin_transaction" &&
          call.command !== "execute_in_transaction",
      ),
    ).toBe(false);
  });
});

test("autocommit mode warns that ROLLBACK cannot undo committed statements", async () => {
  failing.add("SELECT 1 FROM gone;");
  const outcome = await runSqlScript({
    connection,
    database: null,
    sql: "WHENEVER SQLERROR EXIT 3 ROLLBACK\nUPDATE t SET x = 1;\nSELECT 1 FROM gone;\nSELECT 2 FROM dual;",
    mode: "autocommit",
  });
  expect(outcome.exit).toEqual({ code: 3, label: "3", action: "ROLLBACK" });
  expect(outcome.entries.map((entry) => entry.status)).toEqual([
    "success",
    "success",
    "error",
    "skipped",
  ]);
  expect(
    outcome.entries[2].output?.some(
      (line) => line.level === "WARNING" && line.message.includes("ohne Wirkung"),
    ),
  ).toBe(true);
});

test("EXIT FAILURE without an SQL error still marks the run as failed", async () => {
  const outcome = await runSqlScript({
    connection,
    database: null,
    sql: "SELECT 1 FROM dual;\nSET EXITCOMMIT OFF\nEXIT FAILURE;\nSELECT 2 FROM dual;",
    mode: "autocommit",
  });
  expect(outcome.exit).toEqual({ code: 1, label: "FAILURE", action: "ROLLBACK" });
  expect(outcome.error).toBe("Skript mit EXIT FAILURE (Code 1) beendet.");
  expect(executed()).toEqual(["SELECT 1 FROM dual;"]);
});

test("compilation errors are warnings and do not trigger WHENEVER SQLERROR, SHOW ERRORS lists them", async () => {
  handle = (command, args) => {
    const sql = String(args.sql ?? "");
    if (command === "execute_query" && sql.startsWith("CREATE OR REPLACE PROCEDURE"))
      return new Error(
        "Oracle: ORA-24344: PROCEDURE P_BAD wurde mit Kompilierfehlern erstellt\nZeile 1/27: PLS-00201: Bezeichner 'X' muss deklariert werden",
      );
    if (command === "execute_query" && sql.includes("all_errors"))
      return {
        columns: ["LINE/COL", "ERROR"],
        rows: [{ "LINE/COL": "1/27", ERROR: "PLS-00201: Bezeichner 'X' muss deklariert werden" }],
        rows_affected: null,
        execution_time_ms: 1,
      };
    return undefined;
  };
  const outcome = await runSqlScript({
    connection,
    database: null,
    sql: "WHENEVER SQLERROR EXIT FAILURE\nCREATE OR REPLACE PROCEDURE p_bad AS BEGIN x; END;\n/\nSHOW ERRORS\nSELECT 1 FROM dual;",
    mode: "autocommit",
  });
  expect(outcome.entries.map((entry) => entry.status)).toEqual([
    "success",
    "warning",
    "success",
    "success",
  ]);
  expect(outcome.entries[1].feedback).toBe(
    "Warnung: Prozedur wurde mit Kompilierungsfehlern erstellt.",
  );
  expect(outcome.entries[1].output?.[0].message).toContain("PLS-00201");
  const show = calls.find((call) => String(call.args.sql ?? "").includes("all_errors"));
  expect(String(show?.args.sql)).toContain("name = 'P_BAD' AND type = 'PROCEDURE'");
  expect(outcome.entries[2].result?.rows).toHaveLength(1);
  expect(outcome.exit).toBeNull();
  expect(outcome.error).toBeNull();
});

test("VARIABLE, EXEC with binds, PRINT and REFCURSOR work like SQL*Plus", async () => {
  handle = (command, args) => {
    if (command !== "execute_with_binds") return undefined;
    const sql = String(args.sql);
    const binds = args.binds as { name: string; dataType: string; value: string | null }[];
    if (sql.includes("OPEN :c"))
      return {
        result: { columns: [], rows: [], rows_affected: null, execution_time_ms: 1 },
        binds: [
          {
            name: "C",
            value: null,
            cursor: {
              columns: ["N"],
              rows: [{ N: 1 }, { N: 2 }],
              rows_affected: null,
              execution_time_ms: 0,
            },
          },
        ],
      };
    const before = binds.find((bind) => bind.name === "RC")?.value;
    return {
      result: { columns: [], rows: [], rows_affected: null, execution_time_ms: 1 },
      binds: [{ name: "RC", value: String(Number(before ?? 0) + 5), cursor: null }],
    };
  };
  const outcome = await runSqlScript({
    connection,
    database: null,
    sql: "VARIABLE rc NUMBER = 2\nVAR c REFCURSOR\nEXEC :rc := :rc + 5\nBEGIN OPEN :c FOR SELECT level n FROM dual CONNECT BY level <= 2; END;\n/\nPRINT rc\nPRINT c\nWHENEVER SQLERROR EXIT :rc\nPRINT missing",
    mode: "autocommit",
  });
  const bound = calls.filter((call) => call.command === "execute_with_binds");
  expect(bound.map((call) => call.args.sql)).toEqual([
    "EXEC :rc := :rc + 5",
    "BEGIN OPEN :c FOR SELECT level n FROM dual CONNECT BY level <= 2; END;",
  ]);
  expect(bound[0].args.binds).toEqual([
    { name: "RC", dataType: "NUMBER", value: "2" },
    { name: "C", dataType: "REFCURSOR", value: null },
  ]);
  expect(outcome.entries[4].result?.rows).toEqual([{ RC: "7" }]);
  expect(outcome.entries[5].result?.rows).toEqual([{ N: 1 }, { N: 2 }]);
  expect(outcome.entries[5].feedback).toBe("2 Zeilen ausgewählt.");
  expect(outcome.entries[7].error).toContain('SP2-0552: Bindvariable "MISSING"');
  expect(executed()).toEqual([]);
});

test("SPOOL writes the run transcript next to the saved script and refuses other file types", async () => {
  const outcome = await runSqlScript({
    connection,
    database: null,
    sql: "SPOOL rollout\nPROMPT start\nSELECT 1 FROM dual;\nSPOOL OFF\nSPOOL /tmp/.bashrc",
    mode: "autocommit",
    filePath: "/proj/main.sql",
    stopOnError: false,
  });
  expect(written).toHaveLength(1);
  expect(written[0].path).toBe("/proj/rollout.lst");
  expect(written[0].text).toContain("SQL> PROMPT start\nstart");
  expect(written[0].text).toContain("SQL> SELECT 1 FROM dual;");
  expect(written[0].text).toContain("1 Zeile verarbeitet.");
  expect(outcome.entries[4].error).toContain("versteckte Ordner oder Dateien");
  expect(confirmations).toEqual(["Skriptprotokoll schreiben?"]);
  for (const [target, reason] of [
    ["/proj/out.sql", "nur Protokolldateien"],
    ["//server/share/x.log", "UNC"],
    ["/proj/../etc/x.log", "weder .."],
  ]) {
    const refused = await runSqlScript({
      connection,
      database: null,
      sql: `SPOOL ${target}\nSELECT 1 FROM dual;`,
      mode: "autocommit",
      filePath: "/proj/main.sql",
    });
    expect(refused.entries[0].error).toContain(reason);
  }
  confirmAnswer = false;
  const declined = await runSqlScript({
    connection,
    database: null,
    sql: "SPOOL /proj/run.log\nSELECT 1 FROM dual;",
    mode: "autocommit",
    stopOnError: false,
  });
  expect(declined.entries.map((entry) => entry.status)).toEqual(["error", "skipped"]);
  expect(declined.error).toBe("SPOOL vom Benutzer abgebrochen.");
});

test("COLUMN NEW_VALUE, ACCEPT, @file arguments, VERIFY and DEFINE behave like SQL*Plus", async () => {
  files["/proj/child.sql"] = "PROMPT child &1 &2\n";
  handle = (command, args) => {
    if (command === "execute_query" && String(args.sql).includes("today"))
      return {
        columns: ["TODAY"],
        rows: [{ TODAY: "2026-11-04" }],
        rows_affected: null,
        execution_time_ms: 1,
      };
    return undefined;
  };
  const asked: { names: string[]; prompts: unknown }[] = [];
  const { substitutionSession } = await import("../../src/lib/sql-statements/sqlplus");
  const outcome = await runSqlScript({
    connection,
    database: null,
    sql: "COLUMN today NEW_VALUE run_day NOPRINT\nSELECT TO_CHAR(SYSDATE) today FROM dual;\nACCEPT owner CHAR PROMPT 'Schema: ' DEFAULT 'SOLAGO'\nACCEPT pw PROMPT 'Passwort' HIDE\nPROMPT Lauf &run_day fuer &owner\n@child \"a b\" c\nSELECT * FROM &owner..t;\nDEFINE owner",
    mode: "autocommit",
    filePath: "/proj/main.sql",
    variables: substitutionSession("tab-accept"),
    askVariables: async (names, defaults, prompts) => {
      asked.push({ names, prompts });
      return { ...defaults, PW: "geheim" };
    },
  });
  expect(asked).toEqual([
    {
      names: ["OWNER", "PW"],
      prompts: { OWNER: { label: "Schema: ", hide: false }, PW: { label: "Passwort", hide: true } },
    },
  ]);
  expect(substitutionSession("tab-accept").answers.PW).toBeUndefined();
  const prompts = outcome.entries
    .flatMap((entry) => entry.output ?? [])
    .filter((line) => line.level === "PROMPT");
  expect(prompts.map((line) => line.message)).toEqual([
    "Lauf 2026-11-04 fuer SOLAGO",
    "child a b c",
  ]);
  const select = outcome.entries.find((entry) => entry.sql.startsWith("SELECT * FROM"));
  expect(select?.sql).toBe("SELECT * FROM SOLAGO.t;");
  expect(select?.output).toEqual([
    { level: "INFO", message: "alt    1: SELECT * FROM &owner..t;" },
    { level: "INFO", message: "neu    1: SELECT * FROM SOLAGO.t;" },
  ]);
  expect(outcome.entries.at(-1)?.output).toEqual([
    { level: "INFO", message: 'DEFINE OWNER = "SOLAGO" (CHAR)' },
  ]);
});

test("HOST and STARTUP stop the script instead of being skipped silently", async () => {
  for (const command of ["HOST rm -rf /tmp/x", "STARTUP"]) {
    calls.length = 0;
    const outcome = await runSqlScript({
      connection,
      database: null,
      sql: `SELECT 1 FROM dual;\n${command}\nSELECT 2 FROM dual;`,
      mode: "autocommit",
      stopOnError: false,
    });
    expect(outcome.entries.map((entry) => entry.status)).toEqual(["success", "error", "skipped"]);
    expect(executed()).toEqual(["SELECT 1 FROM dual;"]);
  }
});

test("other database families attach their server messages to each statement", async () => {
  const { useProvidersStore, FALLBACK_PROVIDERS } = await import("../../src/lib/providers");
  const base = FALLBACK_PROVIDERS[0];
  useProvidersStore.setState({
    providers: [{ ...base, capabilities: { ...base.capabilities, server_output: true } }],
    loaded: true,
  });
  const queue = [
    [{ level: "NOTICE", message: "aus einer früheren Abfrage" }],
    [{ level: "NOTICE", message: "Relation t existiert bereits, wird übersprungen" }],
    [],
    [{ level: "WARNING", message: "vor dem Fehler" }],
  ];
  handle = (command, args) => {
    if (command === "take_server_output") return queue.shift() ?? [];
    if (command === "execute_query" && String(args.sql).startsWith("SELECT broken"))
      return new Error("ERROR: syntax error");
    return undefined;
  };
  const pg = {
    ...connection,
    id: "pg",
    kind: "postgres" as const,
    connectionString: "postgres://x/db",
  };
  const outcome = await runSqlScript({
    connection: pg,
    database: null,
    sql: "CREATE TABLE IF NOT EXISTS t (id int);\nSELECT 1;\nSELECT broken;",
    mode: "autocommit",
  });
  expect(outcome.entries.map((entry) => entry.output ?? [])).toEqual([
    [{ level: "NOTICE", message: "Relation t existiert bereits, wird übersprungen" }],
    [],
    [{ level: "WARNING", message: "vor dem Fehler" }],
  ]);
  expect(calls.filter((call) => call.command === "take_server_output")).toHaveLength(4);
  expect(
    outcome.entries.some((entry) =>
      entry.output?.some((line) => line.message === "aus einer früheren Abfrage"),
    ),
  ).toBe(false);
  useProvidersStore.setState({ providers: FALLBACK_PROVIDERS, loaded: false });
});

test("bind statements obey read-only mode like every other SQL statement", async () => {
  const readOnly = { ...connection, id: "ora-ro", readOnly: true };
  useConnectionsStore.setState({ connections: [readOnly], activeId: readOnly.id });
  const outcome = await runSqlScript({
    connection: readOnly,
    database: null,
    sql: "VARIABLE n NUMBER\nDELETE FROM t WHERE id > :n;",
    mode: "autocommit",
  });
  expect(outcome.entries[1].status).toBe("error");
  expect(outcome.entries[1].error).toContain("Lesemodus");
  expect(calls.some((call) => call.command === "execute_with_binds")).toBe(false);
});

test("runtime substitution is checked again for destructive statements before it runs", async () => {
  handle = (command, args) => {
    if (command === "execute_query" && String(args.sql).includes("'DROP'"))
      return { columns: ["C"], rows: [{ C: "DROP" }], rows_affected: null, execution_time_ms: 1 };
    return undefined;
  };
  confirmAnswer = false;
  const outcome = await runSqlScript({
    connection,
    database: null,
    sql: "COLUMN c NEW_VALUE cmd\nSELECT 'DROP' c FROM dual;\n&cmd TABLE important;\nSELECT 2 FROM dual;",
    mode: "autocommit",
    stopOnError: false,
  });
  expect(confirmations.length).toBe(1);
  expect(executed().some((sql) => sql.startsWith("DROP"))).toBe(false);
  expect(outcome.entries.map((entry) => entry.status)).toEqual([
    "success",
    "success",
    "error",
    "skipped",
  ]);
});

test("a declined production commit stops the script instead of continuing", async () => {
  await withOracleCapabilities(async () => {
    const prod = { ...connection, id: "ora-prod", environment: "production" as const };
    useConnectionsStore.setState({ connections: [prod], activeId: prod.id });
    useSettingsStore.setState({
      productionReadOnly: false,
      productionConfirmCommit: true,
    } as never);
    sqlplusSession();
    confirmAnswer = false;
    const outcome = await runSqlScript({
      connection: prod,
      database: null,
      sql: "WHENEVER SQLERROR CONTINUE\nUPDATE t SET x = 1 WHERE id = 1;\nCOMMIT;\nCREATE INDEX i ON t (x);",
      mode: "new-transaction",
    });
    expect(outcome.entries.map((entry) => entry.status)).toEqual([
      "success",
      "success",
      "error",
      "skipped",
    ]);
    expect(outcome.error).toContain("abgebrochen");
    expect(calls.some((call) => String(call.args.sql ?? "").startsWith("CREATE INDEX"))).toBe(
      false,
    );
  });
});

test("ACCEPT … HIDE values are masked everywhere and forgotten after the run", async () => {
  const { substitutionSession } = await import("../../src/lib/sql-statements/sqlplus");
  const variables = substitutionSession("tab-hide");
  const outcome = await runSqlScript({
    connection,
    database: null,
    sql: "ACCEPT pw PROMPT 'Passwort' HIDE\nPROMPT setze &pw\nALTER USER app IDENTIFIED BY &pw;\nDEFINE pw",
    mode: "autocommit",
    variables,
    askVariables: async () => ({ PW: "Geheim123" }),
  });
  expect(executed()).toEqual(["ALTER USER app IDENTIFIED BY Geheim123;"]);
  const visible = JSON.stringify(outcome.entries);
  expect(visible).not.toContain("Geheim123");
  expect(visible).toContain("********");
  expect(variables.state.defines.PW).toBeUndefined();
});

test("a slash after a terminated statement runs it again like SQL*Plus, a block slash does not", async () => {
  const outcome = await runSqlScript({
    connection,
    database: null,
    sql: "UPDATE t SET n = n + 1;\n/\nBEGIN NULL; END;\n/\nRUN",
    mode: "autocommit",
  });
  expect(executed()).toEqual([
    "UPDATE t SET n = n + 1;",
    "UPDATE t SET n = n + 1;",
    "BEGIN NULL; END;",
    "BEGIN NULL; END;",
  ]);
  expect(outcome.entries).toHaveLength(4);
});

test("a master script that only calls @ files still starts in the SQL*Plus session", async () => {
  const { useSettingsStore: settings } = await import("../../src/lib/settings");
  expect(settings.getState().transactionsEnabled).toBe(true);
  const { splitSqlStatements } = await import("../../src/lib/sql-statements");
  expect(
    splitSqlStatements("@a\n@b\ncommit;", "oracle").statements.map((item) => item.text),
  ).toEqual(["commit;"]);
});
