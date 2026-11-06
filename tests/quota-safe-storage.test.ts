import { afterAll, beforeEach, expect, spyOn, test } from "bun:test";

const KEY = "l8db.tasks";
let attempts = 0;

function quotaStorage(limit: number) {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      attempts++;
      if (value.length > limit) throw new DOMException("quota", "QuotaExceededError");
      data.set(key, value);
    },
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
  };
}

let backing = quotaStorage(Number.POSITIVE_INFINITY);
const switchable = {
  getItem: (key: string) => backing.getItem(key),
  setItem: (key: string, value: string) => backing.setItem(key, value),
  removeItem: (key: string) => backing.removeItem(key),
  clear: () => backing.clear(),
};
const originalWindow = window.localStorage;
const originalGlobal = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
Object.defineProperty(window, "localStorage", { configurable: true, value: switchable });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: switchable });

const { finishTask, startTask, updateTask, useTasksStore } = await import("../src/lib/tasks");
const { useQueryHistoryStore } = await import("../src/lib/query-history");
const { createChangedOnlyJsonStorage, createSafeJsonStorage } = await import(
  "../src/lib/buffered-storage"
);
const { create } = await import("zustand");
const { persist } = await import("zustand/middleware");
const { toast } = await import("sonner");
const toastError = spyOn(toast, "error").mockImplementation(() => "");
const warn = spyOn(console, "warn").mockImplementation(() => {});

function seed(count: number) {
  useTasksStore.setState({
    tasks: Array.from({ length: count }, (_, index) => ({
      id: `old-${index}`,
      title: "SQL-Abfrage",
      startedAt: index,
      finishedAt: index,
      status: "error" as const,
      error: `ORA-06550 ${"x".repeat(50_000)}`,
      cancellable: false,
    })),
  });
}

beforeEach(() => {
  backing = quotaStorage(Number.POSITIVE_INFINITY);
  useTasksStore.setState({ tasks: [], open: false });
  attempts = 0;
  warn.mockClear();
});

afterAll(() => {
  warn.mockRestore();
  toastError.mockRestore();
  Object.defineProperty(window, "localStorage", { configurable: true, value: originalWindow });
  if (originalGlobal) Object.defineProperty(globalThis, "localStorage", originalGlobal);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

test("a full localStorage never breaks starting, updating or finishing a task", () => {
  seed(100);
  backing = quotaStorage(0);
  backing.data.set(KEY, "stale");

  const id = startTask({ title: "SQL-Abfrage", connectionId: "c" });
  updateTask(id, { progress: 5 });
  finishTask(id, { rows: [] }, new Error("ORA-00942"));

  const task = useTasksStore.getState().tasks.find((entry) => entry.id === id);
  expect(task?.status).toBe("error");
  expect(task?.error).toBe("ORA-00942");
  expect(backing.data.get(KEY)).toBe("stale");
  expect(warn).toHaveBeenCalled();
});

test("shrinks the persisted history to fit and truncates long messages", () => {
  seed(100);
  backing = quotaStorage(30_000);

  const id = startTask({ title: "SQL-Abfrage", connectionId: "c" });

  const saved = JSON.parse(backing.data.get(KEY) ?? "{}") as {
    state: { tasks: { id: string; error?: string }[] };
  };
  expect(saved.state.tasks[0]?.id).toBe(id);
  expect(saved.state.tasks.length).toBeGreaterThan(1);
  expect(saved.state.tasks.length).toBeLessThan(101);
  expect(Math.max(...saved.state.tasks.map((task) => task.error?.length ?? 0))).toBe(2001);
  expect(useTasksStore.getState().tasks[1]?.error?.length).toBe(50_010);
});

test("progress updates under a full quota stay bounded in attempts and latency", () => {
  seed(100);
  backing = quotaStorage(0);
  const id = startTask({ title: "CSV-Export", connectionId: "c" });

  const timings: number[] = [];
  for (let step = 0; step < 200; step++) {
    attempts = 0;
    const started = performance.now();
    updateTask(id, { progress: step });
    timings.push(performance.now() - started);
    expect(attempts).toBeLessThanOrEqual(9);
  }
  timings.sort((a, b) => a - b);
  const median = timings[100] ?? 0;
  const p95 = timings[190] ?? 0;
  console.info(
    `tasks quota fallback: 101 tasks, median ${median.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms`,
  );
  expect(p95).toBeLessThan(25);
});

test("a non-quota storage failure keeps the saved history and does not throw", () => {
  backing = quotaStorage(Number.POSITIVE_INFINITY);
  backing.data.set(KEY, "previous");
  backing.setItem = () => {
    throw new DOMException("denied", "SecurityError");
  };

  expect(() => startTask({ title: "SQL-Abfrage", connectionId: "c" })).not.toThrow();
  expect(backing.data.get(KEY)).toBe("previous");
  expect(warn).toHaveBeenCalled();
});

test("recording query history on a full localStorage does not fail the query", () => {
  backing = quotaStorage(0);
  backing.data.set("l8db.query-history", "previous");
  const before = useQueryHistoryStore.getState().entries.length;

  expect(() =>
    useQueryHistoryStore.getState().record({
      connectionId: "c",
      database: null,
      sql: "SELECT * FROM kunden",
      durationMs: 3,
      rowCount: 50,
      error: null,
    }),
  ).not.toThrow();

  expect(useQueryHistoryStore.getState().entries.length).toBe(before + 1);
  expect(backing.data.get("l8db.query-history")).toBe("previous");
  expect(warn).toHaveBeenCalled();
});

test("plain persisted stores keep writing normally and survive a full localStorage", () => {
  const safe = create<{ n: number }>()(
    persist(() => ({ n: 0 }), { name: "qa.safe", storage: createSafeJsonStorage() }),
  );
  const changed = create<{ n: number }>()(
    persist(() => ({ n: 0 }), { name: "qa.changed", storage: createChangedOnlyJsonStorage() }),
  );
  safe.setState({ n: 1 });
  changed.setState({ n: 1 });
  expect(backing.data.get("qa.safe")).toBe(JSON.stringify({ state: { n: 1 }, version: 0 }));
  expect(backing.data.get("qa.changed")).toBe(JSON.stringify({ state: { n: 1 }, version: 0 }));

  backing = quotaStorage(0);
  for (let n = 2; n <= 50; n++) {
    expect(() => safe.setState({ n })).not.toThrow();
    expect(() => changed.setState({ n })).not.toThrow();
  }

  expect(safe.getState().n).toBe(50);
  expect(changed.getState().n).toBe(50);
  expect(warn).toHaveBeenCalled();
  expect(toastError.mock.calls.length).toBeLessThanOrEqual(1);
});
