import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { SavedConnection } from "../src/lib/connections";
import type { QueryResult } from "../src/lib/db";

const commands: { command: string; sql?: string }[] = [];
let handler: (sql: string) => QueryResult = () => result();

function result(rows: Record<string, unknown>[] = [], rowsAffected = 1): QueryResult {
  return {
    columns: Object.keys(rows[0] ?? {}),
    rows,
    rows_affected: rowsAffected,
    execution_time_ms: 1,
  };
}

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown> = {}) => {
    commands.push({ command, sql: typeof args.sql === "string" ? args.sql : undefined });
    if (command === "list_table_columns_detailed") return [{ name: "id", is_primary_key: true }];
    if (command === "begin_transaction") return "tx-new";
    if (command === "execute_in_transaction" || command === "execute_query") {
      const sql = String(args.sql);
      if (sql.includes("FROM pg_index i")) return result([{ name: "id" }]);
      return handler(sql);
    }
    return null;
  },
}));

const { analyzedSql, scriptPolicyIssue, sqlTokens, writesData } = await import(
  "../src/lib/sql-safety"
);
const { executeWithTransactionChanges } = await import("../src/lib/transaction-sql-changes");
const { executeSqlWithTransactions } = await import("../src/features/query/query-view/execute-sql");
const { useTransactionStore } = await import("../src/lib/transactions");
const { useConnectionsStore } = await import("../src/lib/connections/store");
const { useSettingsStore } = await import("../src/lib/settings");
const { productionWriteBlock, PRODUCTION_LOCK_MESSAGE } = await import("../src/lib/environments");

const connection: SavedConnection = {
  id: "tx-safety",
  name: "TX safety",
  kind: "postgres",
  connectionString: "postgres://localhost/test",
  sslMode: "disable",
};

beforeEach(() => {
  commands.length = 0;
  handler = () => result();
  useTransactionStore.setState({
    transactions: [],
    busyTransactions: {},
    finalizingTransactions: [],
  });
  useSettingsStore.setState({ transactionsEnabled: true, productionReadOnly: false });
  useConnectionsStore.setState({ connections: [], hostGroupRules: [] });
});

function openQueryTransaction(kind: SavedConnection["kind"] = "postgres") {
  useTransactionStore.getState().addTransaction({
    txId: "tx",
    connectionId: connection.id,
    connectionName: connection.name,
    scope: { type: "query" },
    changes: [],
    startedAt: Date.now(),
  });
  return { ...connection, kind };
}

function sentSql() {
  return commands.filter((entry) => entry.sql !== undefined).map((entry) => entry.sql);
}

