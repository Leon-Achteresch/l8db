import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import type { ColumnInfo, ForeignKeyInfo, TableInfo } from "../src/lib/db";
import { loadForeignKeys } from "../src/lib/monaco-intellisense/foreign-keys";
import {
  joinSuggestions,
  joinTables,
  limitMatches,
  type SqlObjectRegistry,
  scopeAt,
  statementBounds,
  suggestCompletions,
} from "../src/lib/sql-intellisense";

const TABLES = 3000;
const FOREIGN_KEYS = 20_000;
const table = (index: number) => `table_${String(index % TABLES).padStart(4, "0")}`;

function fixture() {
  const tables: TableInfo[] = Array.from({ length: TABLES }, (_, index) => ({
    schema: "public",
    name: table(index),
  }));
  const columns: ColumnInfo[] = tables.flatMap((info) =>
    ["id", "parent_id", "name", "status", "created_at", "amount", "owner_id"].map((name) => ({
      schema: "public",
      table: info.name,
      name,
      data_type: "integer",
    })),
  );
  const keys: ForeignKeyInfo[] = Array.from({ length: FOREIGN_KEYS }, (_, index) => ({
    constraint_name: `fk_${index}`,
    from_schema: "public",
    from_table: table(index),
    from_column: index % 2 ? "parent_id" : "owner_id",
    to_schema: "public",
    to_table: table(index * 7 + 1),
    to_column: "id",
  }));
  const byTable = new Map<string, ForeignKeyInfo[]>();
  for (const key of keys) {
    for (const name of new Set([key.from_table, key.to_table])) {
      const list = byTable.get(name);
      if (list) list.push(key);
      else byTable.set(name, [key]);
    }
  }
  const registry: SqlObjectRegistry = {
    schemas: ["public"],
    tables,
    views: [],
    columns,
    functions: [],
    procedures: [],
    dialect: "postgres",
  };
  return { registry, byTable };
}

function script(cursorStatement: string) {
  const block = (index: number) =>
    [
      `WITH recent_${index} AS (`,
      `  SELECT o.id, o.parent_id AS parent, count(*) cnt`,
      `  FROM ${table(index)} o`,
      `  WHERE o.id IN (SELECT t.id FROM ${table(index + 1)} t WHERE t.parent_id = o.id)`,
      `  GROUP BY o.id, o.parent_id`,
      `)`,
      `SELECT r.parent, x.name`,
      `FROM recent_${index} r`,
      `JOIN (SELECT id, name FROM ${table(index + 2)} WHERE id > 10) x ON x.id = r.parent`,
      `WHERE EXISTS (SELECT 1 FROM ${table(index + 3)} z WHERE z.id = r.id);`,
    ].join("\n");
  const blocks = Array.from({ length: 500 }, (_, index) => block(index));
  blocks.splice(250, 0, cursorStatement);
  const marked = blocks.join("\n");
  return { sql: marked.replace("|", ""), offset: marked.indexOf("|") };
}

function complete(registry: SqlObjectRegistry, sql: string, offset: number) {
  const bounds = statementBounds(sql, offset, registry.dialect);
  const statement = sql.slice(bounds.start, bounds.end);
  const local = offset - bounds.start;
  const before = statement.slice(0, local);
  const scope = scopeAt(statement, local, registry.dialect);
  const items = suggestCompletions(
    registry,
    before,
    before.slice(before.lastIndexOf("\n") + 1),
    [],
    scope,
  );
  return { scope, items };
}

const NESTED_JOIN = [
  "WITH deep AS (",
  "  SELECT s.* FROM (",
  `    SELECT a.id FROM ${table(10)} a JOIN ${table(71)} b ON b.id = a.id JOIN ${table(498)} c ON |`,
  "  ) s",
  ")",
  "SELECT * FROM deep;",
].join("\n");

