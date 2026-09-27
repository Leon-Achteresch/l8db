import { beforeEach, expect, mock, test } from "bun:test";
import type { SavedConnection } from "../src/lib/connections";
import type { QueryResult } from "../src/lib/db";

const calls: string[] = [];
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
    if (command === "execute_in_transaction") {
      const sql = String(args.sql);
      calls.push(sql);
      if (sql.includes("FROM pg_index i")) return result([{ name: "id" }]);
      return handler(sql);
    }
  },
}));

const { executeWithTransactionChanges } = await import("../src/lib/transaction-sql-changes");
const { executeSqlWithTransactions } = await import("../src/features/query/query-view/execute-sql");
const { useTransactionStore } = await import("../src/lib/transactions");
const connection: SavedConnection = {
  id: "sql-diff-test",
  name: "SQL diff test",
  kind: "postgres",
  connectionString: "postgres://localhost/test",
  sslMode: "disable",
};

beforeEach(() => {
  calls.length = 0;
  handler = () => result();
  useTransactionStore.setState({
    transactions: [],
    busyTransactions: {},
    finalizingTransactions: [],
  });
});

test("INSERT records database returned defaults and keeps the original result shape", async () => {
  handler = (sql) =>
    sql.includes("RETURNING *") ? result([{ id: "12", name: "Ada", active: "true" }]) : result();
  const original = mock(() => result());
  const tracked = await executeWithTransactionChanges(
    connection,
    "tx",
    "INSERT INTO public.people (name) VALUES ('Ada')",
    original,
  );
  expect(original).not.toHaveBeenCalled();
  expect(tracked.result.rows).toEqual([]);
  expect(tracked.changes).toEqual([
    {
      type: "insert",
      schema: "public",
      table: "people",
      rowValues: { id: "12", name: "Ada", active: "true" },
      fromSql: true,
    },
  ]);
});

test("UPDATE shows old and new values from the same affected row", async () => {
  handler = (sql) => {
    if (sql.startsWith("SELECT")) return result([{ id: "1", name: "old", score: "4" }]);
    if (sql.includes("RETURNING *")) return result([{ id: "1", name: "new", score: "4" }]);
    return result();
  };
  const tracked = await executeWithTransactionChanges(
    connection,
    "tx",
    "UPDATE public.people SET name = 'new' WHERE id = 1",
    async () => result(),
  );
  expect(calls.find((sql) => sql.startsWith("SELECT"))).toContain(
    "WHERE id = 1 LIMIT 101 FOR UPDATE",
  );
  expect(tracked.changes).toEqual([
    {
      type: "update",
      schema: "public",
      table: "people",
      oldValues: { name: "old" },
      newValues: { name: "new" },
      fromSql: true,
    },
  ]);
});

test("failed analysis rolls back its savepoint and executes the original SQL", async () => {
  handler = (sql) => {
    if (sql.includes("RETURNING *")) throw new Error("RETURNING unavailable");
    return result();
  };
  const original = mock(() => result([], 3));
  const tracked = await executeWithTransactionChanges(
    connection,
    "tx",
    "INSERT INTO people VALUES (1)",
    original,
  );
  expect(calls.some((sql) => sql.startsWith("ROLLBACK TO SAVEPOINT"))).toBe(true);
  expect(original).toHaveBeenCalledTimes(1);
  expect(tracked.changes).toEqual([]);
  expect(tracked.result.rows_affected).toBe(3);
});

test("multi-row UPDATE matches rows by primary key regardless of return order", async () => {
  handler = (sql) => {
    if (sql.startsWith("SELECT"))
      return result(
        [
          { id: "1", name: "old one" },
          { id: "2", name: "old two" },
        ],
        2,
      );
    if (sql.includes("RETURNING *"))
      return result(
        [
          { id: "2", name: "new two" },
          { id: "1", name: "new one" },
        ],
        2,
      );
    return result();
  };
  const tracked = await executeWithTransactionChanges(
    connection,
    "tx",
    "UPDATE public.people SET name = 'new' WHERE id IN (1, 2)",
    async () => result(),
  );
  expect(tracked.changes.map((change) => change.oldValues?.name)).toEqual(["old two", "old one"]);
  expect(tracked.changes.map((change) => change.newValues?.name)).toEqual(["new two", "new one"]);
});

test("UPDATE does not display a diff when the affected row differs from the preview", async () => {
  handler = (sql) => {
    if (sql.startsWith("SELECT")) return result([{ id: "1", name: "old" }]);
    if (sql.includes("RETURNING *")) return result([{ id: "2", name: "new" }]);
    return result();
  };
  const tracked = await executeWithTransactionChanges(
    connection,
    "tx",
    "UPDATE people SET name = 'new' WHERE random() < 0.5",
    async () => result(),
  );
  expect(tracked.changes).toEqual([]);
});

test("scripts and upserts execute unchanged without snapshotting", async () => {
  const original = mock(() => result());
  await executeWithTransactionChanges(
    connection,
    "tx",
    "INSERT INTO people VALUES (1); DELETE FROM people WHERE id = 2",
    original,
  );
  await executeWithTransactionChanges(
    connection,
    "tx",
    "INSERT INTO people VALUES (1) ON CONFLICT (id) DO UPDATE SET id = 1",
    original,
  );
  expect(original).toHaveBeenCalledTimes(2);
  expect(calls).toEqual([]);
});

test("SQL editor keeps the statement and adds a row diff to its transaction", async () => {
  useTransactionStore.getState().addTransaction({
    txId: "tx",
    connectionId: connection.id,
    connectionName: connection.name,
    scope: { type: "query" },
    changes: [],
    startedAt: Date.now(),
  });
  handler = (sql) => {
    if (sql.startsWith("SELECT")) return result([{ id: "1", name: "old" }]);
    if (sql.includes("RETURNING *")) return result([{ id: "1", name: "new" }]);
    return result();
  };
  await executeSqlWithTransactions({
    connection,
    database: null,
    sql: "UPDATE people SET name = 'new' WHERE id = 1",
    transactionsCapable: true,
    onJob: () => {},
  });
  expect(
    useTransactionStore.getState().transactions[0].changes.map((change) => change.type),
  ).toEqual(["query", "update"]);
  expect(useTransactionStore.getState().panelOpen).toBe(true);
});
