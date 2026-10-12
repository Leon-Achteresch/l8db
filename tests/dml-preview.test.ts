import { describe, expect, mock, test } from "bun:test";

interface PreviewCall {
  kind: string;
  connectionString: string;
  database?: string;
  request: { countSql: string; sampleSql: string; limit: number };
  options: Record<string, unknown>;
}

const calls: PreviewCall[] = [];
const cancels: string[] = [];
const backend: {
  searchPath: string | null;
  count: number;
  failWith: string | null;
  hold: ((error: Error) => void) | null;
  connections: { opened: number; closed: number };
} = {
  searchPath: null,
  count: 3,
  failWith: null,
  hold: null,
  connections: { opened: 0, closed: 0 },
};

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown>) => {
    if (command === "cancel_execution") {
      cancels.push(String(args.jobId));
      backend.hold?.(new Error("ERROR: canceling statement due to user request (SQLSTATE 57014)"));
      return true;
    }
    if (command !== "preview_dml") return null;
    calls.push(args as unknown as PreviewCall);
    backend.connections.opened++;
    try {
      if (backend.hold)
        await new Promise<never>((_, reject) => {
          backend.hold = reject;
        });
      if (backend.failWith) throw new Error(backend.failWith);
      return {
        count: {
          columns: ["affected_rows"],
          rows: [{ affected_rows: String(backend.count) }],
          rows_affected: null,
          execution_time_ms: 1,
        },
        sample:
          backend.count === 0
            ? null
            : {
                columns: ["id"],
                rows: [{ id: 1 }, { id: 2 }, { id: 3 }],
                rows_affected: null,
                execution_time_ms: 1,
              },
        readOnly: args.kind === "postgres",
        searchPath: backend.searchPath,
      };
    } finally {
      backend.connections.closed++;
    }
  },
}));

const {
  autoPreviewApplies,
  deriveDmlPreview,
  hasBindParameters,
  isDmlPreviewCancelled,
  isDmlPreviewUnavailable,
  MISSING_TABLE_REASON,
  needsDmlPreview,
  normalizeDmlPreviewMode,
  runDmlPreview,
} = await import("../src/lib/dml-preview");
const { attachPreviewLifecycle, createPreviewLifecycle } = await import(
  "../src/lib/dml-preview/lifecycle"
);
const { COMMITTED_STATE_NOTE, dmlPreviewExecutor, SESSION_VIEW_REASON } = await import(
  "../src/lib/dml-preview/executor"
);
const { LOCK_BLOCKED_REASON, LOCK_OTHER_REASON, SCHEMA_NOTE } = await import(
  "../src/lib/dml-preview"
);
const { useServerOutputStore } = await import("../src/lib/server-output");
const { useTransactionStore } = await import("../src/lib/transactions");
const { useSessionViewsStore, scopeKey } = await import("../src/lib/session-views");
const { editorBindParams } = await import("../src/lib/bind-params");
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

function response(count: number) {
  return {
    count: {
      columns: ["affected_rows"],
      rows: [{ affected_rows: String(count) }],
      rows_affected: null,
      execution_time_ms: 1,
    },
    sample:
      count === 0
        ? null
        : ({
            columns: ["id"],
            rows: [{ id: 1 }, { id: 2 }, { id: 3 }],
            rows_affected: null,
            execution_time_ms: 1,
          } as QueryResult),
    readOnly: true,
    searchPath: null,
  };
}