test("completion stays fast on a 5,000-line script with nested CTEs and 20,000 foreign keys", async () => {
  const { registry, byTable } = fixture();
  const { sql, offset } = script(NESTED_JOIN);
  const lines = sql.split("\n").length;
  const keys = (tables: TableInfo[]) => tables.flatMap((info) => byTable.get(info.name) ?? []);
  let joinCount = 0;
  let suggestionCount = 0;
  const joinCompletion = await measureScenario(() => {
    const { scope, items } = complete(registry, sql, offset);
    const join = scope.join;
    if (!join) throw new Error("join context expected");
    const conditions = joinSuggestions(registry, join, keys(joinTables(registry, join)));
    joinCount = conditions.length;
    suggestionCount = limitMatches(conditions.concat(items), "", 300).items.length;
  }, 15);
  const dotSql = script("SELECT t.| FROM table_0001 t WHERE t.id IN (SELECT id FROM table_0002);");
  let dotColumns: string[] = [];
  const columnCompletion = await measureScenario(() => {
    dotColumns = complete(registry, dotSql.sql, dotSql.offset).items.map((item) => item.label);
  }, 15);
  const cteSql = script(
    "WITH a AS (SELECT id AS ident, name FROM table_0002), b AS (SELECT * FROM a) SELECT q.| FROM a q;",
  );
  const cteColumns = complete(registry, cteSql.sql, cteSql.offset).items.map((item) => item.label);

  Bun.gc(true);
  const heapBefore = process.memoryUsage().heapUsed;
  for (let index = 0; index < 200; index++) complete(registry, sql, offset);
  Bun.gc(true);
  const retainedBytes = process.memoryUsage().heapUsed - heapBefore;

  await reportScenario("sql-intellisense-completion", {
    lines,
    sqlCharacters: sql.length,
    tables: TABLES,
    columns: registry.columns.length,
    foreignKeys: FOREIGN_KEYS,
    joinConditions: joinCount,
    suggestions: suggestionCount,
    retainedBytes,
    joinCompletion,
    columnCompletion,
  });
  expect(lines).toBeGreaterThanOrEqual(5000);
  expect(joinCount).toBeGreaterThan(0);
  expect(suggestionCount).toBe(300);
  expect(cteColumns).toEqual(["ident", "name"]);
  expect(dotColumns).toHaveLength(7);
  expect(joinCompletion.p95Ms).toBeLessThan(60);
  expect(columnCompletion.p95Ms).toBeLessThan(40);
  expect(retainedBytes).toBeLessThan(8 * 1024 * 1024);
}, 120_000);

test("foreign keys load once per table per cache period with bounded concurrency", async () => {
  const { registry, byTable } = fixture();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const requests: string[] = [];
  let active = 0;
  let maxConcurrency = 0;
  const fetch = async (_schema: string, name: string) => {
    requests.push(name);
    active++;
    maxConcurrency = Math.max(maxConcurrency, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return byTable.get(name) ?? [];
  };
  const tables = Array.from({ length: 8 }, (_, index) => registry.tables[index * 11]);
  const first = performance.now();
  const loaded = await loadForeignKeys(
    client,
    "perf",
    null,
    tables,
    new AbortController().signal,
    fetch,
    () => undefined,
  );
  const coldMs = performance.now() - first;
  const coldRequests = requests.length;
  const cached = await measureScenario(async () => {
    const signal = new AbortController().signal;
    await loadForeignKeys(client, "perf", null, tables, signal, fetch, () => undefined);
  }, 15);
  await reportScenario("sql-intellisense-foreign-keys", {
    tables: tables.length,
    foreignKeys: loaded.length,
    coldRequests,
    cachedRequests: requests.length - coldRequests,
    maxConcurrency,
    coldMs,
    cached,
  });
  expect(coldRequests).toBe(tables.length);
  expect(requests.length).toBe(coldRequests);
  expect(maxConcurrency).toBeLessThanOrEqual(2);
  expect(cached.p95Ms).toBeLessThan(5);
  client.clear();
});

test("closing the completion popup cancels foreign key requests and frees the queue", async () => {
  const { registry, byTable } = fixture();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const requests: string[] = [];
  const cancelled: string[] = [];
  const pending = new Map<string, () => void>();
  let active = 0;
  let maxConcurrency = 0;
  const fetch = (_schema: string, name: string, jobId: string) => {
    requests.push(name);
    active++;
    maxConcurrency = Math.max(maxConcurrency, active);
    return new Promise<ForeignKeyInfo[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        active--;
        resolve(byTable.get(name) ?? []);
      }, 5_000);
      pending.set(jobId, () => {
        clearTimeout(timer);
        active--;
        reject(new Error("Abfrage abgebrochen"));
      });
    });
  };
  const cancel = (jobId: string) => {
    cancelled.push(jobId);
    pending.get(jobId)?.();
  };
  const controller = new AbortController();
  const aborted = loadForeignKeys(
    client,
    "perf",
    null,
    registry.tables.slice(0, 8),
    controller.signal,
    fetch,
    cancel,
  );
  await new Promise((resolve) => setTimeout(resolve, 1));
  controller.abort();
  await expect(aborted).rejects.toThrow();
  const dispatched = requests.length;
  const fastFetch = async (_schema: string, name: string) => {
    requests.push(name);
    return byTable.get(name) ?? [];
  };
  const next = performance.now();
  const loaded = await loadForeignKeys(
    client,
    "perf",
    null,
    registry.tables.slice(20, 22),
    new AbortController().signal,
    fastFetch,
    cancel,
  );
  const nextMs = performance.now() - next;
  await reportScenario("sql-intellisense-foreign-keys-cancel", {
    dispatchedBeforeAbort: dispatched,
    cancelled: cancelled.length,
    maxConcurrency,
    nextRequestMs: nextMs,
  });
  expect(dispatched).toBeLessThanOrEqual(2);
  expect(cancelled).toHaveLength(dispatched);
  expect(active).toBe(0);
  expect(loaded.length).toBeGreaterThan(0);
  expect(nextMs).toBeLessThan(1_000);
  expect(requests.length).toBe(dispatched + 2);
  expect(client.isFetching()).toBe(0);
  client.clear();
});