describe("EXPLAIN ANALYZE executes the explained statement", () => {
  const writes: [string, string][] = [
    ["EXPLAIN ANALYZE DELETE FROM orders WHERE id < 1000", "postgres"],
    ["explain analyse update orders set a = 1 where id = 2", "postgres"],
    ["EXPLAIN (ANALYZE, BUFFERS) INSERT INTO orders VALUES (1)", "postgres"],
    [
      "EXPLAIN (FORMAT JSON, ANALYZE true) MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN DELETE",
      "postgres",
    ],
    ["EXPLAIN ANALYZE VERBOSE WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d", "postgres"],
    ["EXPLAIN ANALYZE CREATE TABLE copy AS SELECT * FROM t", "postgres"],
    ["EXPLAIN ANALYZE SELECT * INTO archive FROM t", "postgres"],
    ["EXPLAIN ANALYZE EXECUTE purge_orders", "postgres"],
    ["/* note */ EXPLAIN ANALYZE DELETE FROM orders", "postgres"],
    ["SELECT 1; EXPLAIN ANALYZE DELETE FROM orders WHERE id = 1", "postgres"],
    ["EXPLAIN ANALYZE DELETE FROM orders WHERE id < 1000", "mysql"],
    ["EXPLAIN ANALYZE FORMAT=TREE UPDATE orders SET a = 1 WHERE id = 2", "mysql"],
    ["EXPLAIN ANALYZE DELETE FROM orders WHERE id < 1000", "duckdb"],
    ["EXPLAIN ANALYZE", "postgres"],
  ];
  for (const [sql, dialect] of writes) {
    test(`${dialect}: ${sql} writes data`, () => {
      expect(writesData(sql, dialect)).toBe(true);
    });
  }

  const reads: [string, string][] = [
    ["EXPLAIN DELETE FROM orders WHERE id < 1000", "postgres"],
    ["EXPLAIN (FORMAT JSON) UPDATE orders SET a = 1", "postgres"],
    ["EXPLAIN ANALYZE SELECT * FROM orders", "postgres"],
    ["EXPLAIN (ANALYZE, BUFFERS) SELECT analyze FROM t", "postgres"],
    ["EXPLAIN SELECT analyze FROM t", "postgres"],
    ["EXPLAIN ANALYZE WITH x AS (SELECT 1) SELECT * FROM x", "postgres"],
    ["EXPLAIN ANALYZE SELECT * FROM orders", "mysql"],
    ["EXPLAIN FORMAT=JSON DELETE FROM orders", "mysql"],
    ["EXPLAIN QUERY PLAN DELETE FROM orders", "sqlite"],
    ["EXPLAIN DELETE FROM orders", "duckdb"],
  ];
  for (const [sql, dialect] of reads) {
    test(`${dialect}: ${sql} only reads`, () => {
      expect(writesData(sql, dialect)).toBe(false);
    });
  }

  test("a locked production connection blocks EXPLAIN ANALYZE of DML", () => {
    const production = {
      ...connection,
      kind: "mysql" as const,
      environment: "production" as const,
    };
    useSettingsStore.setState({ productionReadOnly: true });
    expect(
      productionWriteBlock(production, "EXPLAIN ANALYZE DELETE FROM orders WHERE id < 1000"),
    ).toBe(PRODUCTION_LOCK_MESSAGE);
    expect(productionWriteBlock(production, "EXPLAIN ANALYZE SELECT * FROM orders")).toBeNull();
  });

  test("analyzedSql exposes the executed statement for classification", () => {
    expect(analyzedSql("EXPLAIN ANALYZE DELETE FROM t WHERE id = 1", "postgres")).toContain(
      "DELETE FROM t WHERE id = 1",
    );
    expect(analyzedSql("EXPLAIN DELETE FROM t", "postgres")).toBe("EXPLAIN DELETE FROM t");
    expect(analyzedSql("db.t.find({})", "mongodb")).toBe("db.t.find({})");
  });

  test("the SQL editor runs EXPLAIN ANALYZE of DML inside a managed transaction", async () => {
    await executeSqlWithTransactions({
      connection,
      database: null,
      sql: "EXPLAIN ANALYZE DELETE FROM orders WHERE id < 1000",
      transactionsCapable: true,
      onJob: () => {},
    });
    expect(commands.map((entry) => entry.command)).toContain("begin_transaction");
    expect(commands.map((entry) => entry.command)).not.toContain("execute_query");
    expect(useTransactionStore.getState().transactions[0]?.changes.map((c) => c.type)).toEqual([
      "query",
    ]);
  });
});

