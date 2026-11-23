import { beforeEach, expect, mock, test } from "bun:test";
import type { CsvCheckReport, CsvCheckRequest } from "../src/lib/db/csv-check";

const calls: { command: string; args: Record<string, unknown> }[] = [];
let progress: ((event: { payload: { jobId: string; rows: number } }) => void) | null = null;
let unlistened = 0;
let cancel: (() => Promise<boolean>) | undefined;
let updates: unknown[] = [];
let failListen = false;
let invokeResult: Promise<CsvCheckReport>;
mock.module("../src/lib/db/core", () => ({
  cancelExecution: async (id: string) => {
    calls.push({ command: "cancel_execution", args: { id } });
    return true;
  },
  invoke: (command: string, args: Record<string, unknown>) => {
    calls.push({ command, args });
    return invokeResult;
  },
}));
const { checkCsvFile } = await import("../src/lib/db/csv-check");
mock.module("../src/lib/db", () => ({
  checkCsvFile,
  cancelExecution: async (id: string) => {
    calls.push({ command: "cancel_execution", args: { id } });
    return true;
  },
}));
mock.module("@tauri-apps/api/event", () => ({
  listen: async (_: string, listener: typeof progress) => {
    if (failListen) throw Error("event unavailable");
    progress = listener;
    return () => {
      unlistened++;
      progress = null;
    };
  },
}));
mock.module("../src/lib/tasks", () => ({
  startTask: (_: unknown, handler: typeof cancel) => {
    cancel = handler;
  },
  updateTask: (_: string, data: unknown) => {
    updates.push(data);
  },
  finishTask: () => {},
}));
const { runCsvFileCheck } = await import("../src/lib/csv-file-check-runner");
const request: CsvCheckRequest = {
  source: {
    path: "/chosen.csv",
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
  checked_rows: 100,
  error_count: 0,
  issues: [],
  source_size: 200,
  source_modified_ms: 1234,
};
beforeEach(() => {
  calls.length = 0;
  updates = [];
  progress = null;
  cancel = undefined;
  unlistened = 0;
  failListen = false;
  invokeResult = Promise.resolve(report);
});

test("bridge starts exactly one read-only file command, with no connection or SQL", async () => {
  expect(await runCsvFileCheck(request, new AbortController().signal)).toEqual(report);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.command).toBe("check_csv_file");
  expect(calls[0]?.args.request).toEqual(request);
  expect(calls[0]?.args).not.toHaveProperty("connectionString");
  expect(unlistened).toBe(1);
  expect(progress).toBeNull();
});

test("cancellation before registration is forwarded when first progress confirms backend readiness", async () => {
  let resolve!: (value: CsvCheckReport) => void;
  invokeResult = new Promise((done) => {
    resolve = done;
  });
  const controller = new AbortController();
  const run = runCsvFileCheck(request, controller.signal);
  await Promise.resolve();
  await Promise.resolve();
  expect(calls[0]?.command).toBe("check_csv_file");
  controller.abort();
  expect(calls).toHaveLength(1);
  const options = calls[0]?.args.options as { jobId: string };
  progress?.({ payload: { jobId: "other-job", rows: 20 } });
  expect(calls).toHaveLength(1);
  progress?.({ payload: { jobId: options.jobId, rows: 0 } });
  expect(calls.at(-1)?.command).toBe("cancel_execution");
  resolve(report);
  await expect(run).rejects.toThrow("abgebrochen");
  expect(unlistened).toBe(1);
});

test("already cancelled or missing event subscription never starts a file read", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(runCsvFileCheck(request, controller.signal)).rejects.toThrow("abgebrochen");
  expect(calls).toHaveLength(0);
  failListen = true;
  await expect(runCsvFileCheck(request, new AbortController().signal)).rejects.toThrow(
    "event unavailable",
  );
  expect(calls).toHaveLength(0);
});
