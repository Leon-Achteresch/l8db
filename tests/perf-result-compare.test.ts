import { expect, mock, test } from "bun:test";
import { measureScenario, reportScenario } from "../scripts/performance-report";

const invocations: string[] = [];
mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string) => {
    invocations.push(command);
    return null;
  },
}));

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: (globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage,
});

const { compareResults, detectKeyColumns, EMPTY_RESULT_RUNS, nextResultRuns } = await import(
  "../src/lib/result-compare"
);
const { queryTabScope, readTabState, tabStateKey, writeTabState } = await import(
  "../src/lib/tab-state"
);
const { useTableTabs } = await import("../src/lib/table-tabs");

const ROWS = 999;
const COLUMNS = 40;
const columns = ["id", ...Array.from({ length: COLUMNS - 1 }, (_, index) => `col_${index}`)];

function row(id: number, version: number) {
  const record: Record<string, unknown> = { id };
  for (const column of columns.slice(1))
    record[column] = `${column} value ${id * 7} ${version && id % 20 === 0 ? "changed" : ""}`;
  return record;
}

const before = {
  columns,
  rows: Array.from({ length: ROWS }, (_, id) => row(id, 0)),
  rows_affected: ROWS,
  execution_time_ms: 1,
};
const after = {
  ...before,
  rows: [
    ...Array.from({ length: ROWS }, (_, id) => id)
      .filter((id) => id % 33 !== 0)
      .map((id) => row(id, 1)),
    ...Array.from({ length: 30 }, (_, index) => row(ROWS + index, 1)),
  ],
};

test("ein Vergleich von 999 breiten Zeilen bleibt schnell und fragt die Datenbank nie", async () => {
  let keyed = compareResults(before, after, detectKeyColumns(before, after));
  const keyedTiming = await measureScenario(() => {
    keyed = compareResults(before, after, detectKeyColumns(before, after));
  });
  let whole = compareResults(before, after, []);
  const wholeTiming = await measureScenario(() => {
    whole = compareResults(before, after, []);
  });

  expect(keyed.keyColumns).toEqual(["id"]);
  expect(keyed.counts.changed + keyed.counts.added + keyed.counts.removed).toBeGreaterThan(0);
  expect(keyed.changes.length).toBeLessThanOrEqual(before.rows.length + after.rows.length);
  expect(whole.changes.length).toBeLessThanOrEqual(before.rows.length + after.rows.length);
  expect(invocations).toEqual([]);
  expect(keyedTiming.p95Ms).toBeLessThan(120);
  expect(wholeTiming.p95Ms).toBeLessThan(120);
  await reportScenario("result-compare-diff", {
    rows: ROWS,
    columns: COLUMNS,
    keyed: keyedTiming,
    wholeRow: wholeTiming,
    changes: keyed.changes.length,
    counts: keyed.counts,
    databaseRequests: invocations.length,
  });
});

test("pro Tab bleibt höchstens ein zweiter Lauf im Speicher und geht beim Schließen", () => {
  const tabs = [
    { kind: "query" as const, id: "compare-a", title: "A", sql: "SELECT 1" },
    { kind: "query" as const, id: "compare-b", title: "B", sql: "SELECT 1" },
  ];
  useTableTabs.setState({ tabs, tabsByConnection: {} });
  const key = (id: string) => tabStateKey(queryTabScope(id), "runs");
  let runs = EMPTY_RESULT_RUNS;
  for (let index = 0; index < 50; index++)
    runs = nextResultRuns(runs, {
      result: index % 2 ? before : after,
      sql: "SELECT 1",
      at: index,
      connectionId: "perf",
      database: "db",
    });
  const retained = new Set([runs.baseline?.result, runs.latest?.result].filter(Boolean));
  expect(retained.size).toBeLessThanOrEqual(2);
  expect(runs.baseline?.at).toBe(48);
  writeTabState(key("compare-a"), runs);
  writeTabState(key("compare-b"), runs);
  useTableTabs.setState({ tabs: tabs.slice(0, 1) });
  expect(readTabState(key("compare-a"))).toBeDefined();
  expect(readTabState(key("compare-b"))).toBeUndefined();
});
