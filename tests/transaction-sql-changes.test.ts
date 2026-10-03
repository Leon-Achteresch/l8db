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
    if (command === "list_table_columns_detailed") return [{ name: "id", is_primary_key: true }];
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
    null,
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
    null,
    "tx",
    "UPDATE public.people SET name = 'new' WHERE id = 1",
    async () => result(),
  );
  expect(calls.find((sql) => sql.startsWith("SELECT"))).toContain(
    "WHERE id = 1\n LIMIT 101 FOR UPDATE",
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
    null,
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
    null,
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
    null,
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
    null,
    "tx",
    "INSERT INTO people VALUES (1); DELETE FROM people WHERE id = 2",
    original,
  );
  await executeWithTransactionChanges(
    connection,
    null,
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

for (const [kind, target] of [
  ["mysql", "`demo`.`people`"],
  ["sqlite", '"main"."people"'],
  ["mssql", "[dbo].[people]"],
  ["oracle", '"APP"."PEOPLE"'],
] as const) {
  test(`${kind} INSERT displays the inserted row from the transaction snapshot`, async () => {
    const values = [{ id: "1", name: "old" }];
    handler = (sql) =>
      sql.startsWith("SELECT") ? result(values.map((row) => ({ ...row }))) : result();
    const original = mock(async () => {
      values.push({ id: "2", name: "new" });
      return result([], 1);
    });
    const tracked = await executeWithTransactionChanges(
      { ...connection, kind },
      null,
      "tx",
      `INSERT INTO ${target} (name) VALUES ('new')`,
      original,
    );
    expect(original).toHaveBeenCalledTimes(1);
    expect(tracked.changes).toEqual([
      {
        type: "insert",
        schema:
          kind === "sqlite" ? "main" : kind === "mysql" ? "demo" : kind === "mssql" ? "dbo" : "APP",
        table: kind === "oracle" ? "PEOPLE" : "people",
        rowValues: { id: "2", name: "new" },
        fromSql: true,
      },
    ]);
  });

  test(`${kind} UPDATE displays the before and after values`, async () => {
    let values = [{ id: "1", name: "old" }];
    handler = (sql) => (sql.startsWith("SELECT") ? result(values) : result());
    const tracked = await executeWithTransactionChanges(
      { ...connection, kind },
      null,
      "tx",
      `UPDATE ${target} SET name = 'new' WHERE id = 1`,
      async () => {
        values = [{ id: "1", name: "new" }];
        return result([], 1);
      },
    );
    expect(tracked.changes).toEqual([
      {
        type: "update",
        schema:
          kind === "sqlite" ? "main" : kind === "mysql" ? "demo" : kind === "mssql" ? "dbo" : "APP",
        table: kind === "oracle" ? "PEOPLE" : "people",
        oldValues: { name: "old" },
        newValues: { name: "new" },
        fromSql: true,
      },
    ]);
  });
}

test("DynamoDB PartiQL INSERT shows values as planned until commit", async () => {
  const original = mock(async () => result([], 1));
  const tracked = await executeWithTransactionChanges(
    { ...connection, kind: "dynamodb" },
    null,
    "tx",
    "INSERT INTO \"Orders\" VALUE {'pk': 'a', 'total': 5, 'meta': {'vip': true}}",
    original,
  );
  expect(original).toHaveBeenCalledTimes(1);
  expect(tracked.changes).toEqual([
    {
      type: "insert",
      table: "Orders",
      rowValues: { pk: "a", total: 5, meta: { vip: true } },
      fromSql: true,
      planned: true,
    },
  ]);
});

test("DynamoDB PartiQL UPDATE compares known old values with planned literals", async () => {
  handler = (sql) =>
    sql.startsWith("SELECT") ? result([{ pk: "a", total: 1, status: "old" }]) : result();
  const original = mock(async () => result([], 1));
  const tracked = await executeWithTransactionChanges(
    { ...connection, kind: "dynamodb" },
    null,
    "tx",
    'UPDATE "Orders" SET "total" = 5, "status" = \'new\' WHERE "pk" = \'a\'',
    original,
  );
  expect(original).toHaveBeenCalledTimes(1);
  expect(tracked.changes).toEqual([
    {
      type: "update",
      table: "Orders",
      oldValues: { total: 1, status: "old" },
      newValues: { total: "5", status: "new" },
      fromSql: true,
      planned: true,
    },
  ]);
});

test("DynamoDB transaction panel labels staged SQL without an affected-row claim", async () => {
  useTransactionStore.getState().addTransaction({
    txId: "tx",
    connectionId: connection.id,
    connectionName: connection.name,
    scope: { type: "query" },
    changes: [],
    startedAt: Date.now(),
  });
  await executeSqlWithTransactions({
    connection: { ...connection, kind: "dynamodb" },
    database: null,
    sql: "INSERT INTO \"Orders\" VALUE {'pk': 'a'}",
    transactionsCapable: true,
    onJob: () => {},
  });
  const changes = useTransactionStore.getState().transactions[0].changes;
  expect(changes.map((change) => change.type)).toEqual(["query", "insert"]);
  expect(changes[0]).toMatchObject({ planned: true, rowsAffected: null });
  expect(changes[1]).toMatchObject({ planned: true, rowValues: { pk: "a" } });
});

test("MySQL INSERT SET also records the resulting row", async () => {
  const rows = [{ id: "1", name: "old" }];
  handler = (sql) =>
    sql.startsWith("SELECT") ? result(rows.map((row) => ({ ...row }))) : result();
  const tracked = await executeWithTransactionChanges(
    { ...connection, kind: "mysql" },
    null,
    "tx",
    "INSERT INTO `demo`.`people` SET name = 'new'",
    async () => {
      rows.push({ id: "2", name: "new" });
      return result([], 1);
    },
  );
  expect(tracked.changes[0]?.rowValues).toEqual({ id: "2", name: "new" });
});

test("failed snapshot read executes a MySQL statement only once", async () => {
  handler = (sql) => {
    if (sql.startsWith("SELECT *")) throw new Error("read denied");
    return result();
  };
  const original = mock(async () => result([], 1));
  const tracked = await executeWithTransactionChanges(
    { ...connection, kind: "mysql" },
    null,
    "tx",
    "INSERT INTO people (name) VALUES ('new')",
    original,
  );
  expect(original).toHaveBeenCalledTimes(1);
  expect(calls.some((sql) => sql.startsWith("ROLLBACK TO SAVEPOINT"))).toBe(true);
  expect(tracked.changes).toEqual([]);
});

test("MySQL row key literals escape backslashes and quotes", async () => {
  const id = "x\\' OR 1=1 --";
  let rows = [{ id, name: "old" }];
  handler = (sql) =>
    sql.startsWith("SELECT *") ? result(rows.map((row) => ({ ...row }))) : result();
  await executeWithTransactionChanges(
    { ...connection, kind: "mysql" },
    null,
    "tx",
    "UPDATE `demo`.`people` SET name = 'new' WHERE id = 'safe'",
    async () => {
      rows = [{ id, name: "new" }];
      return result([], 1);
    },
  );
  expect(calls.find((sql) => sql.includes("WHERE (`id`"))).toContain("'x\\\\'' OR 1=1 --'");
});
