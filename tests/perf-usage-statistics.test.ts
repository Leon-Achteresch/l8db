import { expect, test } from "bun:test";
import { arch, cpus, platform, release, totalmem } from "node:os";
import {
  createUsageStatisticsStore,
  USAGE_FLUSH_MS,
  USAGE_GROUP_LIMIT,
  USAGE_SESSION_LIMIT,
  USAGE_STORAGE_PREFIX,
  type UsageEvent,
} from "../src/lib/usage-statistics";
import { measureScenario, reportScenario } from "./fixtures/usage-performance";

class PerformanceStorage implements Storage {
  readonly values = new Map<string, string>();
  writes = 0;
  reads = 0;
  removals = 0;

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    this.reads++;
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.removals++;
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.writes++;
    this.values.set(key, value);
  }
}

const routes = [
  "home",
  "connections",
  "query",
  "tables",
  "dashboard",
  "ai",
  "notebook",
  "workbench",
  "compare",
  "versioning",
  "automation",
  "health",
  "monitor",
  "sessions",
  "backup",
  "import",
];

const operations = [
  "query",
  "browse",
  "connect",
  "export",
  "import",
  "transfer",
  "commit",
  "rollback",
  "tunnel",
  "driver",
  "user-query",
];

const kinds = [
  "postgres",
  "mysql",
  "sqlite",
  "mssql",
  "clickhouse",
  "mongodb",
  "redis",
  "oracle",
  "cassandra",
  "duckdb",
  "odbc",
  "elasticsearch",
  "influxdb",
  "sqlite_http",
  "dynamodb",
  "athena",
  "bigquery",
  "snowflake",
  "s3",
  "unknown",
];

function fixture(storage: PerformanceStorage, id: string) {
  let time = 1000;
  let schedules = 0;
  let cancellations = 0;
  const pending = new Map<number, { callback: () => void; due: number }>();
  const store = createUsageStatisticsStore({
    storage,
    id,
    now: () => time,
    schedule: (callback, delay) => {
      const timer = ++schedules;
      pending.set(timer, { callback, due: time + delay });
      return timer as unknown as ReturnType<typeof setTimeout>;
    },
    cancel: (timer) => {
      pending.delete(timer as unknown as number);
      cancellations++;
    },
  });
  return {
    store,
    pending,
    schedules: () => schedules,
    cancellations: () => cancellations,
    advance: (ms: number) => {
      time += ms;
      for (const [timer, task] of [...pending]) {
        if (task.due > time) continue;
        pending.delete(timer);
        task.callback();
      }
    },
  };
}

function event(index: number): UsageEvent {
  if (index === 0) return { type: "startup", ms: 500 };
  const view = routes[Math.floor(index / 10) % routes.length];
  switch (index % 10) {
    case 0:
      return { type: "view", view };
    case 1:
      return {
        type: "transition",
        from: view,
        to: routes[(Math.floor(index / 10) + 1) % routes.length],
      };
    case 2:
      return { type: "active", view, ms: 250 + (index % 30000) };
    default:
      return {
        type: "operation",
        operation: operations[Math.floor(index / 10) % operations.length],
        kind: kinds[Math.floor(index / 110) % kinds.length],
        status: index % 19 === 0 ? "error" : index % 23 === 0 ? "cancelled" : "ok",
        ms: index % 10007 === 0 ? 60000 : 1 + (index % 2000),
      };
  }
}

function encodedBytes(value: string) {
  return new TextEncoder().encode(value).length;
}

function environment() {
  return {
    os: `${platform()} ${release()}`,
    architecture: arch(),
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    ramBytes: totalmem(),
    runtime: `Bun ${Bun.version}`,
    cpuSimulation: false,
    heapSimulation: false,
    coverage: "Pure local aggregation; no browser rendering or live database families",
  };
}

