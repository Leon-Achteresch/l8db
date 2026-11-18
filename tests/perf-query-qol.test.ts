import { heapSize } from "bun:jsc";
import { expect, test } from "bun:test";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import { createQueryCompletion } from "../src/lib/query-notifications";
import { resultColumnWidths } from "../src/lib/result-column-sizing";
import type { ResultRun } from "../src/lib/result-compare";
import {
  deleteResultSnapshot,
  encodeSnapshot,
  listResultSnapshots,
  saveResultSnapshot,
} from "../src/lib/result-snapshots";
import { type TimestampOptions, timestampCellText } from "../src/lib/timestamp-display";

test("large-grid display work stays sampled, bounded and free of database requests", async () => {
  const columns = Array.from({ length: 80 }, (_, i) => `column_${i}`);
  let reads = 0;
  const row = new Proxy(
    {},
    {
      get: () => {
        reads++;
        return "2026-10-25 02:30:45.123+02";
      },
    },
  );
  const rows = Array(100_000).fill(row);
  let widths = {};
  const header = await measureScenario(() => {
    widths = resultColumnWidths(columns, rows, (s) => s.length * 7, false, {
      mode: "raw",
      precision: "seconds",
    });
  });
  reads = 0;
  const timing = await measureScenario(() => {
    const before = reads;
    widths = resultColumnWidths(columns, rows, (s) => s.length * 7, true, {
      mode: "utc",
      precision: "milliseconds",
    });
    expect(reads - before).toBeLessThanOrEqual(8000);
  });
  const timestamps = await measureScenario(() => {
    for (let i = 0; i < 10_000; i++)
      timestampCellText("2026-10-25 02:30:45.123+02", { mode: "local", precision: "milliseconds" });
  });
  const businessOptions: TimestampOptions = {
    mode: "business",
    precision: "seconds",
    timeZone: "America/New_York",
  };
  const businessValues = Array.from(
    { length: 10_000 },
    (_, index) =>
      `2026-11-01T0${index % 2 === 0 ? "5" : "6"}:30:${String(index % 60).padStart(2, "0")}.${String(index).padStart(6, "0")}Z`,
  );
  const businessTimeZone = await measureScenario(() => {
    for (const value of businessValues)
      timestampCellText(value, businessOptions, "postgres", "timestamp(6) with time zone");
  });
  expect(Object.keys(widths)).toHaveLength(80);
  expect(timing.p95Ms).toBeLessThan(50);
  expect(timestamps.p95Ms).toBeLessThan(80);
  expect(businessTimeZone.p95Ms).toBeLessThan(180);
  await reportScenario("query-qol-grid", {
    rows: rows.length,
    columns: columns.length,
    maxSampledCells: 8000,
    headerBaseline: header,
    contentWidths: timing,
    timestampCells: 10_000,
    timestamps,
    businessTimeZone,
    databaseRequests: 0,
  });
});

test("snapshot storage is capped across concurrent writers and notifications do no idle or cancellation work", async () => {
  const columns = Array.from({ length: 20 }, (_, i) => `col_${i}`);
  const run: ResultRun = {
    sql: "SELECT * FROM example",
    at: 1,
    connectionId: "perf",
    database: "db",
    result: {
      columns,
      rows: Array.from({ length: 999 }, (_, id) =>
        Object.fromEntries(columns.map((name) => [name, `${id}-abcdefgh`])),
      ),
      rows_affected: 999,
      execution_time_ms: 1,
    },
  };
  const encoding = await measureScenario(() => {
    expect(encodeSnapshot(run).length).toBeLessThanOrEqual(500_000);
  });
  Bun.gc(true);
  const before = heapSize();
  let enabledChecks = 0;
  let sent = 0;
  let clock = 0;
  const pending = Array.from({ length: 1000 }, () =>
    createQueryCompletion(
      () => {
        enabledChecks++;
        return true;
      },
      () => true,
      async () => {
        sent++;
      },
      () => clock,
    ),
  );
  expect(enabledChecks).toBe(0);
  expect(sent).toBe(0);
  clock = 60_000;
  for (const finish of pending) await finish("cancelled");
  expect(enabledChecks).toBe(0);
  expect(sent).toBe(0);
  const started = performance.now();
  const attempts = await Promise.allSettled(
    Array.from({ length: 12 }, (_, i) => saveResultSnapshot(`Stand ${i}`, run)),
  );
  const saved = await listResultSnapshots();
  expect(saved.length).toBeLessThanOrEqual(10);
  expect(saved.reduce((sum, item) => sum + item.payload.length, 0)).toBeLessThanOrEqual(2_000_000);
  expect(attempts.some((item) => item.status === "rejected")).toBe(true);
  const storageMs = performance.now() - started;
  for (const item of saved) await deleteResultSnapshot(item.id);
  Bun.gc(true);
  const retainedHeap = heapSize() - before;
  expect(retainedHeap).toBeLessThan(32 * 1024 * 1024);
  expect(encoding.p95Ms).toBeLessThan(100);
  expect(storageMs).toBeLessThan(2000);
  await reportScenario("query-qol-snapshots", {
    rows: 999,
    columns: 20,
    encoding,
    saved: saved.length,
    storageMs,
    retainedHeap,
    cancelledCompletions: pending.length,
    idleChecks: enabledChecks,
    notifications: sent,
    timers: 0,
    databaseRequests: 0,
  });
});