describe("transaction control inside a managed transaction", () => {
  const control: [string, string][] = [
    ["COMMIT", "postgres"],
    ["commit;", "postgres"],
    ["ROLLBACK", "postgres"],
    ["END", "postgres"],
    ["ABORT", "postgres"],
    ["BEGIN", "postgres"],
    ["START TRANSACTION", "mysql"],
    ["PREPARE TRANSACTION 'x'", "postgres"],
    ["UPDATE t SET a = 1 WHERE id = 1; COMMIT", "postgres"],
    ["COMMIT", "mysql"],
    ["COMMIT TRAN", "mssql"],
    ["BEGIN TRANSACTION", "mssql"],
    ["UPDATE t SET a = 1 WHERE id = 1 IF @@ERROR = 0 COMMIT", "mssql"],
    ["BEGIN TRY UPDATE t SET a = 1 WHERE id = 1 END TRY BEGIN CATCH ROLLBACK END CATCH", "mssql"],
    ["COMMIT", "oracle"],
    ["BEGIN UPDATE t SET a = 1 WHERE id = 1; COMMIT; END;", "oracle"],
    ["COMMIT", "sqlite"],
  ];
  for (const [sql, dialect] of control) {
    test(`${dialect}: ${sql} is rejected in an open transaction`, async () => {
      const tx = openQueryTransaction(dialect as SavedConnection["kind"]);
      await expect(
        executeSqlWithTransactions({
          connection: tx,
          database: null,
          sql,
          transactionsCapable: true,
          onJob: () => {},
        }),
      ).rejects.toThrow(/Transaktion/);
      expect(sentSql()).toEqual([]);
      expect(useTransactionStore.getState().transactions[0].changes).toEqual([]);
    });
  }

  const implicitCommit: [string, string][] = [
    ["CREATE TABLE t (id int)", "mysql"],
    ["ALTER TABLE t ADD c int", "mysql"],
    ["RENAME TABLE a TO b", "mysql"],
    ["LOCK TABLES t WRITE", "mysql"],
    ["SET autocommit = 1", "mysql"],
    ["CREATE TABLE t (id number)", "oracle"],
    ["TRUNCATE TABLE t", "oracle"],
    ["COMMENT ON TABLE t IS 'x'", "oracle"],
  ];
  for (const [sql, dialect] of implicitCommit) {
    test(`${dialect}: ${sql} is rejected because it commits implicitly`, async () => {
      const tx = openQueryTransaction(dialect as SavedConnection["kind"]);
      await expect(
        executeSqlWithTransactions({
          connection: tx,
          database: null,
          sql,
          transactionsCapable: true,
          onJob: () => {},
        }),
      ).rejects.toThrow(/impliziten Commit/);
      expect(sentSql()).toEqual([]);
    });
  }

  const allowed: [string, string][] = [
    ["CREATE TABLE t (id int)", "postgres"],
    ["CREATE TEMPORARY TABLE t (id int)", "mysql"],
    ["UPDATE t SET a = 1 WHERE id = 1", "mysql"],
    ["SELECT 'COMMIT' AS c", "postgres"],
    ['SELECT "commit" FROM t', "postgres"],
    ["BEGIN TRY UPDATE t SET a = 1 WHERE id = 1 END TRY BEGIN CATCH SELECT 1 END CATCH", "mssql"],
    ["BEGIN UPDATE t SET a = 1 WHERE id = 1; END;", "oracle"],
    ["SAVEPOINT s1", "postgres"],
    ["CREATE FUNCTION f() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT 1; END;", "postgres"],
  ];
  for (const [sql, dialect] of allowed) {
    test(`${dialect}: ${sql} runs in the open transaction`, async () => {
      const tx = openQueryTransaction(dialect as SavedConnection["kind"]);
      await executeSqlWithTransactions({
        connection: tx,
        database: null,
        sql,
        transactionsCapable: true,
        onJob: () => {},
      });
      expect(commands.map((entry) => entry.command)).toContain("execute_in_transaction");
    });
  }

  test("DML followed by COMMIT does not open a managed transaction", async () => {
    await expect(
      executeSqlWithTransactions({
        connection,
        database: null,
        sql: "UPDATE t SET a = 1 WHERE id = 1; COMMIT;",
        transactionsCapable: true,
        onJob: () => {},
      }),
    ).rejects.toThrow(/Transaktion/);
    expect(commands).toEqual([]);
    expect(useTransactionStore.getState().transactions).toEqual([]);
  });

  test("DML with implicit-commit DDL does not open a managed transaction", async () => {
    await expect(
      executeSqlWithTransactions({
        connection: { ...connection, kind: "mysql" },
        database: null,
        sql: "UPDATE t SET a = 1 WHERE id = 1; CREATE TABLE x (id int);",
        transactionsCapable: true,
        onJob: () => {},
      }),
    ).rejects.toThrow(/impliziten Commit/);
    expect(commands).toEqual([]);
  });

  test("COMMIT without a managed transaction still runs directly", async () => {
    await executeSqlWithTransactions({
      connection,
      database: null,
      sql: "COMMIT",
      transactionsCapable: true,
      onJob: () => {},
    });
    expect(commands.map((entry) => entry.command)).toEqual(["execute_query"]);
  });

  test("script policy keeps T-SQL TRY blocks and rejects nested commits", () => {
    expect(
      scriptPolicyIssue("BEGIN TRY SELECT 1 END TRY BEGIN CATCH SELECT 2 END CATCH", "mssql", true),
    ).toBeNull();
    expect(
      scriptPolicyIssue("BEGIN TRAN; UPDATE t SET a = 1 WHERE id = 1", "mssql", false),
    ).toContain("Transaktionsbefehle");
    expect(
      scriptPolicyIssue("BEGIN UPDATE t SET a = 1; COMMIT; END;\n/", "oracle", true),
    ).toContain("Transaktionsbefehle");
  });
});