describe("runner", () => {
  test("one preview is one isolated call that carries count and sample", async () => {
    const plan = ready("DELETE FROM t WHERE id > 1", "postgres", 2);
    const seen: string[] = [];
    const outcome = await runDmlPreview(plan, {
      preview: async (queries) => {
        seen.push(queries.countSql, queries.sampleSql);
        return response(5);
      },
      cancel: async () => false,
    });
    expect(seen).toEqual([plan.countSql, plan.sampleSql]);
    expect(outcome).toMatchObject({ count: 5, requests: 1, readOnly: true });
    expect(outcome.sample.rows).toHaveLength(2);
    expect(outcome.sample.truncated).toBe(true);
  });

  test("zero affected rows return an empty sample", async () => {
    const outcome = await runDmlPreview(ready("DELETE FROM t WHERE false", "postgres"), {
      preview: async () => response(0),
      cancel: async () => false,
    });
    expect(outcome.count).toBe(0);
    expect(outcome.sample.rows).toEqual([]);
  });

  test("cancelling sends cancel_execution for the preview job only", async () => {
    const controller = new AbortController();
    let jobSeen = "";
    let reject: ((error: Error) => void) | null = null;
    const cancelled: string[] = [];
    const running = runDmlPreview(
      ready("DELETE FROM t WHERE id > 1", "postgres"),
      {
        preview: (_plan, jobId) => {
          jobSeen = jobId;
          return new Promise((_, rejectPreview) => {
            reject = rejectPreview;
          });
        },
        cancel: async (jobId) => {
          cancelled.push(jobId);
          reject?.(new Error("canceling statement due to user request"));
        },
      },
      { signal: controller.signal },
    );
    controller.abort();
    expect(isDmlPreviewCancelled(await running.catch((error: unknown) => error))).toBe(true);
    expect(cancelled).toEqual([jobSeen]);
  });

  test("an already aborted preview sends nothing", async () => {
    const controller = new AbortController();
    controller.abort();
    let calledPreview = 0;
    const error = await runDmlPreview(
      ready("DELETE FROM t", "postgres"),
      {
        preview: async () => {
          calledPreview++;
          return response(1);
        },
        cancel: async () => false,
      },
      { signal: controller.signal },
    ).catch((reason: unknown) => reason);
    expect(isDmlPreviewCancelled(error)).toBe(true);
    expect(calledPreview).toBe(0);
  });

  test("a table the isolated connection cannot see makes the preview unavailable", async () => {
    for (const message of [
      'ERROR: relation "scratch" does not exist (SQLSTATE 42P01)',
      "no such table: scratch",
      "ORA-00942: table or view does not exist",
      "Invalid object name '#scratch'.",
    ]) {
      const error = await runDmlPreview(ready("DELETE FROM scratch WHERE id > 1", "postgres"), {
        preview: async () => {
          throw new Error(message);
        },
        cancel: async () => false,
      }).catch((reason: unknown) => reason);
      expect(isDmlPreviewUnavailable(error)).toBe(true);
      expect(String(error)).toContain(MISSING_TABLE_REASON);
    }
  });
});

