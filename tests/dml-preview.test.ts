import { describe, expect, mock, test } from "bun:test";

const invocations: { command: string; args: Record<string, unknown> }[] = [];
let pendingQuery: (() => void) | null = null;
const failing = { savepoint: false, count: false };

interface FakeSession {
  inBlock: boolean;
  aborted: boolean;
  searchPath: string[];
  temp: Set<string>;
  savepoints: Set<string>;
  timeoutNext: boolean;
  log: string[];
}

function fakeSession(): FakeSession {
  return {
    inBlock: false,
    aborted: false,
    searchPath: ["public"],
    temp: new Set(),
    savepoints: new Set(),
    timeoutNext: false,
    log: [],
  };
}

const pg: {
  active: boolean;
  editor: FakeSession;
  pooled: FakeSession;
  countGate: Promise<void> | null;
} = { active: false, editor: fakeSession(), pooled: fakeSession(), countGate: null };
const TABLE_ROWS: Record<string, number> = {
  "public.orders": 3,
  "tenant_x.orders": 7,
  "My Schema.orders": 11,
};

function splitPath(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .map((part) =>
      part.startsWith('"') ? part.slice(1, -1).replace(/""/g, '"') : part.toLowerCase(),
    );
}

function runFakePg(session: FakeSession, sql: string) {
  session.log.push(sql.replace(/l8db_preview_[0-9a-f]{32}/g, "SP"));
  const fail = (message: string): never => {
    if (session.inBlock) session.aborted = true;
    throw new Error(message);
  };
  if (/^BEGIN$/i.test(sql)) {
    session.inBlock = true;
    return { columns: [], rows: [], rows_affected: null, execution_time_ms: 0 };
  }
  const savepoint = /^(SAVEPOINT|ROLLBACK TO SAVEPOINT|RELEASE SAVEPOINT) (\w+)$/i.exec(sql);
  if (savepoint) {
    const [, verb, name] = savepoint;
    if (!session.inBlock)
      throw new Error("ERROR: SAVEPOINT can only be used in transaction blocks (SQLSTATE 25P01)");
    if (verb.startsWith("ROLLBACK")) session.aborted = false;
    else if (session.aborted) fail("current transaction is aborted (SQLSTATE 25P02)");
    else if (verb === "SAVEPOINT") session.savepoints.add(name);
    else session.savepoints.delete(name);
    return { columns: [], rows: [], rows_affected: null, execution_time_ms: 0 };
  }
  const setPath = /^SET\s+search_path\s*(?:=|\s+TO\s+)\s*(.+)$/i.exec(sql);
  if (setPath) {
    session.searchPath = splitPath(setPath[1]);
    return { columns: [], rows: [], rows_affected: null, execution_time_ms: 0 };
  }
  if (session.aborted) fail("current transaction is aborted (SQLSTATE 25P02)");
  if (session.timeoutNext) {
    session.timeoutNext = false;
    fail("Query-Timeout nach 10 Sekunden.");
  }
  const table = /FROM\s+(\w+)/i.exec(sql)?.[1] ?? "";
  const resolved = session.temp.has(table)
    ? 5
    : session.searchPath.map((schema) => TABLE_ROWS[`${schema}.${table}`]).find((n) => n);
  if (resolved === undefined) fail(`relation "${table}" does not exist (SQLSTATE 42P01)`);
  if (sql.startsWith("SELECT COUNT(*)"))
    return {
      columns: ["affected_rows"],
      rows: [{ affected_rows: String(resolved) }],
      rows_affected: null,
      execution_time_ms: 1,
    };
  return { columns: ["id"], rows: [{ id: 1 }], rows_affected: null, execution_time_ms: 1 };
}

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown>) => {
    invocations.push({ command, args });
    if (pg.active && command === "execute_query") {
      if (pg.countGate && String(args.sql).startsWith("SELECT COUNT(*)")) await pg.countGate;
      return runFakePg(args.pooled ? pg.pooled : pg.editor, String(args.sql));
    }
    if (command === "cancel_execution") {
      pendingQuery?.();
      return true;
    }
    if (command === "execute_in_transaction") {
      const sql = String(args.sql);
      if (failing.savepoint && sql.startsWith("SAVEPOINT")) throw new Error("savepoint rejected");
      if (failing.count && sql.startsWith("SELECT COUNT(*)"))
        throw new Error("current transaction is aborted");
      if (!sql.startsWith("SELECT"))
        return { columns: [], rows: [], rows_affected: null, execution_time_ms: 0 };
    }
    if (command === "execute_query" || command === "execute_in_transaction") {
      if (String(args.sql).startsWith("SELECT COUNT(*)"))
        return {
          columns: ["affected_rows"],
          rows: [{ affected_rows: "3" }],
          rows_affected: null,
          execution_time_ms: 1,
        };
      return {
        columns: ["id"],
        rows: [{ id: 1 }, { id: 2 }, { id: 3 }],
        rows_affected: null,
        execution_time_ms: 1,
      };
    }
    return null;
  },
}));

const {
  autoPreviewApplies,
  deriveDmlPreview,
  isDmlPreviewCancelled,
  needsDmlPreview,
  normalizeDmlPreviewMode,
  runDmlPreview,
  hasBindParameters,
} = await import("../src/lib/dml-preview");
const { attachPreviewLifecycle, createPreviewLifecycle } = await import(
  "../src/lib/dml-preview/lifecycle"
);
const { useServerOutputStore } = await import("../src/lib/server-output");
const { editorBindParams } = await import("../src/lib/bind-params");
const { dmlPreviewExecutor, OUTSIDE_TRANSACTION_NOTE, previewSavepoint, previewSession } =
  await import("../src/lib/dml-preview/executor");
