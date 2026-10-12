import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import { MultiTargetResults } from "../src/features/query/multi-target/multi-target-results";
import type { QueryResult } from "../src/lib/db/types";
import {
  mergeResults,
  multiTarget,
  startMultiTargetRun,
  type TargetRun,
} from "../src/lib/multi-target";

const TARGETS = 50;
const ROWS = 1000;
const CONCURRENCY = 4;

function tenantResult(tenant: number): QueryResult {
  return {
    columns: ["id", "tenant", "email", "balance"],
    rows: Array.from({ length: ROWS }, (_, id) => ({
      id,
      tenant,
      email: `user${id}@tenant${tenant}.example`,
      balance: id * 1.5,
    })),
    rows_affected: null,
    execution_time_ms: 2,
  };
}

const RESULTS = Array.from({ length: TARGETS }, (_, index) => tenantResult(index));
const TARGET_LIST = Array.from({ length: TARGETS }, (_, index) =>
  multiTarget(`server-${index % 5}`, `tenant_${index}`),
);

function latency(index: number) {
  return 2 + ((index * 7) % 5);
}

async function runAll() {
  let inFlight = 0;
  let peak = 0;
  let requests = 0;
  const runs = new Map<string, TargetRun>();
  const handle = startMultiTargetRun({
    targets: TARGET_LIST,
    sql: "SELECT id, tenant, email, balance FROM accounts",
    concurrency: CONCURRENCY,
    perServerLimit: 8,
    timeoutSeconds: 30,
    maxRows: ROWS,
    executor: {
      execute: async ({ target }) => {
        requests++;
        inFlight++;
        peak = Math.max(peak, inFlight);
        const index = Number(target.database?.split("_")[1]);
        await new Promise((resolve) => setTimeout(resolve, latency(index)));
        inFlight--;
        return RESULTS[index];
      },
      cancel: async () => false,
    },
    onUpdate: (run) => runs.set(run.id, run),
  });
  await handle.done;
  return { runs, peak, requests, stats: handle.stats() };
}

test("50 targets × 1000 rows stay within the concurrency limit with bounded output", async () => {
  let last = await runAll();
  const timing = await measureScenario(async () => {
    last = await runAll();
  }, 7);
  expect(last.peak).toBeLessThanOrEqual(CONCURRENCY);
  expect(last.peak).toBe(CONCURRENCY);
  expect(last.requests).toBe(TARGETS);
  expect(last.stats).toMatchObject({ active: 0, queued: 0, started: TARGETS });
  expect([...last.runs.values()].every((run) => run.status === "done")).toBe(true);
  const serialMs = TARGET_LIST.reduce((sum, _, index) => sum + latency(index), 0);

  const items = TARGET_LIST.map((target) => ({
    id: target.id,
    label: `${target.connectionId} · ${target.database}`,
    production: false,
  }));
  let mergedRows = 0;
  const merge = await measureScenario(() => {
    const merged = mergeResults(
      items.map((item, index) => ({ label: item.label, result: RESULTS[index] })),
    );
    if (!merged.ok) throw new Error(merged.reason);
    mergedRows = merged.result.rows.length;
  }, 7);

  Bun.gc(true);
  const before = heapStats().heapSize;
  const retained = mergeResults(
    items.map((item, index) => ({ label: item.label, result: RESULTS[index] })),
  );
  Bun.gc(true);
  const mergedHeapBytes = heapStats().heapSize - before;
  expect(retained.ok && retained.result.rows.length).toBe(TARGETS * ROWS);

  const runs = Object.fromEntries(last.runs);
  const markup = renderToStaticMarkup(
    createElement(MultiTargetResults, { items, runs, kind: "postgres", onCancel: () => undefined }),
  );
  const renderedRows = markup.match(/data-multi-target-row=/g)?.length ?? 0;
  const renderedGrids = markup.match(/data-multi-target-grid/g)?.length ?? 0;

  expect(mergedRows).toBe(TARGETS * ROWS);
  expect(renderedRows).toBeGreaterThan(0);
  expect(renderedRows).toBeLessThanOrEqual(20);
  expect(renderedGrids).toBe(0);
  expect(markup.length / renderedRows).toBeLessThan(4_000);
  expect(mergedHeapBytes).toBeGreaterThan(0);
  expect(timing.p95Ms).toBeLessThan(serialMs);
  expect(timing.p95Ms).toBeLessThan(250);
  expect(merge.p95Ms).toBeLessThan(150);
  expect(mergedHeapBytes).toBeLessThan(40 * 1024 * 1024);

  await reportScenario("multi-target-run", {
    targets: TARGETS,
    rowsPerTarget: ROWS,
    concurrencyLimit: CONCURRENCY,
    peakInFlight: last.peak,
    requests: last.requests,
    simulatedSerialMs: serialMs,
    total: timing,
    merge,
    mergedRows,
    mergedHeapBytes,
    renderedResultRows: renderedRows,
    renderedGrids,
    renderedBytes: markup.length,
    budgets: { totalP95Ms: 250, mergeP95Ms: 150, mergedHeapBytes: 40 * 1024 * 1024 },
  });
}, 60_000);

test("cancel stops new requests immediately and idle runs leave no background work", async () => {
  let requests = 0;
  const handle = startMultiTargetRun({
    targets: TARGET_LIST,
    sql: "SELECT 1",
    concurrency: CONCURRENCY,
    perServerLimit: 8,
    timeoutSeconds: 30,
    maxRows: ROWS,
    executor: {
      execute: ({ target }) => {
        requests++;
        return new Promise((resolve) =>
          setTimeout(() => resolve(RESULTS[Number(target.database?.split("_")[1])]), 15),
        );
      },
      cancel: async () => true,
    },
    onUpdate: () => undefined,
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const atCancel = requests;
  const started = performance.now();
  handle.cancelAll();
  await handle.done;
  const settleMs = performance.now() - started;
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(requests).toBe(atCancel);
  expect(requests).toBeLessThanOrEqual(CONCURRENCY * 2);
  expect(handle.stats()).toMatchObject({ active: 0, queued: 0 });

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
  await reportScenario("multi-target-cancel", {
    targets: TARGETS,
    requestsBeforeCancel: atCancel,
    requestsAfterCancel: requests - atCancel,
    cancelSettleMs: Math.round(settleMs),
    idleTimers: timers.timeout + timers.interval,
  });
});