test("100000 mixed usage events stay bounded and coalesce to one deferred write", async () => {
  const storage = new PerformanceStorage();
  const f = fixture(storage, "100000-events");
  const events = Array.from({ length: 100000 }, (_, index) => event(index));
  const samples: number[] = [];
  try {
    const started = performance.now();
    for (let batch = 0; batch < 100; batch++) {
      const batchStarted = performance.now();
      for (let offset = 0; offset < 1000; offset++) f.store.record(events[batch * 1000 + offset]);
      samples.push(performance.now() - batchStarted);
    }
    const totalRecordMs = performance.now() - started;
    samples.sort((left, right) => left - right);
    const medianMs = samples[50];
    const p95Ms = samples[94];
    expect(f.schedules()).toBe(1);
    expect(f.pending.size).toBe(1);
    expect(storage.writes).toBe(0);
    f.advance(USAGE_FLUSH_MS);
    expect(storage.writes).toBe(1);
    expect(f.pending.size).toBe(0);
    const snapshot = f.store.getSnapshot();
    expect(snapshot.sessionCount).toBe(1);
    expect(snapshot.views).toHaveLength(routes.length);
    expect(snapshot.views.reduce((sum, view) => sum + view.opens, 0)).toBe(9999);
    expect(snapshot.startup.count).toBe(1);
    expect(snapshot.operations.length).toBeLessThanOrEqual(USAGE_GROUP_LIMIT);
    expect(snapshot.transitions.length).toBeLessThanOrEqual(USAGE_GROUP_LIMIT);
    const retainedBytes = encodedBytes(
      storage.values.get(`${USAGE_STORAGE_PREFIX}100000-events`) ?? "",
    );
    expect(retainedBytes).toBeGreaterThan(0);
    expect(retainedBytes).toBeLessThanOrEqual(64 * 1024);
    const readsBeforeIdle = storage.reads;
    f.advance(3600000);
    expect(storage.reads).toBe(readsBeforeIdle);
    expect(storage.writes).toBe(1);
    expect(f.schedules()).toBe(1);
    expect(medianMs).toBeLessThan(10);
    expect(p95Ms).toBeLessThan(20);
    expect(totalRecordMs).toBeLessThan(1000);
    const source = await Bun.file(
      new URL("../src/lib/usage-statistics.ts", import.meta.url),
    ).text();
    expect(source).not.toMatch(
      /from\s+["'][^"']*(?:\/db\/|tauri)|\b(?:fetch|invoke|WebSocket|XMLHttpRequest)\s*\(/,
    );
    await reportScenario("usage-statistics-events", {
      ...environment(),
      events: events.length,
      batches: samples.length,
      eventsPerBatch: 1000,
      medianMs,
      p95Ms,
      totalRecordMs,
      retainedBytes,
      retainedOperations: snapshot.operations.length,
      retainedTransitions: snapshot.transitions.length,
      writes: storage.writes,
      scheduledFlushes: f.schedules(),
      idleWrites: 0,
      idleReads: storage.reads - readsBeforeIdle,
      databaseRequests: 0,
      networkRequests: 0,
      transportEvidence: "Store module has no database or network transport",
      limits: {
        batchMedianMs: 10,
        batchP95Ms: 20,
        totalRecordMs: 1000,
        retainedBytes: 64 * 1024,
        writes: 1,
      },
    });
  } finally {
    f.store.dispose();
  }
});

test("32 full window sessions keep summary latency and retained storage bounded", async () => {
  const storage = new PerformanceStorage();
  for (let session = 0; session < USAGE_SESSION_LIMIT; session++) {
    const f = fixture(storage, String(session).padStart(3, "0"));
    let transitionCount = 0;
    for (const from of routes) {
      for (const to of routes) {
        if (from === to || transitionCount >= USAGE_GROUP_LIMIT) continue;
        f.store.record({ type: "transition", from, to });
        transitionCount++;
      }
    }
    for (let group = 0; group < USAGE_GROUP_LIMIT; group++) {
      const index = (group + session * 7) % (operations.length * kinds.length);
      f.store.record({
        type: "operation",
        operation: operations[Math.floor(index / kinds.length)],
        kind: kinds[index % kinds.length],
        status: group % 11 === 0 ? "error" : group % 17 === 0 ? "cancelled" : "ok",
        ms: 1 + group * 25,
      });
    }
    for (const view of routes) {
      f.store.record({ type: "view", view });
      f.store.record({ type: "active", view, ms: 10000 });
    }
    f.store.record({ type: "startup", ms: 500 });
    f.store.dispose();
  }
  expect(storage.writes).toBe(USAGE_SESSION_LIMIT);
  expect(storage.removals).toBe(0);
  const bytes = [...storage.values.values()].map(encodedBytes);
  const retainedBytes = bytes.reduce((sum, value) => sum + value, 0);
  expect(Math.max(...bytes)).toBeLessThanOrEqual(64 * 1024);
  expect(retainedBytes).toBeLessThanOrEqual(USAGE_SESSION_LIMIT * 64 * 1024);
  const reader = fixture(storage, "reader");
  try {
    const timing = await measureScenario(() => reader.store.refresh());
    const snapshot = reader.store.getSnapshot();
    expect(snapshot.sessionCount).toBe(USAGE_SESSION_LIMIT);
    expect(snapshot.views).toHaveLength(routes.length);
    expect(snapshot.transitions.length).toBeLessThanOrEqual(USAGE_GROUP_LIMIT);
    expect(snapshot.operations.length).toBeLessThanOrEqual(operations.length * kinds.length);
    expect(snapshot.startup.count).toBe(USAGE_SESSION_LIMIT);
    expect(storage.writes).toBe(USAGE_SESSION_LIMIT);
    expect(reader.pending.size).toBe(0);
    expect(timing.medianMs).toBeLessThan(25);
    expect(timing.p95Ms).toBeLessThan(50);
    await reportScenario("usage-statistics-summary", {
      ...environment(),
      ...timing,
      sessions: USAGE_SESSION_LIMIT,
      operationGroupsPerSession: USAGE_GROUP_LIMIT,
      transitionGroupsPerSession: USAGE_GROUP_LIMIT,
      retainedBytes,
      largestSessionBytes: Math.max(...bytes),
      summaryOperationGroups: snapshot.operations.length,
      summaryTransitionGroups: snapshot.transitions.length,
      summaryWrites: storage.writes - USAGE_SESSION_LIMIT,
      scheduledFlushes: reader.schedules(),
      databaseRequests: 0,
      limits: {
        medianMs: 25,
        p95Ms: 50,
        retainedBytes: USAGE_SESSION_LIMIT * 64 * 1024,
        summaryWrites: 0,
      },
    });
  } finally {
    reader.store.dispose();
  }
});

test("abandoned aggregation cancels its timer and leaves no idle storage traffic", async () => {
  const storage = new PerformanceStorage();
  const f = fixture(storage, "cancelled");
  for (let index = 0; index < 10000; index++) f.store.record(event(index));
  expect(f.pending.size).toBe(1);
  expect(storage.writes).toBe(0);
  f.store.clear();
  const writesAfterClear = storage.writes;
  const readsAfterClear = storage.reads;
  expect(f.pending.size).toBe(0);
  expect(f.cancellations()).toBe(1);
  f.advance(3600000);
  expect(storage.writes).toBe(writesAfterClear);
  expect(storage.reads).toBe(readsAfterClear);
  expect(
    [...storage.values.keys()].filter((key) => key.startsWith(USAGE_STORAGE_PREFIX)),
  ).toHaveLength(0);
  f.store.record({ type: "view", view: "query" });
  f.store.dispose();
  const writesAfterDispose = storage.writes;
  const readsAfterDispose = storage.reads;
  for (let index = 0; index < 10000; index++) f.store.record(event(index));
  f.advance(3600000);
  expect(f.pending.size).toBe(0);
  expect(storage.writes).toBe(writesAfterDispose);
  expect(storage.reads).toBe(readsAfterDispose);
  await reportScenario("usage-statistics-cancellation", {
    eventsBeforeClear: 10000,
    eventsAfterDispose: 10000,
    cancellations: f.cancellations(),
    idleMs: 7200000,
    idleReads: storage.reads - readsAfterDispose,
    idleWrites: storage.writes - writesAfterDispose,
    pendingTimers: f.pending.size,
    databaseRequests: 0,
  });
});
