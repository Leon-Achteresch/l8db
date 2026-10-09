import { beforeEach, expect, mock, test } from "bun:test";
import type { SavedConnection } from "../src/lib/connections";
import type { QueryResult } from "../src/lib/db";

const calls: string[] = [];
let handler: (sql: string) => QueryResult = () => result();
let databaseChanges: unknown = [];

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
    if (command === "transaction_database_changes") {
      calls.push(command);
      return databaseChanges;
    }
  },
}));

const { databaseChangesFrom, executeWithTransactionChanges } = await import(
  "../src/lib/transaction-sql-changes"
);
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
  databaseChanges = [];
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

  test(`${kind} DELETE lists the removed rows`, async () => {
    handler = (sql) => (sql.startsWith("SELECT") ? result([{ id: "1", name: "old" }]) : result());
    const tracked = await executeWithTransactionChanges(
      { ...connection, kind },
      null,
      "tx",
      `DELETE FROM ${target} WHERE id = 1`,
      async () => result([], 1),
    );
    expect(tracked.changes).toEqual([
      {
        type: "delete",
        schema:
          kind === "sqlite" ? "main" : kind === "mysql" ? "demo" : kind === "mssql" ? "dbo" : "APP",
        table: kind === "oracle" ? "PEOPLE" : "people",
        oldValues: { id: "1", name: "old" },
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

test("PostgreSQL DELETE returns the removed rows", async () => {
  handler = (sql) =>
    sql.startsWith("SELECT") || sql.includes("RETURNING *")
      ? result([{ id: "1", name: "old" }])
      : result();
  const tracked = await executeWithTransactionChanges(
    connection,
    null,
    "tx",
    "DELETE FROM public.people WHERE id = 1",
    async () => result(),
  );
  expect(calls).toContain("DELETE FROM public.people WHERE id = 1\nRETURNING *");
  expect(tracked.changes).toEqual([
    {
      type: "delete",
      schema: "public",
      table: "people",
      oldValues: { id: "1", name: "old" },
      fromSql: true,
    },
  ]);
});

test("PostgreSQL DELETE over 100 rows runs unchanged without returning rows", async () => {
  handler = (sql) =>
    sql.startsWith("SELECT") ? result(Array.from({ length: 101 }, (_, id) => ({ id }))) : result();
  const original = mock(async () => result([], 101));
  const tracked = await executeWithTransactionChanges(
    connection,
    null,
    "tx",
    "DELETE FROM people",
    original,
  );
  expect(original).toHaveBeenCalledTimes(1);
  expect(calls.some((sql) => sql.includes("RETURNING"))).toBe(false);
  expect(tracked.changes).toEqual([]);
});

test("database diff pairs rows by primary key into updates, inserts and deletes", () => {
  const { changes, notes } = databaseChangesFrom([
    {
      schema: "APP",
      table: "ORDERS",
      key_columns: ["ID"],
      added: [
        { ID: 1, STATE: "moved" },
        { ID: 3, STATE: "new" },
      ],
      removed: [
        { ID: 1, STATE: "open" },
        { ID: 2, STATE: "gone" },
      ],
      note: null,
    },
    {
      schema: "APP",
      table: "LOG",
      key_columns: [],
      added: [{ MSG: "a" }],
      removed: [{ MSG: "b" }],
      note: "Mehr als 100 geänderte Zeilen; nur die ersten werden gezeigt.",
    },
  ]);
  expect(changes).toEqual([
    {
      type: "update",
      schema: "APP",
      table: "ORDERS",
      fromSql: true,
      rowKey: "ID 1",
      oldValues: { STATE: "open" },
      newValues: { STATE: "moved" },
    },
    {
      type: "insert",
      schema: "APP",
      table: "ORDERS",
      fromSql: true,
      rowValues: { ID: 3, STATE: "new" },
    },
    {
      type: "delete",
      schema: "APP",
      table: "ORDERS",
      fromSql: true,
      oldValues: { ID: 2, STATE: "gone" },
    },
    { type: "insert", schema: "APP", table: "LOG", fromSql: true, rowValues: { MSG: "a" } },
    { type: "delete", schema: "APP", table: "LOG", fromSql: true, oldValues: { MSG: "b" } },
  ]);
  expect(notes).toEqual(["APP.LOG: Mehr als 100 geänderte Zeilen; nur die ersten werden gezeigt."]);
});

test("Oracle PL/SQL block in a transaction shows the database diff once", async () => {
  useTransactionStore.getState().addTransaction({
    txId: "tx",
    connectionId: connection.id,
    connectionName: connection.name,
    scope: { type: "query" },
    changes: [],
    startedAt: Date.now(),
  });
  databaseChanges = [
    {
      schema: "APP",
      table: "WA_VERLADUNG",
      key_columns: ["ID"],
      added: [{ ID: 1884, ORDER_ID: 473435 }],
      removed: [{ ID: 1884, ORDER_ID: 1 }],
      note: null,
    },
  ];
  handler = () => ({ ...result(), rows_affected: null });
  await executeSqlWithTransactions({
    connection: { ...connection, kind: "oracle" },
    database: null,
    sql: "DECLARE res INTEGER; BEGIN res := PA.MOVE_ORDER(1884); END;",
    transactionsCapable: true,
    onJob: () => {},
  });
  const tx = useTransactionStore.getState().transactions[0];
  expect(calls.filter((call) => call === "transaction_database_changes")).toHaveLength(1);
  expect(tx.changes[0]).toMatchObject({ type: "query", rowsAffected: null });
  expect(tx.databaseChanges?.changes).toMatchObject([
    {
      type: "update",
      table: "WA_VERLADUNG",
      oldValues: { ORDER_ID: 1 },
      newValues: { ORDER_ID: "473435" },
    },
  ]);
});

test("database diff pairing stays fast for many changed tables", () => {
  const tables = Array.from({ length: 50 }, (_, table) => ({
    schema: "APP",
    table: `T${table}`,
    key_columns: ["ID"],
    added: Array.from({ length: 100 }, (_, id) =>
      Object.fromEntries([
        ["ID", id],
        ...Array.from({ length: 30 }, (_, c) => [`C${c}`, `new${c}`]),
      ]),
    ),
    removed: Array.from({ length: 100 }, (_, id) =>
      Object.fromEntries([
        ["ID", id + 50],
        ...Array.from({ length: 30 }, (_, c) => [`C${c}`, `old${c}`]),
      ]),
    ),
    note: null,
  }));
  const durations: number[] = [];
  for (let run = 0; run < 15; run += 1) {
    const started = performance.now();
    const { changes } = databaseChangesFrom(tables);
    durations.push(performance.now() - started);
    expect(changes).toHaveLength(50 * 150);
  }
  durations.sort((a, b) => a - b);
  const median = durations[7];
  const p95 = durations[14];
  console.log(
    `database diff 50x200 rows: median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`,
  );
  expect(median).toBeLessThan(40);
  expect(p95).toBeLessThan(80);
});
