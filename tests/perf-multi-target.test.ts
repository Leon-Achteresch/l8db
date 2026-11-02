import { heapSize } from "bun:jsc";
import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import { MultiTargetResults } from "../src/features/query/multi-target/multi-target-results";
import type { SavedConnection } from "../src/lib/connections";
import { useConnectionsStore } from "../src/lib/connections/store";
import type { QueryResult } from "../src/lib/db/types";
import {
  mergeResults,
  multiTarget,
  startMultiTargetRun,
  type TargetRun,
} from "../src/lib/multi-target";
import { multiTargetExecutor } from "../src/lib/multi-target/executor";
import { usePasswordPrompt } from "../src/lib/password-prompt";

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
  const serialStarted = performance.now();
  for (let index = 0; index < TARGETS; index++)
    await new Promise((resolve) => setTimeout(resolve, latency(index)));
  const measuredSerialMs = performance.now() - serialStarted;

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
  const before = heapSize();
  const retained = mergeResults(
    items.map((item, index) => ({ label: item.label, result: RESULTS[index] })),
  );
  Bun.gc(true);
  const mergedHeapBytes = heapSize() - before;
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
  expect(timing.p95Ms).toBeLessThan(measuredSerialMs);
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
    measuredSerialMs,
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

test("password prompts of many connections queue once per connection; cancel withdraws them", async () => {
  const connectionCount = 200;
  const databases = 3;
  const connections: SavedConnection[] = Array.from({ length: connectionCount }, (_, index) => ({
    id: `pw-${index}`,
    name: `PW ${index}`,
    kind: "postgres",
    connectionString: `postgresql://app@pw-${index}.example.test:5432/app`,
    sslMode: "prefer",
  }));
  const targets = connections.flatMap((connection) =>
    Array.from({ length: databases }, (_, database) =>
      multiTarget(connection.id, `db_${database}`),
    ),
  );
  const host = window as unknown as { __TAURI_INTERNALS__?: unknown };
  const previous = host.__TAURI_INTERNALS__;
  let queries = 0;
  let peakQueries = 0;
  let inFlight = 0;
  host.__TAURI_INTERNALS__ = {
    invoke: async (command: string) => {
      if (command !== "execute_query") return null;
      queries++;
      inFlight++;
      peakQueries = Math.max(peakQueries, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      return { columns: ["n"], rows: [{ n: 1 }], rows_affected: null, execution_time_ms: 1 };
    },
  };
  const start = (runs: Map<string, TargetRun>) =>
    startMultiTargetRun({
      targets,
      sql: "SELECT 1",
      concurrency: 16,
      perServerLimit: 8,
      timeoutSeconds: 30,
      maxRows: 10,
      executor: multiTargetExecutor(false),
      onUpdate: (run) => runs.set(run.id, run),
    });
  try {
    useConnectionsStore.setState({ connections });
    Bun.gc(true);
    const heapBefore = heapSize();
    const runs = new Map<string, TargetRun>();
    const answerMs: number[] = [];
    const prompted = new Set<string>();
    let prompts = 0;
    const started = performance.now();
    const handle = start(runs);
    let finished = false;
    void handle.done.then(() => {
      finished = true;
    });
    while (!finished) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const { connection, resolve } = usePasswordPrompt.getState();
      if (!connection || !resolve) continue;
      prompts++;
      prompted.add(connection.id);
      const answered = performance.now();
      resolve({ password: "pw", save: false });
      answerMs.push(performance.now() - answered);
    }
    const totalMs = performance.now() - started;
    Bun.gc(true);
    const retainedBytes = heapSize() - heapBefore;
    answerMs.sort((a, b) => a - b);
    const median = answerMs[Math.floor(answerMs.length / 2)];
    const p95 = answerMs[Math.floor(answerMs.length * 0.95)];
    expect(prompts).toBe(connectionCount);
    expect(prompted.size).toBe(connectionCount);
    expect(queries).toBe(connectionCount * databases);
    expect(peakQueries).toBeLessThanOrEqual(16);
    expect([...runs.values()].every((run) => run.status === "done")).toBe(true);
    expect(usePasswordPrompt.getState().connection).toBeNull();
    expect(p95).toBeLessThan(5);
    expect(totalMs).toBeLessThan(5_000);
    expect(retainedBytes).toBeLessThan(16 * 1024 * 1024);

    useConnectionsStore.setState({ connections });
    queries = 0;
    const cancelled = new Map<string, TargetRun>();
    const pending = start(cancelled);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(usePasswordPrompt.getState().connection).not.toBeNull();
    const cancelStarted = performance.now();
    pending.cancelAll();
    await pending.done;
    const cancelSettleMs = performance.now() - cancelStarted;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(usePasswordPrompt.getState().connection).toBeNull();
    expect(queries).toBe(0);
    expect([...cancelled.values()].every((run) => run.status === "cancelled")).toBe(true);
    expect(pending.stats()).toMatchObject({ active: 0, queued: 0 });
    expect(cancelSettleMs).toBeLessThan(250);

    await reportScenario("multi-target-password-prompts", {
      connections: connectionCount,
      targets: targets.length,
      prompts,
      queries: connectionCount * databases,
      peakQueries,
      answerToNextPromptMs: { median, p95 },
      totalMs: Math.round(totalMs),
      retainedBytes,
      cancelSettleMs: Math.round(cancelSettleMs),
      budgets: { answerP95Ms: 5, totalMs: 5_000, retainedBytes: 16 * 1024 * 1024, cancelMs: 250 },
    });
  } finally {
    host.__TAURI_INTERNALS__ = previous;
    useConnectionsStore.setState({ connections: [] });
  }
}, 60_000);
