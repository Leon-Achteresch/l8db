import { expect, mock, test } from "bun:test";
import { reportScenario } from "../scripts/performance-report";

const session = {
  inBlock: true,
  aborted: false,
  savepoints: new Set<string>(),
  inFlight: 0,
};
const pending = new Map<string, (error: Error) => void>();
const counts = { queries: 0, cancels: 0 };
const EMPTY = { columns: [], rows: [], rows_affected: null, execution_time_ms: 0 };

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown>) => {
    if (command === "cancel_execution") {
      counts.cancels++;
      const jobId = String(args.jobId);
      const reject = pending.get(jobId);
      pending.delete(jobId);
      reject?.(new Error("ERROR: canceling statement due to user request (SQLSTATE 57014)"));
      return Boolean(reject);
    }
    if (command !== "execute_query") return null;
    counts.queries++;
    const sql = String(args.sql);
    const savepoint = /^(SAVEPOINT|ROLLBACK TO SAVEPOINT|RELEASE SAVEPOINT) (\w+)$/.exec(sql);
    if (savepoint) {
      const [, verb, name] = savepoint;
      if (verb === "SAVEPOINT") session.savepoints.add(name);
      else if (verb === "RELEASE SAVEPOINT") session.savepoints.delete(name);
      else session.aborted = false;
      return EMPTY;
    }
    if (session.aborted) throw new Error("current transaction is aborted (SQLSTATE 25P02)");
    const jobId = String((args.options as Record<string, unknown>).jobId);
    session.inFlight++;
    return new Promise((_, reject) => {
      pending.set(jobId, (error) => {
        session.inFlight--;
        session.aborted = true;
        reject(error);
      });
    });
  },
}));

const { deriveDmlPreview } = await import("../src/lib/dml-preview");
const { dmlPreviewExecutor } = await import("../src/lib/dml-preview/executor");
const { createPreviewLifecycle } = await import("../src/lib/dml-preview/lifecycle");
const { useServerOutputStore } = await import("../src/lib/server-output");

const PREVIEWS = 200;
const connection = {
  id: "perf-soft-cancel",
  name: "PG",
  kind: "postgres" as const,
  connectionString: "postgresql://app@perf.example.test:5432/app",
  sslMode: "prefer" as const,
};

const nextTick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("200 previews cancelled mid-flight settle quickly and leave the editor session clean", async () => {
  const plan = deriveDmlPreview("DELETE FROM orders WHERE created < '2026-01-01'", "postgres");
  if (plan?.status !== "ready") throw new Error("not derivable");
  useServerOutputStore.getState().setEnabled(connection.id, true);
  const lifecycle = createPreviewLifecycle();
  const latencies: number[] = [];
  const requestsPerPreview: number[] = [];
  for (let index = 0; index < PREVIEWS; index++) {
    const before = counts.queries + counts.cancels;
    const controller = new AbortController();
    const running = lifecycle
      .start(plan, dmlPreviewExecutor(connection, "app", 10), { signal: controller.signal })
      .catch(() => undefined);
    while (session.inFlight === 0) await nextTick();
    const started = performance.now();
    controller.abort();
    await running;
    await lifecycle.idle();
    latencies.push(performance.now() - started);
    requestsPerPreview.push(counts.queries + counts.cancels - before);
  }
  useServerOutputStore.getState().setEnabled(connection.id, false);
  latencies.sort((left, right) => left - right);
  const median = latencies[Math.floor(latencies.length / 2)];
  const p95 = latencies[Math.ceil(latencies.length * 0.95) - 1];
  const maxRequests = Math.max(...requestsPerPreview);

  expect(new Set(requestsPerPreview)).toEqual(new Set([5]));
  expect(session).toMatchObject({ inBlock: true, aborted: false, inFlight: 0 });
  expect(session.savepoints.size).toBe(0);
  expect(pending.size).toBe(0);
  expect(lifecycle.holding()).toBe(false);
  expect(median).toBeLessThan(10);
  expect(p95).toBeLessThan(25);

  const timers = { timeout: 0, interval: 0 };
  const originalTimeout = globalThis.setTimeout;
  const originalInterval = globalThis.setInterval;
  globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
    timers.timeout++;
    return originalTimeout(...args);
  }) as typeof setTimeout;
  globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
    timers.interval++;
    return originalInterval(...args);
  }) as typeof setInterval;
  try {
    await new Promise<void>((resolve) => originalTimeout(resolve, 50));
  } finally {
    globalThis.setTimeout = originalTimeout;
    globalThis.setInterval = originalInterval;
  }
  expect(timers).toEqual({ timeout: 0, interval: 0 });

  await reportScenario("dml-preview-soft-cancel", {
    previews: PREVIEWS,
    settleMedianMs: Number(median.toFixed(3)),
    settleP95Ms: Number(p95.toFixed(3)),
    requestsPerCancelledPreview: maxRequests,
    requestBreakdown: "SAVEPOINT, COUNT, cancel_execution, ROLLBACK TO, RELEASE",
    extraRequestsPerCancel: maxRequests - 2,
    backendDrainProbesMax: 2,
    leakedSavepoints: session.savepoints.size,
    leakedInFlight: session.inFlight,
    pendingJobs: pending.size,
    idleTimers: timers.timeout + timers.interval,
    budgets: { settleMedianMs: 10, settleP95Ms: 25, requestsPerCancelledPreview: 5 },
  });
}, 60_000);