const { useTransactionStore } = await import("../src/lib/transactions");
const { useSessionViewsStore, scopeKey } = await import("../src/lib/session-views");
type QueryResult = import("../src/lib/db/types").QueryResult;

function ready(sql: string, dialect: string, limit = 100) {
  const derived = deriveDmlPreview(sql, dialect, limit);
  if (derived?.status !== "ready") throw new Error(`Not derivable: ${JSON.stringify(derived)}`);
  return derived;
}

function unavailable(sql: string, dialect: string) {
  const derived = deriveDmlPreview(sql, dialect);
  if (derived?.status !== "unavailable") throw new Error(`Unexpectedly derivable: ${sql}`);
  return derived;
}

function compact(sql: string) {
  return sql.replace(/\s+/g, " ").trim();
}

describe("PostgreSQL", () => {
  test("UPDATE … FROM joins the target and shows old and new values", () => {
    const plan = ready(
      `UPDATE public.users AS u SET name = 'neu', score = score + 1 FROM teams t WHERE u.team_id = t.id AND t.name = 'A';`,
      "postgres",
    );
    expect(plan.countSql).toBe(
      "SELECT COUNT(*) AS affected_rows FROM public.users AS u, teams t WHERE u.team_id = t.id AND t.name = 'A'",
    );
    expect(compact(plan.sampleSql)).toBe(
      `SELECT u.name AS "name (alt)", ('neu') AS "name (neu)", u.score AS "score (alt)", (score + 1) AS "score (neu)", u.* FROM public.users AS u, teams t WHERE u.team_id = t.id AND t.name = 'A' LIMIT 100`,
    );
    expect(plan.whereMissing).toBe(false);
    expect(plan.note).toContain("mehrfach");
    expect(plan.table).toBe("public.users");
  });

  test("DELETE … USING keeps the joined source", () => {
    const plan = ready(
      "DELETE FROM orders o USING customers c WHERE o.customer_id = c.id AND c.blocked",
      "postgres",
    );
    expect(plan.countSql).toBe(
      "SELECT COUNT(*) AS affected_rows FROM orders o, customers c WHERE o.customer_id = c.id AND c.blocked",
    );
    expect(compact(plan.sampleSql)).toBe(
      "SELECT o.* FROM orders o, customers c WHERE o.customer_id = c.id AND c.blocked LIMIT 100",
    );
  });

  test("RETURNING is dropped and sequences are never evaluated", () => {
    const plan = ready("UPDATE t SET a = nextval('s'), b = 2 WHERE id = 1 RETURNING *", "postgres");
    expect(plan.countSql).toBe("SELECT COUNT(*) AS affected_rows FROM t WHERE id = 1");
    expect(plan.sampleSql).not.toContain("nextval");
    expect(plan.assignments).toEqual([
      { column: "a", expression: "nextval('s')", previewed: false },
      { column: "b", expression: "2", previewed: true },
    ]);
    expect(unavailable("DELETE FROM t WHERE id = nextval('s')", "postgres").reason).toContain(
      "NEXTVAL",
    );
  });

  test("unknown functions in WHERE fall back instead of running side effects", () => {
    const fallback = unavailable("DELETE FROM t WHERE audit_and_check(id)", "postgres");
    expect(fallback.reason).toContain("audit_and_check");
    expect(
      ready("DELETE FROM t WHERE lower(name) = 'x' AND created < now()", "postgres").countSql,
    ).toContain("lower(name)");
  });
});

describe("MySQL", () => {
  test("UPDATE with JOIN, ORDER BY and LIMIT bounds count and sample", () => {
    const plan = ready(
      "UPDATE t1 JOIN t2 ON t1.id = t2.id SET t1.a = t2.b WHERE t2.c > 3 ORDER BY t1.id LIMIT 10",
      "mysql",
    );
    expect(plan.countSql).toBe(
      "SELECT COUNT(*) AS affected_rows FROM (SELECT 1 AS l8db_row FROM t1 JOIN t2 ON t1.id = t2.id WHERE t2.c > 3 ORDER BY t1.id LIMIT 10) l8db_preview",
    );
    expect(compact(plan.sampleSql)).toBe(
      "SELECT * FROM (SELECT t1.a AS `a (alt)`, (t2.b) AS `a (neu)`, t1.* FROM t1 JOIN t2 ON t1.id = t2.id WHERE t2.c > 3 ORDER BY t1.id LIMIT 10) l8db_preview LIMIT 100",
    );
  });

  test("multi-table DELETE previews the deleted table only", () => {
    const plan = ready("DELETE t1 FROM t1 JOIN t2 ON t1.id = t2.id WHERE t2.x = 'a'", "mysql");
    expect(compact(plan.sampleSql)).toBe(
      "SELECT t1.* FROM t1 JOIN t2 ON t1.id = t2.id WHERE t2.x = 'a' LIMIT 100",
    );
    const using = ready("DELETE FROM t1 USING t1 JOIN t2 USING (id) WHERE t2.x = 1", "mysql");
    expect(using.countSql).toBe(
      "SELECT COUNT(*) AS affected_rows FROM t1 JOIN t2 USING (id) WHERE t2.x = 1",
    );
  });

  test("backslash escapes and hash comments do not hide clauses", () => {
    const plan = ready(
      String.raw`DELETE FROM logs # WHERE id = 1
WHERE msg = 'it\'s WHERE x'`,
      "mysql",
    );
    expect(plan.countSql).toBe(
      String.raw`SELECT COUNT(*) AS affected_rows FROM logs WHERE msg = 'it\'s WHERE x'`,
    );
  });
});

