import { beforeEach, expect, mock, test } from "bun:test";
import type { CsvCheckReport, CsvCheckRequest } from "../src/lib/db/csv-check";

type Progress = (event: { payload: { jobId: string; rows: number } }) => void;
type Job = { id: string; resolve: (value: CsvCheckReport) => void; reject: (error: Error) => void };
const listeners = new Set<Progress>();
const starts: ((job: Job) => void)[] = [];
const calls: string[] = [];
let updates = 0;
mock.module("@tauri-apps/api/core", () => ({
  invoke: (command: string, args: { options?: { jobId: string } }) => {
    calls.push(command);
    if (command === "cancel_execution") return Promise.resolve(true);
    if (command !== "check_csv_file") throw Error(`Unexpected DB/import command: ${command}`);
    const id = args.options?.jobId;
    if (!id) throw Error("Missing actual bridge job ID");
    return new Promise<CsvCheckReport>((resolve, reject) =>
      starts.shift()?.({ id, resolve, reject }),
    );
  },
}));
mock.module("@tauri-apps/api/event", () => ({
  listen: async (_event: string, listener: Progress) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
}));
const tasks = await import("../src/lib/tasks");
tasks.useTasksStore.subscribe(() => updates++);
const { createCsvFileCheck, csvCheckBlockedReason } = await import("../src/lib/csv-file-check");
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
  checked_rows: 42,
  error_count: 0,
  issues: [],
  source_size: 100,
  source_modified_ms: 10,
};
async function start(check: ReturnType<typeof createCsvFileCheck>) {
  const pending = new Promise<Job>((resolve) => starts.push(resolve));
  const done = check.run();
  return {
    job: await Promise.race([
      pending,
      done.then(() => {
        throw Error(check.getSnapshot().error ?? "Ended before real bridge dispatch");
      }),
    ]),
    done,
  };
}
function emit(jobId: string, rows: number) {
  for (const listener of listeners) listener({ payload: { jobId, rows } });
}
beforeEach(() => {
  listeners.clear();
  starts.length = 0;
  calls.length = 0;
  tasks.useTasksStore.setState({ tasks: [] });
  updates = 0;
});

test("real runner/bridge: unknown -> progress -> double cancel -> restart, no import/connection commands", async () => {
  const check = createCsvFileCheck(request);
  expect(csvCheckBlockedReason(check.getSnapshot())).toBeNull();
  const first = await start(check);
  expect(check.getSnapshot().checkedRows).toBeNull();
  emit(first.job.id, 0);
  expect(check.getSnapshot().checkedRows).toBe(0);
  emit(first.job.id, 8192);
  const stable = check.getSnapshot();
  for (const rows of [8192, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    emit(first.job.id, rows);
  emit("other-job", 999999);
  expect(check.getSnapshot()).toBe(stable);
  check.cancel();
  check.cancel();
  await tasks.cancelTask(first.job.id);
  expect(calls.filter((call) => call === "cancel_execution")).toHaveLength(1);
  emit(first.job.id, 16384);
  expect(check.getSnapshot()).toMatchObject({
    checking: true,
    cancelling: true,
    checkedRows: 8192,
  });
  first.job.resolve(report);
  await first.done;
  expect(check.getSnapshot()).toMatchObject({ cancelled: true, report: null, error: null });
  expect(
    tasks.useTasksStore.getState().tasks.find((task) => task.id === first.job.id)?.status,
  ).toBe("cancelled");
  expect(csvCheckBlockedReason(check.getSnapshot())).not.toBeNull();
  const second = await start(check);
  expect(check.getSnapshot()).toMatchObject({ checkedRows: null, report: null, cancelled: false });
  emit(first.job.id, 999999);
  expect(check.getSnapshot().checkedRows).toBeNull();
  await tasks.cancelTask(second.job.id);
  expect(check.getSnapshot().cancelling).toBe(true);
  emit(second.job.id, 0);
  emit(second.job.id, 8192);
  expect(calls.filter((call) => call === "cancel_execution")).toHaveLength(2);
  second.job.reject(Error("late native error after cancellation"));
  await second.done;
  expect(check.getSnapshot()).toMatchObject({ cancelled: true, error: null, report: null });
  const third = await start(check);
  third.job.resolve(report);
  await third.done;
  expect(csvCheckBlockedReason(check.getSnapshot())).toBeNull();
  const fourth = await start(check);
  fourth.job.reject(Error("current file unreadable"));
  await fourth.done;
  expect(check.getSnapshot()).toMatchObject({ cancelled: false, report: null });
  expect(csvCheckBlockedReason(check.getSnapshot())).not.toBeNull();
  expect(
    tasks.useTasksStore.getState().tasks.find((task) => task.id === fourth.job.id)?.status,
  ).toBe("error");
  const fifth = await start(check);
  fifth.job.resolve({ ...report, status: "changed" });
  await fifth.done;
  expect(csvCheckBlockedReason(check.getSnapshot())).not.toBeNull();
  const idleUpdates = updates;
  emit(third.job.id, 999999);
  await Promise.resolve();
  expect(updates).toBe(idleUpdates);
  expect(listeners.size).toBe(0);
  expect(tasks.useTasksStore.getState().tasks.every((task) => !tasks.isTaskActive(task))).toBe(
    true,
  );
  expect(calls).toEqual([
    "check_csv_file",
    "cancel_execution",
    "check_csv_file",
    "cancel_execution",
    "check_csv_file",
    "check_csv_file",
    "check_csv_file",
  ]);
});

for (const boundary of ["file", "mapping", "options", "scope", "unmount"] as const) {
  test(`real runner discards late success/error/progress after ${boundary}`, async () => {
    for (const outcome of ["success", "error"] as const) {
      const old = createCsvFileCheck(request);
      const first = await start(old);
      const detached = [...listeners][0];
      emit(first.job.id, 8192);
      if (boundary === "unmount") old.dispose();
      else old.invalidate();
      const next = createCsvFileCheck({
        ...request,
        source: { ...request.source, path: "/new.csv" },
      });
      const second = await start(next);
      emit(second.job.id, 16384);
      const expected = next.getSnapshot();
      emit(first.job.id, 999999);
      if (outcome === "success") first.job.resolve(report);
      else first.job.reject(Error("old failure"));
      await first.done;
      const beforeLate = updates;
      detached({ payload: { jobId: first.job.id, rows: 9999999 } });
      expect(updates).toBe(beforeLate);
      expect(next.getSnapshot()).toBe(expected);
      second.job.resolve({ ...report, status: "incomplete", checked_rows: 16384 });
      await second.done;
      expect(csvCheckBlockedReason(next.getSnapshot())).not.toBeNull();
      expect(listeners.size).toBe(0);
      next.dispose();
    }
  });
}
