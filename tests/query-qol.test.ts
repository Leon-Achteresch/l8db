import { afterEach, expect, test } from "bun:test";
import { maskQueryResult } from "../src/features/query/query-result-masking";
import type { QueryResult } from "../src/lib/db";
import { createQueryCompletion } from "../src/lib/query-notifications";
import { resultColumnWidths } from "../src/lib/result-column-sizing";
import type { ResultRun } from "../src/lib/result-compare";
import {
  deleteResultSnapshot,
  encodeSnapshot,
  listResultSnapshots,
  saveResultSnapshot,
  snapshotRun,
  subscribeResultSnapshots,
} from "../src/lib/result-snapshots";
import { timestampCellText } from "../src/lib/timestamp-display";

const result: QueryResult = {
  columns: ["id", "time", "secret"],
  rows: [{ id: 1, time: "2026-10-25 02:30:45.123456+02", secret: "private", hidden: "omit" }],
  rows_affected: 1,
  execution_time_ms: 1,
};
const run: ResultRun = {
  result,
  sql: "select * from users",
  at: 100,
  connectionId: "one",
  database: "db",
};

afterEach(async () => {
  for (const item of await listResultSnapshots()) await deleteResultSnapshot(item.id);
});

test("time display keeps raw precision and converts explicit offsets only", () => {
  const value = result.rows[0].time;
  expect(timestampCellText(value, { mode: "raw", precision: "seconds" })).toBe(value);
  expect(timestampCellText(value, { mode: "utc", precision: "seconds" })).toBe(
    "2026-10-25 00:30:45 UTC",
  );
  expect(timestampCellText(value, { mode: "utc", precision: "milliseconds" })).toBe(
    "2026-10-25 00:30:45.123 UTC",
  );
  const local = timestampCellText(value, { mode: "local", precision: "milliseconds" });
  expect(new Date(local!.replace(" ", "T").replace(/ ([+-]\d\d:\d\d)$/, "$1")).getTime()).toBe(
    new Date("2026-10-25T00:30:45.123Z").getTime(),
  );
  for (const mode of ["raw", "utc", "local"] as const) {
    expect(timestampCellText("2026-10-25 02:30:45", { mode, precision: "milliseconds" })).toBe(
      "2026-10-25 02:30:45",
    );
    expect(timestampCellText("2026-10-25", { mode, precision: "seconds" })).toBeNull();
    expect(timestampCellText(null, { mode, precision: "seconds" })).toBeNull();
    expect(timestampCellText("invalid", { mode, precision: "seconds" })).toBeNull();
  }
  expect(result.rows[0].time).toBe(value);
});

test("content widths include values, remain capped and leave source data alone", () => {
  const measure = (text: string) => text.length * 7;
  const opts = { mode: "utc", precision: "seconds" } as const;
  const header = resultColumnWidths(result.columns, result.rows, measure, false, opts);
  const content = resultColumnWidths(result.columns, result.rows, measure, true, opts);
  expect(content.time).toBeGreaterThan(header.time);
  expect(resultColumnWidths(["x"], [{ x: "z".repeat(100_000) }], measure, true, opts).x).toBe(600);
  expect(result.rows[0].secret).toBe("private");
  expect(resultColumnWidths(["__proto__"], [], measure, false, opts)).toHaveProperty("__proto__");
});

test("long query notifications are optional, background-only, once and silent on cancellation", async () => {
  let clock = 0;
  let enabled = true;
  let background = true;
  const calls: unknown[] = [];
  const start = () =>
    createQueryCompletion(
      () => enabled,
      () => background,
      async (...args) => {
        calls.push(args);
      },
      () => clock,
    );
  for (const outcome of ["success", "error", "cancelled"] as const) {
    const finish = start();
    clock += 9999;
    await finish(outcome);
  }
  const foreground = start();
  clock += 20_000;
  background = false;
  await foreground("success");
  const off = start();
  clock += 20_000;
  background = true;
  enabled = false;
  await off("success");
  const cancelled = start();
  clock += 20_000;
  enabled = true;
  await cancelled("cancelled");
  expect(calls).toEqual([]);
  const success = start();
  clock += 10_000;
  await success("success");
  await success("error");
  const failure = start();
  clock += 20_000;
  await failure("error");
  expect(calls).toEqual([
    ["success", 10_000],
    ["error", 20_000],
  ]);
});

test("snapshots round trip after reopening storage, preserve masks and delete atomically", async () => {
  const masked = maskQueryResult(result, [{ column: "secret", mode: "text", text: "***" }])!;
  let changes = 0;
  const unsubscribe = subscribeResultSnapshots(() => {
    changes++;
  });
  const saved = await saveResultSnapshot("  vor Migration  ", { ...run, result: masked });
  const stored = (await listResultSnapshots())[0];
  expect(stored.name).toBe("vor Migration");
  expect(snapshotRun(stored).result.rows).toEqual([
    { id: 1, time: result.rows[0].time, secret: "***" },
  ]);
  expect(snapshotRun(stored)).toMatchObject({
    sql: run.sql,
    at: 100,
    connectionId: "one",
    database: "db",
  });
  expect(result.rows[0].secret).toBe("private");
  await deleteResultSnapshot(saved.id);
  expect(await listResultSnapshots()).toEqual([]);
  expect(changes).toBe(2);
  unsubscribe();
});

test("snapshots reject incomplete, giant and deeply nested results without dropping existing data", async () => {
  const saved = await saveResultSnapshot("keep", run);
  expect(() => encodeSnapshot({ ...run, result: { ...result, truncated: true } })).toThrow(
    "1.000-Zeilen-Limit",
  );
  expect(() =>
    encodeSnapshot({ ...run, result: { ...result, rows: Array(1000).fill(result.rows[0]) } }),
  ).toThrow();
  expect(() =>
    encodeSnapshot({ ...run, result: { ...result, rows: [{ secret: "x".repeat(500_001) }] } }),
  ).toThrow();
  let nested: unknown = "deep";
  for (let i = 0; i < 20; i++) nested = { nested };
  expect(() =>
    encodeSnapshot({ ...run, result: { ...result, rows: [{ secret: nested }] } }),
  ).toThrow();
  await expect(saveResultSnapshot(" ", run)).rejects.toThrow();
  expect((await listResultSnapshots())[0].id).toBe(saved.id);
});

test("concurrent snapshot writes respect the global quota without silent eviction", async () => {
  const attempts = await Promise.allSettled(
    Array.from({ length: 12 }, (_, i) => saveResultSnapshot(String(i), run)),
  );
  expect(attempts.filter((item) => item.status === "fulfilled")).toHaveLength(10);
  expect(await listResultSnapshots()).toHaveLength(10);
});