describe("SQL Server", () => {
  test("UPDATE TOP keeps the bound and strips locking hints", () => {
    const plan = ready(
      "UPDATE TOP (10) [dbo].[users] WITH (UPDLOCK) SET [name] = N'x' WHERE id > 5",
      "mssql",
    );
    expect(plan.countSql).toBe(
      "SELECT COUNT(*) AS affected_rows FROM (SELECT TOP (10) 1 AS l8db_row FROM [dbo].[users] WHERE id > 5) l8db_preview",
    );
    expect(plan.sampleSql).toBe(
      "SELECT TOP (100) * FROM (SELECT TOP (10) [users].[name] AS [name (alt)], (N'x') AS [name (neu)], [users].* FROM [dbo].[users] WHERE id > 5) l8db_preview",
    );
    expect(plan.sampleSql).not.toMatch(/UPDLOCK|HOLDLOCK|FOR UPDATE/i);
  });

  test("DELETE TOP … PERCENT and aliased DELETE … FROM", () => {
    expect(ready("DELETE TOP (5) PERCENT FROM dbo.t WHERE x = 1", "mssql").countSql).toBe(
      "SELECT COUNT(*) AS affected_rows FROM (SELECT TOP (5) PERCENT 1 AS l8db_row FROM dbo.t WHERE x = 1) l8db_preview",
    );
    const aliased = ready("DELETE a FROM dbo.t a JOIN dbo.x ON a.id = x.id WHERE x.y = 1", "mssql");
    expect(aliased.sampleSql).toBe(
      "SELECT TOP (100) a.* FROM dbo.t a JOIN dbo.x ON a.id = x.id WHERE x.y = 1",
    );
  });

  test("UPDATE alias FROM uses the FROM clause as source", () => {
    const plan = ready("UPDATE a SET a.v = x.v FROM dbo.t a JOIN dbo.x x ON a.id = x.id", "mssql");
    expect(plan.countSql).toBe(
      "SELECT COUNT(*) AS affected_rows FROM dbo.t a JOIN dbo.x x ON a.id = x.id",
    );
    expect(plan.whereMissing).toBe(true);
    expect(ready("UPDATE dbo.t SET v = 1 FROM dbo.x WHERE dbo.t.id = x.id", "mssql").countSql).toBe(
      "SELECT COUNT(*) AS affected_rows FROM dbo.t, dbo.x WHERE dbo.t.id = x.id",
    );
  });
});

describe("SQLite", () => {
  test("UPDATE OR action and INSERT … SELECT … ON CONFLICT", () => {
    const update = ready("UPDATE OR IGNORE items SET qty = qty - 1 WHERE qty > 0", "sqlite");
    expect(update.countSql).toBe("SELECT COUNT(*) AS affected_rows FROM items WHERE qty > 0");
    const insert = ready(
      "INSERT INTO archive (id) SELECT id FROM log WHERE ts < date('now') ON CONFLICT DO NOTHING",
      "sqlite",
    );
    expect(insert.kind).toBe("insert_select");
    expect(insert.countSql).toBe(
      "SELECT COUNT(*) AS affected_rows FROM (SELECT id FROM log WHERE ts < date('now')) l8db_preview",
    );
    expect(needsDmlPreview("INSERT INTO t VALUES (1)", "sqlite")).toBe(false);
    expect(needsDmlPreview("INSERT INTO t DEFAULT VALUES", "sqlite")).toBe(false);
  });
});

describe("Oracle", () => {
  test("DELETE without FROM, FETCH FIRST sampling and RETURNING INTO", () => {
    const plan = ready("DELETE emp e WHERE e.dept = 10", "oracle");
    expect(compact(plan.sampleSql)).toBe(
      "SELECT * FROM emp e WHERE e.dept = 10 FETCH FIRST 100 ROWS ONLY",
    );
    const update = ready(
      "UPDATE emp SET sal = sal * 1.1 WHERE dept IN (10, 20) RETURNING sal INTO :v",
      "oracle",
    );
    expect(update.countSql).toBe(
      "SELECT COUNT(*) AS affected_rows FROM emp WHERE dept IN (10, 20)",
    );
    expect(
      unavailable(
        "UPDATE emp SET id = emp_seq.NEXTVAL WHERE id IS NULL AND emp_seq.NEXTVAL > 0",
        "oracle",
      ).reason,
    ).toContain("NEXTVAL");
  });

  test("MERGE counts matched target rows", () => {
    const plan = ready(
      "MERGE INTO emp e USING (SELECT * FROM bonus) b ON (e.id = b.id) WHEN MATCHED THEN UPDATE SET e.sal = b.sal",
      "oracle",
    );
    expect(plan.countSql).toBe(
      "SELECT COUNT(*) AS affected_rows FROM emp e INNER JOIN (SELECT * FROM bonus) b ON (e.id = b.id)",
    );
    expect(plan.note).toContain("WHEN MATCHED");
  });
});

