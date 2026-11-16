import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { createCsvFileCheck } from "../src/lib/csv-file-check";
import { CSV_MAX_VALIDATION_ERRORS, validateMappings } from "../src/lib/csv-import";
import type { CsvCheckReport, CsvCheckRequest } from "../src/lib/db/csv-check";
import { measureScenario, reportScenario } from "./fixtures/usage-performance";

test("10,000 rows × 32 required columns retain bounded reports within latency and heap budgets", async () => {
  const columns = 32;
  const targets = Array.from({ length: columns }, (_, i) => ({
    name: `c${i}`,
    data_type: "text",
    is_nullable: false,
    has_default: false,
    is_identity: false,
    is_generated: false,
  }));
  const mappings = targets.map((target, csvIndex) => ({ csvIndex, target: target.name }));
  const rows = Array.from({ length: 10_000 }, () => Array<string | null>(columns).fill(null));
  const run = () => {
    const report = validateMappings(mappings, targets, rows);
    expect(report.errorCount).toBe(320_000);
    expect(report.errors).toHaveLength(CSV_MAX_VALIDATION_ERRORS);
    expect(JSON.stringify(report).length).toBeLessThan(2_000);
  };
  const times = await measureScenario(run, 15);
  Bun.gc(true);
  const before = heapStats().heapSize;
  for (let round = 0; round < 10; round++) run();
  Bun.gc(true);
  const retainedBytes = Math.max(0, heapStats().heapSize - before);
  reportScenario("csv-null-preflight", {
    rows: rows.length,
    columns,
    violations: 320_000,
    maxDetails: CSV_MAX_VALIDATION_ERRORS,
    ...times,
    retainedBytes,
    databaseRequests: 0,
    fileRequests: 0,
    environment: {
      os: platform(),
      release: release(),
      arch: arch(),
      cpu: cpus()[0]?.model,
      ramBytes: totalmem(),
      bun: Bun.version,
    },
  });
  expect(times.medianMs).toBeLessThan(50);
  expect(times.p95Ms).toBeLessThan(100);
  expect(retainedBytes).toBeLessThan(4 * 1024 * 1024);
});

test("synchronous preflight leaves no row scanning running while idle", async () => {
  let reads = 0;
  const row = new Proxy([null], {
    get(target, property, receiver) {
      if (property === "0") reads++;
      return Reflect.get(target, property, receiver);
    },
  });
  validateMappings(
    [{ csvIndex: 0, target: "a" }],
    [
      {
        name: "a",
        data_type: "text",
        is_nullable: false,
        has_default: false,
        is_identity: false,
        is_generated: false,
      },
    ],
    Array.from({ length: 10_000 }, () => row),
  );
  expect(reads).toBe(10_000);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(reads).toBe(10_000);
});

test("file-check state invalidations keep one active action and bounded retained heap", async () => {
  const request: CsvCheckRequest = {
    source: {
      path: "/synthetic.csv",
      format: "csv",
      delimiter: ",",
      quote: '"',
      has_header: true,
      empty_as_null: true,
      indices: [0],
    },
    expected_columns: 1,
    columns: [{ index: 0, name: "id", nullable: false }],
  };
  const report: CsvCheckReport = {
    status: "complete",
    checked_rows: 100_000,
    error_count: 0,
    issues: [],
    source_size: 1000,
    source_modified_ms: 1,
  };
  const run = async () => {
    const controller = createCsvFileCheck(request, async () => report);
    const unsubscribe = controller.subscribe(() => {});
    for (let index = 0; index < 1000; index++) {
      await controller.run();
      controller.invalidate();
    }
    expect(controller.getSnapshot().report).toBeNull();
    unsubscribe();
    controller.dispose();
  };
  const times = await measureScenario(run, 9);
  Bun.gc(true);
  const before = heapStats().heapSize;
  for (let index = 0; index < 5; index++) await run();
  Bun.gc(true);
  const retainedBytes = Math.max(0, heapStats().heapSize - before);
  reportScenario("csv-file-check-state", {
    invalidations: 1000,
    ...times,
    retainedBytes,
    nativeRequests: 0,
    environment: {
      os: platform(),
      release: release(),
      arch: arch(),
      cpu: cpus()[0]?.model,
      ramBytes: totalmem(),
      bun: Bun.version,
    },
  });
  expect(times.medianMs).toBeLessThan(50);
  expect(times.p95Ms).toBeLessThan(100);
  expect(retainedBytes).toBeLessThan(4 * 1024 * 1024);
});