describe("isolated preview connection", () => {
  const connection = {
    id: "dml-preview-isolated",
    name: "PG",
    kind: "postgres" as const,
    connectionString: "postgresql://app@isolated.example.test:5432/app",
    sslMode: "prefer" as const,
  };

  test("the preview runs through preview_dml with its own job id and timeout", async () => {
    calls.length = 0;
    backend.count = 3;
    const plan = ready("DELETE FROM t WHERE id > 1", "postgres");
    const outcome = await runDmlPreview(plan, dmlPreviewExecutor(connection, "app", 7));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      kind: "postgres",
      connectionString: connection.connectionString,
      database: "app",
      request: { countSql: plan.countSql, sampleSql: plan.sampleSql, limit: plan.limit },
    });
    expect(calls[0].options.queryTimeout).toBe(7);
    expect(typeof calls[0].options.jobId).toBe("string");
    expect(calls[0].options).not.toHaveProperty("cancelMode");
    expect(outcome).toMatchObject({ count: 3, readOnly: true });
  });

  test("cancel discards the preview connection and nothing stays open", async () => {
    calls.length = 0;
    cancels.length = 0;
    backend.connections = { opened: 0, closed: 0 };
    backend.hold = () => undefined;
    const controller = new AbortController();
    const running = runDmlPreview(
      ready("DELETE FROM t WHERE id > 1", "postgres"),
      dmlPreviewExecutor(connection, "app", 10),
      { signal: controller.signal },
    ).catch((error: unknown) => error);
    while (calls.length === 0) await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();
    expect(isDmlPreviewCancelled(await running)).toBe(true);
    backend.hold = null;
    expect(cancels).toEqual([String(calls[0].options.jobId)]);
    expect(backend.connections).toEqual({ opened: 1, closed: 1 });
  });

  test("an open transaction or persistent editor session shows the committed-state note", () => {
    expect(dmlPreviewExecutor(connection, "app", 10).note).toBeNull();
    useTransactionStore.setState({
      transactions: [
        {
          txId: "tx-note",
          connectionId: connection.id,
          connectionName: "PG",
          database: "app",
          scope: { type: "query" },
          changes: [],
          startedAt: 0,
        },
      ],
    });
    expect(dmlPreviewExecutor(connection, "app", 10).note).toBe(COMMITTED_STATE_NOTE);
    useTransactionStore.setState({ transactions: [] });
    useServerOutputStore.getState().setEnabled(connection.id, true);
    expect(dmlPreviewExecutor(connection, "app", 10).note).toBe(COMMITTED_STATE_NOTE);
    useServerOutputStore.getState().setEnabled(connection.id, false);
  });

  test("a preview never sends statements into the user's transaction", async () => {
    calls.length = 0;
    useTransactionStore.setState({
      transactions: [
        {
          txId: "tx-isolated",
          connectionId: connection.id,
          connectionName: "PG",
          database: "app",
          scope: { type: "query" },
          changes: [],
          startedAt: 0,
        },
      ],
    });
    await runDmlPreview(
      ready("DELETE FROM t WHERE id > 1", "postgres"),
      dmlPreviewExecutor(connection, "app", 10),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toHaveProperty("txId");
    useTransactionStore.setState({ transactions: [] });
  });

  test("session views are expanded before the isolated preview runs", async () => {
    calls.length = 0;
    useSessionViewsStore.getState().add(scopeKey(connection.id, "app"), {
      name: "recent_orders",
      sql: "SELECT * FROM orders WHERE created > now() - interval '1 day'",
      columns: ["id"],
      createdAt: 0,
    });
    await runDmlPreview(
      ready("DELETE FROM orders WHERE id IN (SELECT id FROM recent_orders)", "postgres"),
      dmlPreviewExecutor(connection, "app", 10),
    );
    expect(calls[0].request.countSql.startsWith("WITH recent_orders AS (")).toBe(true);
    useSessionViewsStore.getState().clearConnection(connection.id);
  });
});

describe("preview lifecycle", () => {
  test("a newer dialog makes an older confirmation stale", () => {
    const lifecycle = createPreviewLifecycle();
    const first = lifecycle.next();
    const second = lifecycle.next();
    expect(lifecycle.decide(true, first)).toBe(false);
    expect(lifecycle.decide(true, second)).toBe(true);
    expect(lifecycle.decide(false, second)).toBe(false);
  });

  test("a disposed tab never runs the statement", () => {
    const lifecycle = createPreviewLifecycle();
    const token = lifecycle.next();
    lifecycle.dispose();
    expect(lifecycle.decide(true, token)).toBe(false);
    expect(lifecycle.decide(true, lifecycle.current())).toBe(false);
  });

  test("StrictMode mount, unmount and remount keeps a usable lifecycle", () => {
    const ref: { current: ReturnType<typeof createPreviewLifecycle> | null } = { current: null };
    const detachFirst = attachPreviewLifecycle(ref);
    const first = ref.current;
    detachFirst();
    expect(ref.current).toBe(first);
    expect(first?.disposed()).toBe(true);
    const detachSecond = attachPreviewLifecycle(ref);
    expect(ref.current).not.toBe(first);
    const token = ref.current?.next() ?? 0;
    expect(ref.current?.decide(true, token)).toBe(true);
    detachSecond();
    expect(ref.current?.decide(true, token)).toBe(false);
  });
});

describe("bind parameters", () => {
  test("editor and preview share one detection", () => {
    expect(hasBindParameters("DELETE FROM t WHERE id = :id")).toBe(true);
    expect(hasBindParameters("UPDATE t SET a = $1 WHERE id = $2")).toBe(true);
    expect(hasBindParameters("DELETE FROM t WHERE note = ':id'")).toBe(false);
    expect(editorBindParams("UPDATE t SET a = :new WHERE id = :id").map((ref) => ref.name)).toEqual(
      ["id"],
    );
  });
});

