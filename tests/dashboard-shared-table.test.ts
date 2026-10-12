import { expect, test } from "bun:test";
import type { Dashboard } from "../src/lib/dashboards";
import {
  createSharedTableSql,
  listSharedDashboards,
  loadSharedDashboard,
  type SqlRunner,
  saveSharedDashboard,
  supportsSharedDashboards,
} from "../src/lib/dashboards/shared-table";
import type { QueryResult } from "../src/lib/db/types";

function result(rows: Record<string, unknown>[] = []): QueryResult {
  return { columns: [], rows, rows_affected: null, execution_time_ms: 0 };
}

function recorder(respond: (sql: string) => QueryResult | Error = () => result()) {
  const calls: { sql: string; params?: string[] }[] = [];
  const runner: SqlRunner = async (sql, params) => {
    calls.push({ sql, params });
    const response = respond(sql);
    if (response instanceof Error) throw response;
    return response;
  };
  return { calls, runner };
}

function dashboard(widgets = 0): Dashboard {
  return {
    id: "local",
    connectionId: "conn",
    database: "app",
    name: "It's $2 Sales",
    datasets: [],
    widgets: Array.from({ length: widgets }, (_, i) => ({
      id: `w${i}`,
      title: `Widget ${i} 'quoted' \\ path`,
    })) as unknown as Dashboard["widgets"],
    refreshSec: 0,
    locked: false,
    createdAt: 0,
  };
}

test("only relational families get the shared table", () => {
  expect(supportsSharedDashboards("postgres")).toBe(true);
  expect(supportsSharedDashboards("mongodb")).toBe(false);
  expect(supportsSharedDashboards(null)).toBe(false);
  expect(createSharedTableSql("mssql")).toContain("IF OBJECT_ID(N'l8_dashboards'");
  expect(createSharedTableSql("oracle")).toContain("-955");
  expect(createSharedTableSql("sqlite")).toContain("CREATE TABLE IF NOT EXISTS l8_dashboards");
});

test("first save creates the table and inserts with bound params on postgres", async () => {
  const { calls, runner } = recorder((sql) =>
    sql.startsWith("SELECT") ? new Error('relation "l8_dashboards" does not exist') : result(),
  );
  await saveSharedDashboard("postgres", runner, "shared-1", dashboard());
  expect(calls).toHaveLength(3);
  expect(calls[1].sql).toContain("CREATE TABLE IF NOT EXISTS l8_dashboards");
  expect(calls[2].sql).toStartWith("INSERT INTO l8_dashboards");
  expect(calls[2].params?.[0]).toBe("It's $2 Sales");
  expect(calls[2].params?.[2]).toBe("shared-1");
});

test("existing rows are updated with escaped literals on sqlite", async () => {
  const { calls, runner } = recorder((sql) =>
    sql.startsWith("SELECT") ? result([{ id: "shared-1" }]) : result(),
  );
  await saveSharedDashboard("sqlite", runner, "shared-1", dashboard());
  expect(calls).toHaveLength(2);
  expect(calls[1].params).toBeUndefined();
  expect(calls[1].sql).toStartWith("UPDATE l8_dashboards SET name = 'It''s $2 Sales'");
  expect(calls[1].sql).toEndWith("WHERE id = 'shared-1'");
});

test("save failures other than a missing table propagate", async () => {
  const { calls, runner } = recorder(() => new Error("permission denied for table l8_dashboards"));
  await expect(saveSharedDashboard("postgres", runner, "x", dashboard())).rejects.toThrow(
    "permission denied",
  );
  expect(calls).toHaveLength(1);
});

test("listing reads only metadata and treats a missing table as empty", async () => {
  const missing = recorder(() => new Error("ORA-00942: table or view does not exist"));
  expect(await listSharedDashboards(missing.runner)).toEqual([]);
  const oracle = recorder(() => result([{ ID: "a", NAME: "Ops", UPDATED_AT: "5" }]));
  expect(await listSharedDashboards(oracle.runner)).toEqual([
    { id: "a", name: "Ops", updatedAt: 5 },
  ]);
  expect(oracle.calls[0].sql).not.toContain("content");
});

test("load parses stored content", async () => {
  const { runner } = recorder(() =>
    result([{ content: JSON.stringify({ name: "Ops", datasets: [], widgets: [] }) }]),
  );
  expect((await loadSharedDashboard("mysql", runner, "a")).name).toBe("Ops");
  const empty = recorder();
  await expect(loadSharedDashboard("mysql", empty.runner, "a")).rejects.toThrow();
});

test("perf: saving a 500-widget dashboard stays bounded", async () => {
  const large = dashboard(500);
  const timings: number[] = [];
  let requests = 0;
  for (let i = 0; i < 40; i++) {
    const { calls, runner } = recorder((sql) =>
      sql.startsWith("SELECT") ? result([{ id: "s" }]) : result(),
    );
    const started = performance.now();
    await saveSharedDashboard("mysql", runner, "s", large);
    timings.push(performance.now() - started);
    requests = Math.max(requests, calls.length);
  }
  timings.sort((a, b) => a - b);
  const median = timings[Math.floor(timings.length / 2)];
  const p95 = timings[Math.floor(timings.length * 0.95)];
  console.log(`shared save 500 widgets: median ${median.toFixed(2)}ms p95 ${p95.toFixed(2)}ms`);
  expect(requests).toBe(2);
  expect(median).toBeLessThan(20);
  expect(p95).toBeLessThan(50);
});
