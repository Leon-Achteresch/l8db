import { expect, test } from "bun:test";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import { buildInsertStatements } from "../src/lib/export";
import { markRowRange, stableMarkerKey } from "../src/lib/row-markers";

const COLUMNS = ["id", "name", "email", "amount", "active", "meta", "__ctid__"];

function makeRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    name: `Kunde ${index} O'Brien`,
    email: `kunde${index}@example.com`,
    amount: (index * 13.37).toFixed(2),
    active: index % 2 === 0,
    meta: index % 5 === 0 ? null : { tier: index % 3, tags: ["a", "b"] },
    __ctid__: `(0,${index})`,
  }));
}

test("shift range marks rows by stable key in both directions", () => {
  const rows = makeRows(10);
  const keyOf = (row: (typeof rows)[number]) => stableMarkerKey(row, ["id"]) ?? row;
  const keys = markRowRange(new Set<string | (typeof rows)[number]>(), rows, 7, 3, keyOf);
  expect(keys.size).toBe(5);
  expect(keys.has(keyOf(rows[3]))).toBe(true);
  expect(keys.has(keyOf(rows[7]))).toBe(true);
  expect(keys.has(keyOf(rows[2]))).toBe(false);
});

test("selected rows produce one escaped INSERT per row without the ctid column", () => {
  const script = buildInsertStatements({
    schema: "public",
    table: "kunden",
    columns: COLUMNS,
    rows: makeRows(2),
    kind: "postgres",
  });
  const lines = script.trimEnd().split("\n");
  expect(lines).toHaveLength(2);
  expect(lines[0]).toStartWith(
    'INSERT INTO "public"."kunden" ("id", "name", "email", "amount", "active", "meta") VALUES (1, ',
  );
  expect(lines[0]).toContain("'Kunde 0 O''Brien'");
  expect(script).not.toContain("__ctid__");
});

test("10,000 selected rows build the INSERT script and 100,000-row range fast", async () => {
  const rangeRows = makeRows(100_000);
  const keyOf = (row: (typeof rangeRows)[number]) => stableMarkerKey(row, ["id"]) ?? row;
  let marked = 0;
  const rangeTiming = await measureScenario(() => {
    marked = markRowRange(new Set(), rangeRows, 99_999, 0, keyOf).size;
  });
  expect(marked).toBe(100_000);
  expect(rangeTiming.p95Ms).toBeLessThan(40);

  const selected = rangeRows.slice(0, 10_000);
  let bytes = 0;
  const scriptTiming = await measureScenario(() => {
    bytes = buildInsertStatements({
      schema: "public",
      table: "kunden",
      columns: COLUMNS,
      rows: selected,
      kind: "postgres",
    }).length;
  });
  expect(bytes).toBeGreaterThan(0);
  expect(bytes).toBeLessThan(2_500_000);
  expect(scriptTiming.p95Ms).toBeLessThan(40);

  await reportScenario("row-insert-script", {
    ...scriptTiming,
    rangeMedianMs: rangeTiming.medianMs,
    rangeP95Ms: rangeTiming.p95Ms,
    rangeRows: 100_000,
    selectedRows: 10_000,
    outputBytes: bytes,
    databaseRequests: 0,
    limits: { p95Ms: 40, rangeP95Ms: 40, outputBytes: 2_500_000 },
  });
});
