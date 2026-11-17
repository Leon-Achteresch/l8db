import { expect, test } from "bun:test";
import {
  createCsvFileCheck,
  csvCheckMatchesFile,
  csvFileCheckRequest,
} from "../src/lib/csv-file-check";
import type { CsvCheckReport, CsvCheckRequest } from "../src/lib/db/csv-check";

const source = {
  path: "/chosen.csv",
  format: "csv" as const,
  delimiter: ",",
  quote: '"',
  has_header: true,
  empty_as_null: true,
  indices: [0],
};
const target = {
  name: "id",
  data_type: "integer",
  is_nullable: false,
  has_default: true,
  is_identity: false,
  is_generated: false,
};
const request: CsvCheckRequest = {
  source,
  expected_columns: 1,
  columns: [{ index: 0, name: "id", nullable: false }],
};
const report: CsvCheckReport = {
  status: "complete",
  checked_rows: 50_000,
  error_count: 0,
  issues: [],
  source_size: 600_000,
  source_modified_ms: 1234,
};
function deferred() {
  let resolve!: (report: CsvCheckReport) => void;
  const promise = new Promise<CsvCheckReport>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("request uses mapped target NULL contracts and rejects ambiguous/generated mappings", () => {
  expect(
    csvFileCheckRequest(source, 1, [{ csvIndex: 0, target: "id" }], [target])?.columns,
  ).toEqual(request.columns);
  for (const mappings of [
    [{ csvIndex: 0, target: "missing" }],
    [{ csvIndex: 2, target: "id" }],
    [
      { csvIndex: 0, target: "id" },
      { csvIndex: 0, target: "id" },
    ],
  ]) {
    expect(csvFileCheckRequest(source, 1, mappings, [target])).toBeNull();
  }
  expect(
    csvFileCheckRequest(
      source,
      1,
      [{ csvIndex: 0, target: "id" }],
      [{ ...target, is_generated: true }],
    ),
  ).toBeNull();
});

test("changed source/mapping invalidates a running report and discards late completion", async () => {
  const first = deferred();
  const second = deferred();
  const signals: AbortSignal[] = [];
  const check = createCsvFileCheck(request, async (_, signal) => {
    signals.push(signal);
    return signals.length === 1 ? first.promise : second.promise;
  });
  const oldRun = check.run();
  expect(check.getSnapshot().checking).toBe(true);
  check.invalidate();
  expect(signals[0]?.aborted).toBe(true);
  const newRun = check.run();
  first.resolve(report);
  await oldRun;
  expect(check.getSnapshot()).toEqual({
    checking: true,
    cancelling: false,
    cancelled: false,
    report: null,
    error: null,
  });
  second.resolve({ ...report, checked_rows: 10 });
  await newRun;
  expect(check.getSnapshot().report?.checked_rows).toBe(10);
});

test("cancelled completion never becomes a clean result; cleanup cancels pending work", async () => {
  const pending = deferred();
  let signal: AbortSignal | undefined;
  const check = createCsvFileCheck(request, async (_, value) => {
    signal = value;
    return pending.promise;
  });
  let notifications = 0;
  const stop = check.subscribe(() => notifications++);
  const run = check.run();
  check.cancel();
  expect(signal?.aborted).toBe(true);
  expect(check.getSnapshot()).toMatchObject({ checking: true, cancelling: true, report: null });
  const before = notifications;
  check.cancel();
  expect(notifications).toBe(before);
  pending.resolve(report);
  await run;
  expect(check.getSnapshot()).toMatchObject({
    checking: false,
    cancelling: false,
    cancelled: true,
    report: null,
    error: null,
  });
  stop();
  check.dispose();
  const after = notifications;
  await check.run();
  expect(notifications).toBe(after);
});

test("repeated clicks start one scan and errors can be corrected then retried", async () => {
  const pending = deferred();
  let calls = 0;
  const check = createCsvFileCheck(request, async () => {
    calls++;
    if (calls === 1) return pending.promise;
    throw Error("Datei nicht lesbar");
  });
  const first = check.run();
  await check.run();
  expect(calls).toBe(1);
  pending.resolve(report);
  await first;
  check.invalidate();
  await check.run();
  expect(check.getSnapshot().error).toContain("Datei nicht lesbar");
  expect(check.getSnapshot().report).toBeNull();
});

test("file freshness requires matching size/time and a complete check", () => {
  expect(csvCheckMatchesFile(report, { size: report.source_size, mtime: new Date(1234) })).toBe(
    true,
  );
  expect(csvCheckMatchesFile(report, { size: 1, mtime: new Date(1234) })).toBe(false);
  expect(csvCheckMatchesFile(report, { size: report.source_size, mtime: new Date(1235) })).toBe(
    false,
  );
  expect(csvCheckMatchesFile(report, { size: report.source_size, mtime: null })).toBe(false);
  expect(
    csvCheckMatchesFile(
      { ...report, status: "changed" },
      { size: report.source_size, mtime: new Date(1234) },
    ),
  ).toBe(false);
});

test("confirmed aborted report retains only the actual partial read count", async () => {
  const pending = deferred();
  const check = createCsvFileCheck(request, async () => pending.promise);
  const run = check.run();
  check.cancel();
  pending.resolve({ ...report, status: "cancelled", checked_rows: 8192 });
  await run;
  expect(check.getSnapshot().report?.status).toBe("cancelled");
  expect(check.getSnapshot().report?.checked_rows).toBe(8192);
});

test("runner failure stays an error and is not shown as a cancellation", async () => {
  const check = createCsvFileCheck(request, async () => {
    throw Error("Datei nicht lesbar");
  });
  await check.run();
  expect(check.getSnapshot()).toMatchObject({
    cancelled: false,
    error: "Error: Datei nicht lesbar",
  });
  check.cancel();
  expect(check.getSnapshot().cancelling).toBe(false);
});
