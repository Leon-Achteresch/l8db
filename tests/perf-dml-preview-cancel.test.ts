import { expect, mock, test } from "bun:test";
import { reportScenario } from "../scripts/performance-report";

const connections = { opened: 0, discarded: 0, closedClean: 0 };
const statements: string[][] = [];
const pending = new Map<string, (error: Error) => void>();
const counts = { previews: 0, cancels: 0 };
let hold = true;

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
    if (command !== "preview_dml") return null;
    counts.previews++;
    connections.opened++;
    const request = args.request as { countSql: string; sampleSql: string };
    const log = ["BEGIN READ ONLY", "SET LOCAL statement_timeout", request.countSql];
    statements.push(log);
    if (hold) {
      const jobId = String((args.options as Record<string, unknown>).jobId);
      try {
        await new Promise<never>((_, reject) => pending.set(jobId, reject));
      } finally {
        connections.discarded++;
      }
    }
    log.push(request.sampleSql);
    connections.closedClean++;
    return {
      count: { columns: ["n"], rows: [{ n: "1" }], rows_affected: null, execution_time_ms: 0 },
      sample: { columns: ["id"], rows: [{ id: 1 }], rows_affected: null, execution_time_ms: 0 },
      readOnly: true,
    };
  },
}));

const { deriveDmlPreview, runDmlPreview } = await import("../src/lib/dml-preview");
const { dmlPreviewExecutor } = await import("../src/lib/dml-preview/executor");
const { FALLBACK_PROVIDERS, useProvidersStore } = await import("../src/lib/providers");
useProvidersStore.setState({ providers: FALLBACK_PROVIDERS, loaded: true });

const PREVIEWS = 200;
const connection = {
  id: "perf-isolated-cancel",
  name: "PG",
  kind: "postgres" as const,
  connectionString: "postgresql://app@perf.example.test:5432/app",
  sslMode: "prefer" as const,
};

test("200 previews cancelled mid-flight discard their isolated connections", async () => {
  const plan = deriveDmlPreview("DELETE FROM orders WHERE created < '2026-01-01'", "postgres");
  if (plan?.status !== "ready") throw new Error("not derivable");
  const latencies: number[] = [];
  const requestsPerPreview: number[] = [];
  for (let index = 0; index < PREVIEWS; index++) {
    const before = counts.previews + counts.cancels;
    const controller = new AbortController();
    const running = runDmlPreview(plan, dmlPreviewExecutor(connection, "app", 10), {
      signal: controller.signal,
    }).catch(() => undefined);
    while (pending.size === 0) await new Promise((resolve) => setImmediate(resolve));
    const started = performance.now();
    controller.abort();
    await running;
    latencies.push(performance.now() - started);
    requestsPerPreview.push(counts.previews + counts.cancels - before);
  }
  hold = false;
  await runDmlPreview(plan, dmlPreviewExecutor(connection, "app", 10));
  latencies.sort((left, right) => left - right);
  const median = latencies[Math.floor(latencies.length / 2)];
  const p95 = latencies[Math.ceil(latencies.length * 0.95) - 1];

  expect(new Set(requestsPerPreview)).toEqual(new Set([2]));
  expect(connections.discarded).toBe(PREVIEWS);
  expect(connections.opened).toBe(PREVIEWS + 1);
  expect(connections.opened - connections.discarded - connections.closedClean).toBe(0);
  expect(pending.size).toBe(0);
  expect(statements.slice(0, PREVIEWS).every((log) => log.length === 3)).toBe(true);
  expect(statements.at(-1)).toHaveLength(4);
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

  await reportScenario("dml-preview-isolated-cancel", {
    previews: PREVIEWS,
    settleMedianMs: Number(median.toFixed(3)),
    settleP95Ms: Number(p95.toFixed(3)),
    requestsPerCancelledPreview: 2,
    requestBreakdown: "preview_dml, cancel_execution",
    statementsPerCancelledPreview: 3,
    statementsPerCompletedPreview: statements.at(-1)?.length,
    statementSequence:
      "BEGIN READ ONLY, SET LOCAL statement_timeout, COUNT, sample, close connection (implicit rollback)",
    discardedConnections: connections.discarded,
    leakedConnections: connections.opened - connections.discarded - connections.closedClean,
    pendingJobs: pending.size,
    idleTimers: timers.timeout + timers.interval,
    budgets: { settleMedianMs: 10, settleP95Ms: 25, discardedConnectionsPerCancel: 1 },
  });
}, 60_000);
