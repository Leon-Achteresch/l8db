import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import { getColumnTypeInfo } from "../src/features/table/data-table/column-type-info";
import { columnFilterCounts } from "../src/features/table/table-columns-list/column-type-config";
import type { DetailedColumnInfo } from "../src/lib/db";
import { isDateFilterType } from "../src/lib/sql-filter";

const TYPES = [
  "integer",
  "numeric(12,2)",
  "text",
  "character varying(255)",
  "timestamp with time zone",
  "date",
  "boolean",
  "jsonb",
  "Nullable(Int64)",
  "Array(String)",
];

const column = (index: number): DetailedColumnInfo => ({
  name: `column_${index}`,
  data_type: TYPES[index % TYPES.length],
  is_nullable: index % 3 !== 0,
  column_default: index % 5 === 0 ? "0" : null,
  is_primary_key: index === 0,
  ordinal_position: index + 1,
  character_maximum_length: null,
  comment: index % 7 === 0 ? "Kommentar" : null,
});

test("Filter-Chips zählen jede Spalte genau einmal je Filter", () => {
  const counts = Object.fromEntries(
    columnFilterCounts(Array.from({ length: 20 }, (_, index) => column(index))).map((filter) => [
      filter.id,
      filter.count,
    ]),
  );
  expect(counts).toEqual({
    all: 20,
    pk: 1,
    "not-null": 7,
    "has-default": 4,
    numeric: 6,
    text: 4,
    date: 4,
    boolean: 2,
    json: 4,
  });
  expect(columnFilterCounts([]).map((filter) => filter.id)).toEqual([
    "all",
    "pk",
    "not-null",
    "has-default",
  ]);
});

test("Filter-Zählung bleibt bei 10.000 Spalten schnell", async () => {
  const columns = Array.from({ length: 10_000 }, (_, index) => column(index));
  const counting = await measureScenario(() => {
    columnFilterCounts(columns);
  }, 40);
  await reportScenario("column-filter-counts", { columns: columns.length, counting });
  expect(counting.medianMs).toBeLessThan(40);
  expect(counting.p95Ms).toBeLessThan(80);
});

test("canonical SQL-Server row versions stay non-temporal across 10,000 columns", async () => {
  const types = ["rowversion", "datetime2(7)", "rowversion", "datetimeoffset(7)"];
  const columns = Array.from({ length: 10_000 }, (_, index) => ({
    ...column(index),
    data_type: types[index % types.length],
    is_primary_key: false,
  }));
  const run = () => {
    const dates = columnFilterCounts(columns).find((filter) => filter.id === "date")?.count;
    if (dates !== 5_000) throw new Error("wrong temporal filter count");
    for (const detail of columns) {
      const dated = detail.data_type !== "rowversion";
      if (
        (getColumnTypeInfo(detail.name, [], detail).kind === "date") !== dated ||
        isDateFilterType(detail.data_type) !== dated
      )
        throw new Error("wrong type classification");
    }
  };
  const counting = await measureScenario(run, 15);
  Bun.gc(true);
  const before = heapStats().heapSize;
  for (let index = 0; index < 5; index++) run();
  Bun.gc(true);
  const retainedBytes = Math.max(0, heapStats().heapSize - before);
  await reportScenario("rowversion-column-consumers", {
    columns: columns.length,
    counting,
    retainedBytes,
    dbRequests: 0,
    environment: {
      os: platform(),
      release: release(),
      arch: arch(),
      cpu: cpus()[0]?.model,
      ramBytes: totalmem(),
      bun: Bun.version,
    },
  });
  expect(counting.medianMs).toBeLessThan(40);
  expect(counting.p95Ms).toBeLessThan(80);
  expect(retainedBytes).toBeLessThan(4 * 1024 * 1024);
});