describe("transaction snapshots tolerate trailing comments", () => {
  function words(sql: string, kind: string) {
    return sqlTokens(sql, kind === "mysql" ? "mysql" : kind).map((token) => token.word);
  }

  test("postgres keeps LIMIT, FOR UPDATE and RETURNING outside the comment", async () => {
    const executed: string[] = [];
    handler = (sql) => {
      executed.push(sql);
      if (sql.startsWith("SELECT")) return result([{ id: "1", archived: "false" }]);
      if (/\bRETURNING\b/.test(sql)) return result([{ id: "1", archived: "true" }]);
      return result();
    };
    const tracked = await executeWithTransactionChanges(
      connection,
      null,
      "tx",
      "UPDATE events SET archived = true WHERE created_at < now() -- cleanup",
      async () => result(),
    );
    const snapshot = executed.find((sql) => sql.startsWith("SELECT * FROM events"));
    expect(snapshot).toBeDefined();
    expect(words(snapshot ?? "", "postgres")).toEqual(
      expect.arrayContaining(["LIMIT", "FOR", "UPDATE"]),
    );
    const update = executed.find((sql) => sql.startsWith("UPDATE"));
    expect(words(update ?? "", "postgres")).toContain("RETURNING");
    expect(tracked.changes).toHaveLength(1);
  });

  test("postgres INSERT with a trailing comment still returns the inserted row", async () => {
    const executed: string[] = [];
    handler = (sql) => {
      executed.push(sql);
      return words(sql, "postgres").includes("RETURNING") ? result([{ id: "7" }]) : result();
    };
    const tracked = await executeWithTransactionChanges(
      connection,
      null,
      "tx",
      "INSERT INTO people (id) VALUES (7) -- seed",
      async () => result(),
    );
    expect(tracked.changes).toHaveLength(1);
  });

  test("a comment after the semicolon is not part of the snapshot WHERE", async () => {
    const executed: string[] = [];
    handler = (sql) => {
      executed.push(sql);
      if (sql.startsWith("SELECT")) return result([{ id: "1", a: "0" }]);
      if (/\bRETURNING\b/.test(sql)) return result([{ id: "1", a: "1" }]);
      return result();
    };
    await executeWithTransactionChanges(
      connection,
      null,
      "tx",
      "UPDATE t SET a = 1 WHERE id = 1; -- done",
      async () => result(),
    );
    const snapshot = executed.find((sql) => sql.startsWith("SELECT * FROM t"));
    expect(snapshot).not.toContain(";");
    expect(executed.some((sql) => sql.includes(";"))).toBe(false);
  });

  for (const [kind, comment, limitWords] of [
    ["mysql", "-- cleanup", ["LIMIT"]],
    ["mysql", "# cleanup", ["LIMIT"]],
    ["sqlite", "-- cleanup", ["LIMIT"]],
    ["oracle", "-- cleanup", ["ROWNUM", "FETCH"]],
    ["mssql", "-- cleanup", ["TOP"]],
  ] as const) {
    test(`${kind} snapshot keeps its row cap after "${comment}"`, async () => {
      const executed: string[] = [];
      handler = (sql) => {
        executed.push(sql);
        if (/^SELECT\b[\s\S]*\bFROM events\b/.test(sql)) return result([{ id: "1", a: "0" }]);
        if (sql.includes("l8db_schema")) return result([{ l8db_schema: "app" }]);
        return result();
      };
      await executeWithTransactionChanges(
        { ...connection, kind },
        null,
        "tx",
        `UPDATE events SET a = 1 WHERE id > 0 ${comment}`,
        async () => result([], 1),
      );
      const snapshots = executed.filter((sql) => /^SELECT\b[\s\S]*\bFROM events\b/.test(sql));
      expect(snapshots.length).toBeGreaterThan(0);
      for (const snapshot of snapshots) {
        const tokens = words(snapshot, kind);
        expect(tokens.some((word) => (limitWords as readonly string[]).includes(word))).toBe(true);
        expect(tokens).toContain("WHERE");
      }
    });
  }
});