describe("edge cases", () => {
  test("quoted identifiers named like keywords", () => {
    const plan = ready(`UPDATE "Where" SET "set" = 1 WHERE "from" = 'x'`, "postgres");
    expect(plan.countSql).toBe(`SELECT COUNT(*) AS affected_rows FROM "Where" WHERE "from" = 'x'`);
    expect(plan.sampleSql).toContain(`"Where"."set" AS "set (alt)"`);
    const mysql = ready("DELETE FROM `order` WHERE `where` = 1", "mysql");
    expect(mysql.countSql).toBe("SELECT COUNT(*) AS affected_rows FROM `order` WHERE `where` = 1");
  });

  test("subqueries in WHERE stay intact and do not end the clause", () => {
    const plan = ready(
      "DELETE FROM t WHERE id IN (SELECT id FROM x WHERE y = 1 ORDER BY z LIMIT 5) AND EXISTS (SELECT 1 FROM w WHERE w.t = t.id)",
      "postgres",
    );
    expect(plan.countSql).toBe(
      "SELECT COUNT(*) AS affected_rows FROM t WHERE id IN (SELECT id FROM x WHERE y = 1 ORDER BY z LIMIT 5) AND EXISTS (SELECT 1 FROM w WHERE w.t = t.id)",
    );
  });

  test("string literals containing WHERE do not count as filter", () => {
    const plan = ready("UPDATE t SET note = 'WHERE id = 1'", "postgres");
    expect(plan.whereMissing).toBe(true);
    expect(plan.countSql).toBe("SELECT COUNT(*) AS affected_rows FROM t");
    expect(ready("DELETE FROM t WHERE note = $$WHERE; DELETE$$", "postgres").whereMissing).toBe(
      false,
    );
  });

  test("comments are removed before clauses are appended", () => {
    const plan = ready(
      "-- remove old rows\nDELETE /* all? */ FROM t -- WHERE id = 1\n WHERE /* keep */ id > 5 -- trailing",
      "postgres",
    );
    expect(plan.countSql).toBe("SELECT COUNT(*) AS affected_rows FROM t WHERE id > 5");
    expect(compact(plan.sampleSql)).toBe("SELECT * FROM t WHERE id > 5 LIMIT 100");
    expect(ready("DELETE FROM t -- WHERE id = 1", "postgres").whereMissing).toBe(true);
  });

  test("multiple statements fall back with a reason and still flag missing WHERE", () => {
    const fallback = unavailable("UPDATE t SET a = 1 WHERE id = 1; DELETE FROM t;", "postgres");
    expect(fallback.reason).toContain("mehrere Anweisungen");
    expect(fallback.whereMissing).toBe(true);
    expect(deriveDmlPreview("SELECT 1; SELECT 2", "postgres")).toBeNull();
  });

  test("CTE-DML, cursors and statements without a table fall back", () => {
    expect(
      unavailable("WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d", "postgres").reason,
    ).toContain("CTE");
    expect(
      unavailable(
        "WITH x AS (SELECT 1 AS id) UPDATE t SET a = 1 FROM x WHERE t.id = x.id",
        "postgres",
      ).reason,
    ).toContain("CTE");
    expect(unavailable("UPDATE t SET a = 1 WHERE CURRENT OF c", "postgres").reason).toContain(
      "Cursor",
    );
    expect(unavailable("UPDATE SET a = 1", "postgres").reason).toContain("Zieltabelle");
    expect(unavailable("DELETE FROM WHERE id = 1", "postgres").reason).toContain("Zieltabelle");
  });

  test("derived queries are always read-only and never lock rows", () => {
    for (const [sql, dialect] of [
      ["UPDATE t SET a = 1 WHERE id = 1", "postgres"],
      ["DELETE FROM t WHERE id = 1", "mysql"],
      ["UPDATE TOP (1) t SET a = 1", "mssql"],
      ["DELETE FROM t WHERE id = 1", "oracle"],
      ["DELETE FROM t WHERE id = 1", "sqlite"],
    ] as const) {
      const plan = ready(sql, dialect);
      for (const query of [plan.countSql, plan.sampleSql]) {
        expect(query).toMatch(/^SELECT /);
        expect(query).not.toMatch(/FOR UPDATE|UPDLOCK|HOLDLOCK|XLOCK/i);
      }
    }
  });

  test("the sample limit is bounded", () => {
    expect(ready("DELETE FROM t", "postgres", 5000).limit).toBe(1000);
    expect(compact(ready("DELETE FROM t", "postgres", 7).sampleSql)).toBe(
      "SELECT * FROM t LIMIT 7",
    );
  });
});

describe("policy", () => {
  test("modes respect the production environment", () => {
    expect(normalizeDmlPreviewMode("bogus")).toBe("production");
    expect(autoPreviewApplies("production", true)).toBe(true);
    expect(autoPreviewApplies("production", false)).toBe(false);
    expect(autoPreviewApplies("always", false)).toBe(true);
    expect(autoPreviewApplies("off", true)).toBe(false);
  });
});

function result(rows: Record<string, unknown>[], columns: string[]): QueryResult {
  return { columns, rows, rows_affected: null, execution_time_ms: 1 };
}

