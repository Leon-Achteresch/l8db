import { heapStats } from "bun:jsc";
import { beforeEach, expect, mock, test } from "bun:test";
import { arch, cpus, platform, release, totalmem } from "node:os";
import type { SavedConnection } from "../src/lib/connections";
import type { QueryResult } from "../src/lib/db";
import { measureScenario, reportScenario } from "./fixtures/usage-performance";

const FULL_ROWS = 200_000;
const fullResult: QueryResult = {
  columns: ["id", "name"],
  rows: Array.from({ length: FULL_ROWS }, (_, id) => ({ id, name: `name-${id}` })),
  rows_affected: null,
  execution_time_ms: 1,
};
const requests: { command: string; sql?: string }[] = [];
let hold: ((value: QueryResult) => void) | null = null;
let holding = false;

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown> = {}) => {
    requests.push({ command, sql: typeof args.sql === "string" ? args.sql : undefined });
    if (command === "execute_query") {
      if (holding) return new Promise<QueryResult>((resolve) => (hold = resolve));
      return fullResult;
    }
    return true;
  },
}));

const toastActions: (() => void)[] = [];
mock.module("sonner", () => {
  const noop = () => 1;
  return {
    toast: Object.assign(noop, {
      loading: (_: string, data?: { action?: { onClick: () => void } }) => {
        if (data?.action) toastActions.push(data.action.onClick);
        return 1;
      },
      success: noop,
      info: noop,
      error: noop,
      dismiss: noop,
    }),
  };
});

const { executeSqlWithTransactions } = await import("../src/features/query/query-view/execute-sql");
const { loadFullResult } = await import("../src/features/query/query-view/load-full-result");
const { autosizeColumnWidth, AUTOSIZE_SAMPLE } = await import("../src/lib/column-header-width");
const { createGridWindowRange } = await import("../src/lib/grid-window-range");
const { useSettingsStore } = await import("../src/lib/settings");

const connection: SavedConnection = {
  id: "perf-row-limit",
  name: "Perf row limit",
  kind: "postgres",
  connectionString: "postgres://localhost/test",
  sslMode: "disable",
};
const environment = {
  os: platform(),
  release: release(),
  arch: arch(),
  cpu: cpus()[0]?.model,
  ramBytes: totalmem(),
  bun: Bun.version,
};
const executes = () => requests.filter((entry) => entry.command === "execute_query").length;

beforeEach(() => {
  requests.length = 0;
  holding = false;
  hold = null;
  useSettingsStore.setState({ transactionsEnabled: false });
});

test("autosize over 100,000 loaded rows measures a bounded sample", async () => {
  const rows = Array.from({ length: 100_000 }, (_, id) => ({
    value: `value-${id}-${"x".repeat(id % 40)}`,
  }));
  let formatted = 0;
  let measuredCells = 0;
  const format = (value: unknown) => {
    formatted++;
    return String(value);
  };
  const times = await measureScenario(() => {
    formatted = 0;
    const width = autosizeColumnWidth(rows, "value", 90, format);
    if (width <= 90 || width > 600) throw Error(`unexpected width ${width}`);
    measuredCells = formatted;
  }, 15);
  Bun.gc(true);
  const before = heapStats().heapSize;
  for (let round = 0; round < 20; round++) autosizeColumnWidth(rows, "value", 90, format);
  Bun.gc(true);
  const retainedBytes = Math.max(0, heapStats().heapSize - before);
  reportScenario("column-autosize", {
    loadedRows: rows.length,
    measuredCells,
    ...times,
    retainedBytes,
    environment,
  });
  expect(measuredCells).toBeLessThanOrEqual(AUTOSIZE_SAMPLE);
  expect(times.medianMs).toBeLessThan(10);
  expect(times.p95Ms).toBeLessThan(25);
  expect(retainedBytes).toBeLessThan(1024 * 1024);
});

test("unlimited re-run of 200,000 rows makes one request and keeps the rendered window bounded", async () => {
  let received: QueryResult | null = null;
  const times = await measureScenario(async () => {
    requests.length = 0;
    received = await executeSqlWithTransactions({
      connection,
      database: null,
      sql: "SELECT id, name FROM items",
      transactionsCapable: false,
      onJob: () => undefined,
      rowLimit: null,
    });
    if (executes() !== 1) throw Error("expected exactly one execute request");
  }, 9);
  const result = received as QueryResult | null;
  expect(result?.rows).toBe(fullResult.rows);
  expect(requests.map((entry) => entry.sql)).toEqual(["SELECT id, name FROM items"]);
  const range = createGridWindowRange(3, 6, 4, [0, FULL_ROWS - 1]);
  const rendered = range({ startIndex: 100_000, endIndex: 100_030, overscan: 0, count: FULL_ROWS });
  reportScenario("query-unlimited-rerun", {
    resultRows: FULL_ROWS,
    executeRequests: executes(),
    renderedRows: rendered.length,
    ...times,
    environment,
  });
  expect(executes()).toBe(1);
  expect(rendered.length).toBeLessThan(60);
  expect(times.medianMs).toBeLessThan(20);
  expect(times.p95Ms).toBeLessThan(50);
});

test("full export reads once and cancelling stops further reads", async () => {
  const load = (onJob: (id: string) => void) => {
    onJob("perf-export");
    return executeSqlWithTransactions({
      connection,
      database: null,
      sql: "SELECT id, name FROM items",
      transactionsCapable: false,
      onJob,
      rowLimit: null,
    });
  };
  const loaded = await loadFullResult(load);
  expect(loaded?.rows.length).toBe(FULL_ROWS);
  expect(executes()).toBe(1);

  requests.length = 0;
  holding = true;
  const cancelled = loadFullResult(load);
  await Bun.sleep(0);
  toastActions.at(-1)?.();
  hold?.(fullResult);
  expect(await cancelled).toBeNull();
  await Bun.sleep(20);
  const cancelRequests = requests.filter((entry) => entry.command === "cancel_execution").length;
  reportScenario("query-full-export", {
    resultRows: FULL_ROWS,
    executeRequests: executes(),
    cancelRequests,
    environment,
  });
  expect(executes()).toBe(1);
  expect(cancelRequests).toBe(1);
});