describe("isolated preview review fixes", () => {
  const connection = {
    id: "dml-preview-review",
    name: "PG",
    kind: "postgres" as const,
    connectionString: "postgresql://app@review.example.test:5432/app",
    sslMode: "prefer" as const,
  };
  const openTransaction = () =>
    useTransactionStore.setState({
      transactions: [
        {
          txId: "tx-review",
          connectionId: connection.id,
          connectionName: "PG",
          database: "app",
          scope: { type: "query" },
          changes: [],
          startedAt: 0,
        },
      ],
    });

  test("with an open transaction the preview uses a short lock timeout", async () => {
    calls.length = 0;
    await runDmlPreview(
      ready("DELETE FROM t WHERE id > 1", "postgres"),
      dmlPreviewExecutor(connection, "app", 10, 3),
    );
    expect(calls[0].request).not.toHaveProperty("lockTimeoutMs");
    expect(calls[0].options.queryTimeout).toBe(10);
    openTransaction();
    calls.length = 0;
    await runDmlPreview(
      ready("DELETE FROM t WHERE id > 1", "postgres"),
      dmlPreviewExecutor(connection, "app", 10, 3),
    );
    expect(calls[0].request.lockTimeoutMs).toBe(3000);
    expect(calls[0].options.queryTimeout).toBe(5);
    calls.length = 0;
    await runDmlPreview(
      ready("DELETE FROM t WHERE id > 1", "postgres"),
      dmlPreviewExecutor(connection, "app", 2, 3),
    );
    expect(calls[0].request.lockTimeoutMs).toBe(2000);
    useTransactionStore.setState({ transactions: [] });
  });

  test("a preview blocked by locks of the open transaction becomes unavailable", async () => {
    openTransaction();
    for (const message of [
      "ERROR: canceling statement due to lock timeout (SQLSTATE 55P03)",
      "Query-Timeout nach 5 Sekunden: Abfrage vom Server abgebrochen.",
      "Lock request time out period exceeded. (1222)",
    ]) {
      backend.failWith = message;
      const error = await runDmlPreview(
        ready("DELETE FROM t WHERE id > 1", "postgres"),
        dmlPreviewExecutor(connection, "app", 10, 3),
      ).catch((reason: unknown) => reason);
      expect(isDmlPreviewUnavailable(error)).toBe(true);
      expect(String(error)).toContain(LOCK_BLOCKED_REASON);
    }
    useTransactionStore.setState({ transactions: [] });
    backend.failWith = "Query-Timeout nach 10 Sekunden";
    const plain = await runDmlPreview(
      ready("DELETE FROM t WHERE id > 1", "postgres"),
      dmlPreviewExecutor(connection, "app", 10, 3),
    ).catch((reason: unknown) => reason);
    expect(isDmlPreviewUnavailable(plain)).toBe(false);
    backend.failWith = null;
  });

  test("the staging search_path of the editor session is applied or flagged", async () => {
    useServerOutputStore.getState().setEnabled(connection.id, true);
    backend.searchPath = "staging, public";
    const applied = await runDmlPreview(
      ready("DELETE FROM orders WHERE id > 1", "postgres"),
      dmlPreviewExecutor(connection, "app", 10, 3),
    );
    expect(applied.schemaNote).toBeNull();
    backend.searchPath = null;
    const unknown = await runDmlPreview(
      ready("DELETE FROM orders WHERE id > 1", "postgres"),
      dmlPreviewExecutor(connection, "app", 10, 3),
    );
    expect(unknown.schemaNote).toBe(SCHEMA_NOTE);
    const qualified = await runDmlPreview(
      ready("DELETE FROM staging.orders WHERE id > 1", "postgres"),
      dmlPreviewExecutor(connection, "app", 10, 3),
    );
    expect(qualified.schemaNote).toBeNull();
    useServerOutputStore.getState().setEnabled(connection.id, false);
    const idle = await runDmlPreview(
      ready("DELETE FROM orders WHERE id > 1", "postgres"),
      dmlPreviewExecutor(connection, "app", 10, 3),
    );
    expect(idle.schemaNote).toBeNull();
  });

  test("only undefined-table errors are treated as invisible tables", async () => {
    backend.failWith = 'ERROR: column "missing" does not exist (SQLSTATE 42703)';
    const error = await runDmlPreview(
      ready("DELETE FROM t WHERE id > 1", "postgres"),
      dmlPreviewExecutor(connection, "app", 10, 3),
    ).catch((reason: unknown) => reason);
    expect(isDmlPreviewUnavailable(error)).toBe(false);
    expect(String(error)).toContain("42703");
    backend.failWith = "Table 'app.scratch' doesn't exist (1146)";
    const mysql = await runDmlPreview(
      ready("DELETE FROM scratch WHERE id > 1", "mysql"),
      dmlPreviewExecutor({ ...connection, kind: "mysql" }, "app", 10, 3),
    ).catch((reason: unknown) => reason);
    expect(isDmlPreviewUnavailable(mysql)).toBe(true);
    backend.failWith = null;
  });

  test("session views are checked after expansion and never smuggle a COMMIT", async () => {
    calls.length = 0;
    useSessionViewsStore.getState().add(scopeKey(connection.id, "app"), {
      name: "evil",
      sql: "SELECT 1 AS id; COMMIT; DELETE FROM orders",
      columns: ["id"],
      createdAt: 0,
    });
    const error = await runDmlPreview(
      ready("DELETE FROM orders WHERE id IN (SELECT id FROM evil)", "postgres"),
      dmlPreviewExecutor(connection, "app", 10, 3),
    ).catch((reason: unknown) => reason);
    expect(isDmlPreviewUnavailable(error)).toBe(true);
    expect(String(error)).toContain(SESSION_VIEW_REASON);
    expect(calls).toHaveLength(0);
    useSessionViewsStore.getState().clearConnection(connection.id);
  });
});

