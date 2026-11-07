import { heapSize } from "bun:jsc";
import { expect, test } from "bun:test";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import { useConnectionsStore } from "../src/lib/connections";
import { useTableTabs } from "../src/lib/table-tabs";
import { captureInvestigation, restoreInvestigation } from "../src/lib/workbench/investigations";
import { saveParameterSet } from "../src/lib/workbench/parameter-sets";
import { createQueryVariant } from "../src/lib/workbench/query-variants";
import {
  deleteWorkbenchRecord,
  listWorkbenchRecords,
  saveWorkbenchRecord,
  subscribeWorkbench,
  type WorkbenchRecord,
} from "../src/lib/workbench/records";
import { compareWatchedRows, type RowWatch, watchSnapshot } from "../src/lib/workbench/row-watches";
import { recordSuccessfulSql, sqlStateScope } from "../src/lib/workbench/sql-states";

test("200 watches over 100,000 loaded rows retain only watched snapshots and perform no database requests", async () => {
  const rows = Array.from({ length: 100_000 }, (_, id) => ({
    id,
    tenant: "a",
    value: `value-${id}`,
  }));
  const watches: WorkbenchRecord<RowWatch>[] = Array.from({ length: 200 }, (_, index) => ({
    id: String(index),
    kind: "watch",
    scope: "perf",
    name: String(index),
    at: index,
    chars: 100,
    value: watchSnapshot(rows[index * 400], ["tenant", "id"], ["id", "tenant", "value"]),
  }));
  rows[0] = { ...rows[0], value: "changed" };
  const baseline = await measureScenario(() => {
    expect(compareWatchedRows([], rows)).toHaveLength(0);
  });
  let latest: ReturnType<typeof compareWatchedRows> = [];
  const timing = await measureScenario(() => {
    latest = compareWatchedRows(watches, rows);
  });
  expect(latest).toHaveLength(200);
  expect(latest[0].changed).toEqual(["value"]);
  expect(timing.p95Ms).toBeLessThan(250);
  Bun.gc(true);
  const before = heapSize();
  for (let i = 0; i < 10; i++) latest = compareWatchedRows(watches, rows);
  Bun.gc(true);
  const retained = heapSize() - before;
  expect(retained).toBeLessThan(8 * 1024 * 1024);
  await reportScenario("workbench-row-watches", {
    rows: rows.length,
    watches: watches.length,
    baseline,
    timing,
    retainedHeapBytes: retained,
    maxRetainedResults: 200,
    databaseRequests: 0,
    pollingTimers: 0,
  });
});

test("large SQL, parameter sets and investigations stay bounded across concurrent storage, replacement and deletion", async () => {
  const sql = `SELECT 1;\n${" ".repeat(99_990)}`;
  const source = { sql, editorId: "perf", source: "manual" };
  const writing = await measureScenario(async () => {
    const saved = await saveWorkbenchRecord({
      kind: "checkpoint",
      scope: "perf",
      name: "large SQL",
      value: source,
    });
    await deleteWorkbenchRecord(saved.id);
  }, 5);
  const attempts = await Promise.allSettled(
    Array.from({ length: 15 }, (_, index) =>
      saveWorkbenchRecord({
        kind: "investigation",
        scope: "perf",
        name: `Investigation ${index}`,
        value: {
          note: "x".repeat(1000),
          tabs: Array.from({ length: 3 }, () => ({ kind: "query", sql })),
        },
      }),
    ),
  );
  const saved = await listWorkbenchRecords("investigation", "perf");
  expect(saved.reduce((sum, item) => sum + item.chars, 0)).toBeLessThanOrEqual(4_000_000);
  expect(attempts.some((attempt) => attempt.status === "rejected")).toBe(true);
  for (const item of saved) await deleteWorkbenchRecord(item.id);
  let notifications = 0;
  const unsubscribe = subscribeWorkbench(() => {
    notifications++;
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  expect(notifications).toBe(0);
  const success = await measureScenario(() => recordSuccessfulSql("perf", "db", "perf", sql), 5);
  const successRecords = await listWorkbenchRecords("success", sqlStateScope("perf", "db", "perf"));
  expect(successRecords).toHaveLength(1);
  unsubscribe();
  for (const record of successRecords) await deleteWorkbenchRecord(record.id);
  expect(writing.p95Ms).toBeLessThan(150);
  expect(success.p95Ms).toBeLessThan(100);
  await reportScenario("workbench-storage", {
    sqlChars: sql.length,
    writing,
    success,
    concurrentWriters: 15,
    maxStoredInvestigationChars: 4_000_000,
    databaseRequests: 0,
    idleNotifications: 0,
  });
});

test("variants, 50-tab investigations and 100-parameter sets stay responsive without running SQL", async () => {
  useConnectionsStore.setState({ activeId: "perf", connections: [] });
  const tabs = Array.from({ length: 50 }, (_, index) => ({
    kind: "query" as const,
    id: String(index),
    title: `Query ${index}`,
    sql: `SELECT ${index};${" ".repeat(8_000)}`,
  }));
  useTableTabs.setState({ tabs, tabsByConnection: {} });
  const variants = await measureScenario(() => {
    const id = createQueryVariant("0", tabs[0].sql);
    expect(useTableTabs.getState().tabs.at(-1)?.kind).toBe("query");
    expect(useTableTabs.getState().tabs.at(-1)).toHaveProperty("id", id);
    useTableTabs.setState({ tabs, tabsByConnection: {} });
  });
  const investigations = await measureScenario(() => {
    const value = captureInvestigation("perf", "db", "query:0", "Investigating a large workspace");
    useTableTabs.setState({ tabs: [], tabsByConnection: {} });
    const active = restoreInvestigation("perf", "db", value);
    expect(active?.kind).toBe("query");
    expect(useTableTabs.getState().tabs).toHaveLength(50);
    useTableTabs.setState({ tabs, tabsByConnection: {} });
  }, 5);
  const refs = Array.from({ length: 100 }, (_, index) => ({
    name: `p${index}`,
    label: `:p${index}`,
    named: true,
  }));
  const values = Object.fromEntries(
    refs.map((ref) => [ref.name, { type: "text" as const, value: "x".repeat(1000) }]),
  );
  const parameters = await measureScenario(async () => {
    const record = await saveParameterSet("perf", "100 parameters", "SELECT :p0", refs, values);
    expect(Object.keys(record.value.values)).toHaveLength(100);
    await deleteWorkbenchRecord(record.id);
  }, 5);
  expect(variants.p95Ms).toBeLessThan(50);
  expect(investigations.p95Ms).toBeLessThan(100);
  expect(parameters.p95Ms).toBeLessThan(100);
  useTableTabs.setState({ tabs: [], tabsByConnection: {} });
  await reportScenario("workbench-actions", {
    variants,
    investigations,
    parameters,
    tabs: 50,
    charsPerSql: 8009,
    parameterCount: 100,
    charsPerValue: 1000,
    databaseRequests: 0,
  });
});