describe("runner", () => {
  test("one preview issues exactly a count and a sample request", async () => {
    const plan = ready("DELETE FROM t WHERE id > 1", "postgres", 2);
    const calls: string[] = [];
    const outcome = await runDmlPreview(plan, {
      execute: async (sql) => {
        calls.push(sql);
        return sql.startsWith("SELECT COUNT")
          ? result([{ affected_rows: 5 }], ["affected_rows"])
          : result([{ id: 1 }, { id: 2 }, { id: 3 }], ["id"]);
      },
      cancel: async () => false,
    });
    expect(calls).toEqual([plan.countSql, plan.sampleSql]);
    expect(new Set(calls).size).toBe(2);
    expect(outcome.requests).toBe(2);
    expect(outcome.count).toBe(5);
    expect(outcome.sample.rows).toHaveLength(2);
    expect(outcome.sample.truncated).toBe(true);
  });

  test("zero affected rows skip the sample request", async () => {
    const calls: string[] = [];
    const outcome = await runDmlPreview(ready("DELETE FROM t WHERE false", "postgres"), {
      execute: async (sql) => {
        calls.push(sql);
        return result([{ affected_rows: "0" }], ["affected_rows"]);
      },
      cancel: async () => false,
    });
    expect(outcome.count).toBe(0);
    expect(calls).toHaveLength(1);
  });

  test("cancelling during the count cancels the job and never starts the sample", async () => {
    const plan = ready("DELETE FROM t WHERE id > 1", "postgres");
    const controller = new AbortController();
    const executed: string[] = [];
    const cancelled: string[] = [];
    let release: (() => void) | null = null;
    const running = runDmlPreview(
      plan,
      {
        execute: (sql, jobId) => {
          executed.push(`${jobId}:${sql}`);
          return new Promise<QueryResult>((_, reject) => {
            release = () => reject(new Error("abgebrochen"));
          });
        },
        cancel: async (jobId) => {
          cancelled.push(jobId);
          release?.();
          return true;
        },
      },
      { signal: controller.signal },
    );
    await Promise.resolve();
    controller.abort();
    const error = await running.catch((reason: unknown) => reason);
    expect(isDmlPreviewCancelled(error)).toBe(true);
    expect(executed).toHaveLength(1);
    expect(cancelled).toEqual([executed[0].split(":")[0]]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(executed).toHaveLength(1);
  });

  test("an already aborted preview sends no request", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const error = await runDmlPreview(
      ready("DELETE FROM t", "postgres"),
      {
        execute: async () => {
          calls++;
          return result([], []);
        },
        cancel: async () => false,
      },
      { signal: controller.signal },
    ).catch((reason: unknown) => reason);
    expect(isDmlPreviewCancelled(error)).toBe(true);
    expect(calls).toBe(0);
  });
});