describe("busy detection and lock classification", () => {
  const connection = {
    id: "dml-preview-busy",
    name: "PG",
    kind: "postgres" as const,
    connectionString: "postgresql://app@busy.example.test:5432/app",
    sslMode: "prefer" as const,
  };

  test("server output in autocommit keeps the normal timeout", async () => {
    useServerOutputStore.getState().setEnabled(connection.id, true);
    calls.length = 0;
    const executor = dmlPreviewExecutor(connection, "app", 10, 3);
    expect(executor.busy).toBe(false);
    expect(executor.note).toBe(COMMITTED_STATE_NOTE);
    await runDmlPreview(ready("DELETE FROM t WHERE id > 1", "postgres"), executor);
    expect(calls[0].request).not.toHaveProperty("lockTimeoutMs");
    expect(calls[0].options.queryTimeout).toBe(10);
    backend.failWith = "Query-Timeout nach 10 Sekunden";
    const timeout = await runDmlPreview(
      ready("DELETE FROM t WHERE id > 1", "postgres"),
      dmlPreviewExecutor(connection, "app", 10, 3),
    ).catch((reason: unknown) => reason);
    expect(isDmlPreviewUnavailable(timeout)).toBe(false);
    backend.failWith = null;
    useServerOutputStore.getState().setEnabled(connection.id, false);
  });

  test("locks are recognised by error class and blamed on the right session", async () => {
    backend.failWith = "ERROR: canceling statement due to lock timeout (SQLSTATE 55P03)";
    const other = await runDmlPreview(
      ready("DELETE FROM t WHERE id > 1", "postgres"),
      dmlPreviewExecutor(connection, "app", 10, 3),
    ).catch((reason: unknown) => reason);
    expect(String(other)).toContain(LOCK_OTHER_REASON);
    expect(String(other)).not.toContain(LOCK_BLOCKED_REASON);
    for (const message of ["ERROR 1205 rows matched", "value 1222 out of range"]) {
      backend.failWith = message;
      const plain = await runDmlPreview(
        ready("DELETE FROM t WHERE id > 1", "postgres"),
        dmlPreviewExecutor(connection, "app", 10, 3),
      ).catch((reason: unknown) => reason);
      expect(isDmlPreviewUnavailable(plain)).toBe(false);
    }
    backend.failWith = null;
  });

  test("a backend read-only rejection becomes a visible fallback", async () => {
    backend.failWith = "Vorschau nicht lesend: 'COMMENT' ist in der Vorschau nicht erlaubt.";
    const error = await runDmlPreview(
      ready("DELETE FROM t WHERE comment = 'x'", "postgres"),
      dmlPreviewExecutor(connection, "app", 10, 3),
    ).catch((reason: unknown) => reason);
    expect(isDmlPreviewUnavailable(error)).toBe(true);
    expect(String(error)).toContain("COMMENT");
    backend.failWith = null;
  });
});