describe("executor", () => {
  const connection = {
    id: "dml-preview-pg",
    name: "PG",
    kind: "postgres" as const,
    connectionString: "postgresql://app@db.example.test:5432/app",
    sslMode: "prefer" as const,
  };

  test("uses the editor session with a bounded timeout and no confirmation", async () => {
    invocations.length = 0;
    const plan = ready("DELETE FROM t WHERE id > 1", "postgres");
    const outcome = await runDmlPreview(plan, dmlPreviewExecutor(connection, "app", 7));
    const queries = invocations.filter((entry) => entry.command === "execute_query");
    expect(queries.map((entry) => entry.args.sql)).toEqual([plan.countSql, plan.sampleSql]);
    for (const entry of queries) {
      expect(entry.args.pooled).toBe(true);
      expect(entry.args.database).toBe("app");
      expect((entry.args.options as Record<string, unknown>).queryTimeout).toBe(7);
      expect(typeof (entry.args.options as Record<string, unknown>).jobId).toBe("string");
    }
    expect(outcome.count).toBe(3);
  });

  test("abort sends cancel_execution for the running job", async () => {
    invocations.length = 0;
    const controller = new AbortController();
    const executor = dmlPreviewExecutor(connection, null, 10);
    const slow = {
      ...executor,
      execute: (sql: string, jobId: string) =>
        new Promise<QueryResult>((resolve, reject) => {
          pendingQuery = () => reject(new Error("abgebrochen"));
          void executor.execute(sql, jobId).then(() => undefined);
          setTimeout(() => resolve(result([], [])), 1000);
        }),
    };
    const running = runDmlPreview(ready("DELETE FROM t", "postgres"), slow, {
      signal: controller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();
    expect(isDmlPreviewCancelled(await running.catch((reason: unknown) => reason))).toBe(true);
    const cancel = invocations.find((entry) => entry.command === "cancel_execution");
    const query = invocations.find((entry) => entry.command === "execute_query");
    expect(cancel?.args.jobId).toBe(
      (query?.args.options as Record<string, unknown> | undefined)?.jobId,
    );
    expect(invocations.filter((entry) => entry.command === "execute_query")).toHaveLength(1);
    pendingQuery = null;
  });
});

describe("review fixes", () => {
  const connection = {
    id: "dml-preview-tx",
    name: "PG",
    kind: "postgres" as const,
    connectionString: "postgresql://app@tx.example.test:5432/app",
    sslMode: "prefer" as const,
  };
  const openTransaction = () =>
    useTransactionStore.setState({
      transactions: [
        {
          txId: "tx-1",
          connectionId: connection.id,
          connectionName: "PG",
          database: "app",
          scope: { type: "query" },
          changes: [],
          startedAt: 0,
        },
      ],
    });
  const sqlOf = (command: string) =>
    invocations
      .filter((entry) => entry.command === command)
      .map((entry) => String(entry.args.sql).replace(/l8db_preview_[0-9a-f]{32}/g, "SP"));

  test("inside an open transaction the preview is wrapped in a savepoint", async () => {
    openTransaction();
    invocations.length = 0;
    const plan = ready("DELETE FROM t WHERE id > 1", "postgres");
    await runDmlPreview(plan, dmlPreviewExecutor(connection, "app", 10));
    expect(sqlOf("execute_in_transaction")).toEqual([
      "SAVEPOINT SP",
      plan.countSql,
      plan.sampleSql,
      "RELEASE SAVEPOINT SP",
    ]);
    expect(sqlOf("execute_query")).toEqual([]);
    useTransactionStore.setState({ transactions: [] });
  });

  test("a failed preview rolls back to the savepoint before the error surfaces", async () => {
    openTransaction();
    invocations.length = 0;
    failing.count = true;
    const plan = ready("DELETE FROM t WHERE id > 1", "postgres");
    const error = await runDmlPreview(plan, dmlPreviewExecutor(connection, "app", 10)).catch(
      (reason: unknown) => reason,
    );
    failing.count = false;
    expect(String(error)).toContain("aborted");
    expect(sqlOf("execute_in_transaction")).toEqual([
      "SAVEPOINT SP",
      plan.countSql,
      "ROLLBACK TO SAVEPOINT SP",
      "RELEASE SAVEPOINT SP",
    ]);
    useTransactionStore.setState({ transactions: [] });
  });

  test("without a usable savepoint the preview runs outside the transaction and says so", async () => {
    openTransaction();
    invocations.length = 0;
    failing.savepoint = true;
    const executor = dmlPreviewExecutor(connection, "app", 10);
    await runDmlPreview(ready("DELETE FROM t WHERE id > 1", "postgres"), executor);
    failing.savepoint = false;
    expect(executor.note).toBe(OUTSIDE_TRANSACTION_NOTE);
    expect(sqlOf("execute_in_transaction")).toEqual(["SAVEPOINT SP"]);
    expect(sqlOf("execute_query")).toHaveLength(2);
    expect(previewSavepoint("mssql")?.begin).toMatch(
      /^SAVE TRANSACTION l8db_preview_[0-9a-f]{32}$/,
    );
    expect(previewSavepoint("oracle")?.release).toBeNull();
    expect(previewSavepoint("dynamodb")).toBeNull();
    useTransactionStore.setState({ transactions: [] });
  });

  test("session views are expanded like in the editor run", async () => {
    useSessionViewsStore.getState().add(scopeKey(connection.id, "app"), {
      name: "recent_orders",
      sql: "SELECT * FROM orders WHERE created > now() - interval '1 day'",
      columns: ["id"],
      createdAt: 0,
    });
    invocations.length = 0;
    await runDmlPreview(
      ready("DELETE FROM orders WHERE id IN (SELECT id FROM recent_orders)", "postgres"),
      dmlPreviewExecutor(connection, "app", 10),
    );
    const [count] = sqlOf("execute_query");
    expect(count.startsWith("WITH recent_orders AS (")).toBe(true);
    expect(count).toContain("interval '1 day'");
    useSessionViewsStore.getState().clearConnection(connection.id);
  });

  test("bind parameters are detected for the manual preview fallback", () => {
    expect(hasBindParameters("DELETE FROM t WHERE id = :id")).toBe(true);
    expect(hasBindParameters("UPDATE t SET a = $1 WHERE id = $2")).toBe(true);
    expect(hasBindParameters("DELETE FROM t WHERE note = ':id'")).toBe(false);
    expect(hasBindParameters("DELETE FROM t WHERE id = 1")).toBe(false);
  });
});

describe("second review fixes", () => {
  const connection = {
    id: "dml-preview-tx2",
    name: "PG",
    kind: "postgres" as const,
    connectionString: "postgresql://app@tx2.example.test:5432/app",
    sslMode: "prefer" as const,
  };
  const transaction = (txId: string) => ({
    txId,
    connectionId: connection.id,
    connectionName: "PG",
    database: "app",
    scope: { type: "query" as const },
    changes: [],
    startedAt: 0,
  });

  test("a failing preview does not mark the user's transaction as failed", async () => {
    useTransactionStore.setState({ transactions: [transaction("tx-2")], panelOpen: false });
    failing.count = true;
    await runDmlPreview(
      ready("DELETE FROM t WHERE id > 1", "postgres"),
      dmlPreviewExecutor(connection, "app", 10),
    ).catch(() => undefined);
    failing.count = false;
    const state = useTransactionStore.getState();
    expect(state.transactions[0].lastError).toBeUndefined();
    expect(state.panelOpen).toBe(false);
    useTransactionStore.setState({ transactions: [] });
  });

  test("DuckDB and sqlite_http have no preview savepoint, names are unique", () => {
    expect(previewSavepoint("duckdb")).toBeNull();
    expect(previewSavepoint("sqlite_http")).toBeNull();
    expect(previewSavepoint("postgres")?.name).not.toBe(previewSavepoint("postgres")?.name);
  });

  test("a commit during the preview switches to running outside without rollback", async () => {
    useTransactionStore.setState({ transactions: [transaction("tx-3")] });
    invocations.length = 0;
    const executor = dmlPreviewExecutor(connection, "app", 10);
    const plan = ready("DELETE FROM t WHERE id > 1", "postgres");
    await executor.open?.();
    useTransactionStore.setState({ transactions: [] });
    await executor.execute(plan.countSql, "job-a");
    await executor.close?.(true);
    expect(executor.note).toBe(OUTSIDE_TRANSACTION_NOTE);
    const tx = invocations.filter((entry) => entry.command === "execute_in_transaction");
    expect(tx).toHaveLength(1);
    expect(invocations.filter((entry) => entry.command === "execute_query")).toHaveLength(1);
  });

  test("editor and preview share one bind parameter detection", () => {
    expect(editorBindParams("UPDATE t SET a = :new WHERE id = :id").map((ref) => ref.name)).toEqual(
      ["id"],
    );
    expect(hasBindParameters("UPDATE t SET a = :new")).toBe(false);
  });
});

describe("preview session handling", () => {
  const connection = {
    id: "dml-preview-session",
    name: "PG",
    kind: "postgres" as const,
    connectionString: "postgresql://app@session.example.test:5432/app",
    sslMode: "prefer" as const,
  };
  const withEditorSession = async (setup: (session: FakeSession) => void, sql: string) => {
    pg.active = true;
    pg.editor = fakeSession();
    pg.pooled = fakeSession();
    setup(pg.editor);
    useServerOutputStore.getState().setEnabled(connection.id, true);
    try {
      const executor = dmlPreviewExecutor(connection, "app", 10);
      const outcome = await runDmlPreview(ready(sql, "postgres"), executor).catch(
        (error: unknown) => error,
      );
      return { outcome, executor };
    } finally {
      useServerOutputStore.getState().setEnabled(connection.id, false);
      pg.active = false;
    }
  };

  test("only a persistent editor session or a transaction leaves the pool", () => {
    expect(previewSession(connection, "app")).toBe("pooled");
    useServerOutputStore.getState().setEnabled(connection.id, true);
    expect(previewSession(connection, "app")).toBe("editor-session");
    useServerOutputStore.getState().setEnabled(connection.id, false);
  });

  test("temporary tables of the editor session are visible to the preview", async () => {
    const { outcome } = await withEditorSession(
      (session) => session.temp.add("scratch"),
      "DELETE FROM scratch WHERE id > 1",
    );
    expect((outcome as { count: number }).count).toBe(5);
    expect(pg.pooled.log).toEqual([]);
  });

  test("search_path set without spaces and with quoted schemas is honoured", async () => {
    const compact = await withEditorSession(
      (session) => runFakePg(session, "SET search_path=tenant_x"),
      "DELETE FROM orders WHERE id > 1",
    );
    expect((compact.outcome as { count: number }).count).toBe(7);
    const quoted = await withEditorSession(
      (session) => runFakePg(session, 'SET search_path TO "My Schema", public'),
      "DELETE FROM orders WHERE id > 1",
    );
    expect((quoted.outcome as { count: number }).count).toBe(11);
  });

  test("in autocommit the savepoint probe fails harmlessly and nothing is rolled back", async () => {
    const { outcome, executor } = await withEditorSession(
      () => undefined,
      "DELETE FROM orders WHERE id > 1",
    );
    expect((outcome as { count: number }).count).toBe(3);
    expect(pg.editor.log.map((sql) => sql.split(" ")[0])).toEqual([
      "SAVEPOINT",
      "SELECT",
      "SELECT",
    ]);
    expect(executor.holdsSession?.()).toBe(false);
  });

  test("a manual BEGIN stays healthy after a failing preview", async () => {
    const { outcome } = await withEditorSession(
      (session) => runFakePg(session, "BEGIN"),
      "DELETE FROM missing_table WHERE id > 1",
    );
    expect(String(outcome)).toContain("does not exist");
    expect(pg.editor.log).toEqual([
      "BEGIN",
      "SAVEPOINT SP",
      expect.stringContaining("SELECT COUNT(*)"),
      "ROLLBACK TO SAVEPOINT SP",
      "RELEASE SAVEPOINT SP",
    ]);
    expect(pg.editor).toMatchObject({ inBlock: true, aborted: false });
    expect(pg.editor.savepoints.size).toBe(0);
  });

  test("a manual BEGIN stays healthy after a preview timeout", async () => {
    const { outcome } = await withEditorSession((session) => {
      runFakePg(session, "BEGIN");
      session.timeoutNext = true;
    }, "DELETE FROM orders WHERE id > 1");
    expect(String(outcome)).toContain("Query-Timeout");
    expect(pg.editor).toMatchObject({ inBlock: true, aborted: false });
    pg.active = true;
    expect(() => runFakePg(pg.editor, "SELECT COUNT(*) FROM orders")).not.toThrow();
    pg.active = false;
  });
});

describe("preview lifecycle ordering", () => {
  const plan = { countSql: "SELECT COUNT(*) FROM t", sampleSql: "SELECT * FROM t", limit: 10 };
  function deferredVoid() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }
  function fakeExecutor(name: string, log: string[], closeGate?: Promise<void>) {
    let holding = false;
    return {
      holdsSession: () => holding,
      open: async () => {
        holding = true;
        log.push(`${name}:SAVEPOINT`);
      },
      close: async () => {
        await closeGate;
        log.push(`${name}:RELEASE`);
        holding = false;
      },
      execute: async (sql: string) => {
        log.push(`${name}:${sql.startsWith("SELECT COUNT") ? "COUNT" : "SAMPLE"}`);
        return {
          columns: ["n"],
          rows: [{ n: 1 }],
          rows_affected: null,
          execution_time_ms: 0,
        };
      },
      cancel: async () => false,
    };
  }

  test("a new preview sends its savepoint only after the previous release finished", async () => {
    const log: string[] = [];
    const gate = deferredVoid();
    const lifecycle = createPreviewLifecycle();
    const first = lifecycle.start(plan, fakeExecutor("a", log, gate.promise));
    const second = lifecycle.start(plan, fakeExecutor("b", log));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(log).toEqual(["a:SAVEPOINT", "a:COUNT", "a:SAMPLE"]);
    gate.resolve();
    await Promise.all([first, second]);
    expect(log).toEqual([
      "a:SAVEPOINT",
      "a:COUNT",
      "a:SAMPLE",
      "a:RELEASE",
      "b:SAVEPOINT",
      "b:COUNT",
      "b:SAMPLE",
      "b:RELEASE",
    ]);
  });

  test("the confirmed run waits until the release completed", async () => {
    const log: string[] = [];
    const gate = deferredVoid();
    const lifecycle = createPreviewLifecycle();
    void lifecycle.start(plan, fakeExecutor("a", log, gate.promise));
    await new Promise((resolve) => setTimeout(resolve, 5));
    const settlement = lifecycle.settle(true);
    expect(settlement.wait).toBe(true);
    let decided: boolean | null = null;
    void settlement.decision.then((value) => {
      decided = value;
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(decided).toBeNull();
    gate.resolve();
    await settlement.decision;
    expect(decided).toBe(true);
    expect(log.at(-1)).toBe("a:RELEASE");
    expect(lifecycle.holding()).toBe(false);
    expect(lifecycle.settle(true).wait).toBe(false);
  });

  test("a stale finish cannot run after a newer dialog opened", async () => {
    const gate = deferredVoid();
    const lifecycle = createPreviewLifecycle();
    lifecycle.next();
    void lifecycle.start(plan, fakeExecutor("a", [], gate.promise));
    await new Promise((resolve) => setTimeout(resolve, 5));
    const stale = lifecycle.settle(true);
    lifecycle.next();
    gate.resolve();
    expect(await stale.decision).toBe(false);
  });

  test("closing the tab resolves pending runs with false and starts nothing new", async () => {
    const log: string[] = [];
    const gate = deferredVoid();
    const lifecycle = createPreviewLifecycle();
    void lifecycle.start(plan, fakeExecutor("a", log, gate.promise));
    await new Promise((resolve) => setTimeout(resolve, 5));
    const pending = lifecycle.settle(true);
    lifecycle.dispose();
    const late = lifecycle.start(plan, fakeExecutor("b", log)).catch((error: unknown) => error);
    gate.resolve();
    expect(await pending.decision).toBe(false);
    expect(isDmlPreviewCancelled(await late)).toBe(true);
    expect(log.some((entry) => entry.startsWith("b:"))).toBe(false);
  });
});

describe("third review fixes", () => {
  const connection = {
    id: "dml-preview-r4",
    name: "PG",
    kind: "postgres" as const,
    connectionString: "postgresql://app@r4.example.test:5432/app",
    sslMode: "prefer" as const,
  };

  test("the confirmed run waits while a preview statement is in flight on the editor session", async () => {
    pg.active = true;
    pg.editor = fakeSession();
    let release!: () => void;
    pg.countGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    useServerOutputStore.getState().setEnabled(connection.id, true);
    const lifecycle = createPreviewLifecycle();
    const running = lifecycle.start(
      ready("DELETE FROM orders WHERE id > 1", "postgres"),
      dmlPreviewExecutor(connection, "app", 10),
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    const settlement = lifecycle.settle(true);
    expect(settlement.wait).toBe(true);
    release();
    await running;
    expect(await settlement.decision).toBe(true);
    expect(lifecycle.holding()).toBe(false);
    pg.countGate = null;
    pg.active = false;
    useServerOutputStore.getState().setEnabled(connection.id, false);
  });

  test("every preview statement asks for a statement-only cancel", async () => {
    invocations.length = 0;
    await runDmlPreview(
      ready("DELETE FROM t WHERE id > 1", "postgres"),
      dmlPreviewExecutor(connection, "app", 10),
    );
    const queries = invocations.filter((entry) => entry.command === "execute_query");
    expect(queries.length).toBeGreaterThan(0);
    for (const entry of queries)
      expect((entry.args.options as Record<string, unknown>).cancelMode).toBe("statement");
  });

  test("session and transaction are read when the preview opens, not when it is created", async () => {
    pg.active = true;
    pg.editor = fakeSession();
    pg.pooled = fakeSession();
    const executor = dmlPreviewExecutor(connection, "app", 10);
    useServerOutputStore.getState().setEnabled(connection.id, true);
    await runDmlPreview(ready("DELETE FROM orders WHERE id > 1", "postgres"), executor);
    expect(pg.editor.log.length).toBeGreaterThan(0);
    expect(pg.pooled.log).toEqual([]);
    useServerOutputStore.getState().setEnabled(connection.id, false);
    pg.active = false;
  });

  test("the editor session path is gated by a capability", () => {
    const mysql = { ...connection, id: "dml-preview-my", kind: "mysql" as const };
    useServerOutputStore.getState().setEnabled(mysql.id, true);
    expect(previewSession(mysql, "app")).toBe("pooled");
    useServerOutputStore.getState().setEnabled(mysql.id, false);
  });

  test("StrictMode mount, unmount and remount keeps a usable lifecycle", async () => {
    const ref: { current: ReturnType<typeof createPreviewLifecycle> | null } = { current: null };
    const detachFirst = attachPreviewLifecycle(ref);
    const first = ref.current;
    detachFirst();
    expect(ref.current).toBeNull();
    const detachSecond = attachPreviewLifecycle(ref);
    expect(ref.current).not.toBe(first);
    const outcome = await ref.current?.start(
      { countSql: "SELECT COUNT(*) FROM t", sampleSql: "SELECT * FROM t", limit: 1 },
      {
        execute: async () => ({
          columns: ["n"],
          rows: [{ n: 0 }],
          rows_affected: null,
          execution_time_ms: 0,
        }),
        cancel: async () => false,
      },
    );
    expect(outcome?.count).toBe(0);
    expect(await ref.current?.settle(true).decision).toBe(true);
    detachSecond();
    expect(await first?.settle(true).decision).toBe(false);
  });
});
