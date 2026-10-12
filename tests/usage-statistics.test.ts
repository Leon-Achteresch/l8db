import { describe, expect, test } from "bun:test";
import {
  createUsageStatisticsStore,
  DURATION_BUCKETS,
  durationPercentile,
  exportUsageStatistics,
  normalizeUsageKind,
  normalizeUsageView,
  USAGE_FLUSH_MS,
  USAGE_GROUP_LIMIT,
  USAGE_RESET_KEY,
  USAGE_SESSION_LIMIT,
  USAGE_STORAGE_PREFIX,
  type UsageEvent,
  usageOperationLabel,
  usageViewLabel,
} from "../src/lib/usage-statistics";

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  readonly writes: { key: string; value: string }[] = [];
  readonly removals: string[] = [];
  reads = 0;
  fail = false;

  get length() {
    if (this.fail) throw new Error("Storage unavailable");
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    this.reads++;
    if (this.fail) throw new Error("Storage unavailable");
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    if (this.fail) throw new Error("Storage unavailable");
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    if (this.fail) throw new Error("Storage unavailable");
    this.removals.push(key);
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    if (this.fail) throw new Error("Storage unavailable");
    this.writes.push({ key, value });
    this.values.set(key, value);
  }
}

function fixture(storage: MemoryStorage | null = new MemoryStorage(), id = "writer") {
  let time = 1000;
  let scheduled = 0;
  const pending = new Map<number, { callback: () => void; due: number }>();
  const cancelled: number[] = [];
  const store = createUsageStatisticsStore({
    storage,
    id,
    now: () => time,
    schedule: (callback, delay) => {
      const timer = ++scheduled;
      pending.set(timer, { callback, due: time + delay });
      return timer as unknown as ReturnType<typeof setTimeout>;
    },
    cancel: (timer) => {
      const id = timer as unknown as number;
      pending.delete(id);
      cancelled.push(id);
    },
  });
  return {
    store,
    storage,
    pending,
    cancelled,
    scheduled: () => scheduled,
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

const views = [
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

describe("local usage statistics", () => {
  test("normalizes routes and providers to fixed names without retaining identifiers", () => {
    expect(normalizeUsageView("/")).toBe("home");
    expect(normalizeUsageView("/_app/tables/$schema/$table")).toBe("tables");
    expect(normalizeUsageView("/tables/private/customers?token=secret")).toBe("tables");
    expect(normalizeUsageView("/settings/statistics")).toBe("settings.statistics");
    expect(normalizeUsageView("/settings/private-customer")).toBe("other");
    expect(normalizeUsageView("/private-customer/secret")).toBe("other");
    expect(normalizeUsageView("/constructor")).toBe("other");
    expect(normalizeUsageKind("postgres")).toBe("postgres");
    expect(normalizeUsageKind("postgres://name:password@host/db")).toBe("unknown");
    expect(normalizeUsageKind({ kind: "mysql" })).toBe("unknown");
    expect(usageViewLabel("settings.statistics")).toBe("Nutzungsstatistik");
    expect(usageViewLabel("secret")).toBe("Weitere Bereiche");
    expect(usageOperationLabel("user-query")).toBe("Abfragen im Editor");
    expect(usageOperationLabel("secret")).toBe("Weitere Aktionen");
  });

  test("aggregates opens, active time, routes, outcomes and bounded duration histograms", () => {
    const f = fixture();
    let notifications = 0;
    const unsubscribe = f.store.subscribe(() => notifications++);
    f.store.record({ type: "view", view: "query" });
    f.store.record({ type: "view", view: "query" });
    f.store.record({ type: "view", view: "tables" });
    f.store.record({ type: "active", view: "query", ms: 12.6 });
    f.store.record({ type: "transition", from: "query", to: "tables" });
    f.store.record({ type: "transition", from: "query", to: "tables" });
    f.store.record({ type: "transition", from: "tables", to: "tables" });
    f.store.record({
      type: "operation",
      operation: "query",
      kind: "postgres",
      status: "ok",
      ms: 1,
    });
    f.store.record({
      type: "operation",
      operation: "query",
      kind: "postgres",
      status: "error",
      ms: 5,
    });
    f.store.record({
      type: "operation",
      operation: "query",
      kind: "postgres",
      status: "cancelled",
      ms: 10,
    });
    f.store.record({ type: "startup", ms: 20.4 });
    expect(f.store.getSnapshot().sessionCount).toBe(0);
    expect(f.storage?.writes).toHaveLength(0);
    expect(f.pending.size).toBe(1);
    expect(f.scheduled()).toBe(1);
    f.advance(USAGE_FLUSH_MS);
    const snapshot = f.store.getSnapshot();
    expect(snapshot.sessionCount).toBe(1);
    expect(snapshot.startedAt).toBe(1000);
    expect(snapshot.updatedAt).toBe(1000);
    expect(snapshot.views).toEqual([
      { view: "query", opens: 2, activeMs: 13 },
      { view: "tables", opens: 1, activeMs: 0 },
    ]);
    expect(snapshot.transitions).toEqual([{ from: "query", to: "tables", count: 2 }]);
    expect(snapshot.operations).toEqual([
      {
        operation: "query",
        kind: "postgres",
        ok: 1,
        error: 1,
        cancelled: 1,
        totalMs: 16,
        histogram: [1, 1, 1, ...Array<number>(DURATION_BUCKETS.length - 2).fill(0)],
      },
    ]);
    expect(snapshot.startup.count).toBe(1);
    expect(snapshot.startup.totalMs).toBe(20);
    expect(durationPercentile(snapshot.startup.histogram, 0.95)).toBe(25);
    expect(f.storage?.writes).toHaveLength(1);
    expect(notifications).toBe(1);
    unsubscribe();
    f.store.refresh();
    expect(notifications).toBe(1);
    f.store.dispose();
  });

  test("rounds and caps durations while percentile estimates stay within fixed buckets", () => {
    const f = fixture();
    for (const ms of [...DURATION_BUCKETS, 300001, 100000000]) {
      f.store.record({ type: "operation", operation: "browse", kind: "sqlite", status: "ok", ms });
    }
    f.store.record({ type: "active", view: "tables", ms: 100000000 });
    f.store.flush();
    const operation = f.store.getSnapshot().operations[0];
    expect(operation.histogram).toEqual([...Array<number>(DURATION_BUCKETS.length).fill(1), 2]);
    expect(operation.totalMs).toBe(
      DURATION_BUCKETS.reduce((sum, ms) => sum + ms, 0) + 300001 + 86400000,
    );
    expect(f.store.getSnapshot().views[0].activeMs).toBe(86400000);
    expect(durationPercentile(operation.histogram, 0.5)).toBe(1000);
    expect(durationPercentile(operation.histogram, 0.95)).toBe(86400000);
    expect(durationPercentile(Array<number>(DURATION_BUCKETS.length + 1).fill(0), 0.95)).toBe(0);
    f.store.dispose();
  });

  test("ignores invalid durations, operations and outcomes before scheduling work", () => {
    const f = fixture();
    for (const ms of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      f.store.record({ type: "active", view: "query", ms });
      f.store.record({ type: "startup", ms });
      f.store.record({ type: "operation", operation: "query", kind: "postgres", status: "ok", ms });
    }
    f.store.record({
      type: "operation",
      operation: "secret-sql",
      kind: "postgres",
      status: "ok",
      ms: 10,
    });
    f.store.record({
      type: "operation",
      operation: "query",
      kind: "postgres",
      status: "invalid",
      ms: 10,
    } as unknown as UsageEvent);
    expect(f.scheduled()).toBe(0);
    f.store.flush();
    expect(f.store.getSnapshot().sessionCount).toBe(0);
    expect(f.storage?.writes).toHaveLength(0);
    f.store.dispose();
  });

  test("drops raw identifiers and arbitrary extra fields from loaded and exported data", () => {
    const storage = new MemoryStorage();
    const writer = fixture(storage, "source");
    writer.store.record({ type: "view", view: "private-customer" });
    writer.store.record({ type: "transition", from: "private-customer", to: "query" });
    writer.store.record({
      type: "operation",
      operation: "query",
      kind: "postgres://secret",
      status: "error",
      ms: 25,
    });
    writer.store.record({ type: "startup", ms: 100 });
    writer.store.flush();
    const key = `${USAGE_STORAGE_PREFIX}source`;
    const envelope = JSON.parse(storage.values.get(key) ?? "null");
    envelope.rawSql = "secret-sql";
    envelope.data.secret = "secret-password";
    envelope.data.views[0].route = "/tables/private/customers";
    envelope.data.transitions[0].rawRoute = "private-database";
    envelope.data.operations[0].sql = "secret-sql";
    envelope.data.operations[0].errorMessage = "secret-error";
    envelope.data.startup.machine = "secret-host";
    storage.values.set(key, JSON.stringify(envelope));
    const reader = fixture(storage, "reader");
    expect(reader.store.getSnapshot().sessionCount).toBe(1);
    expect(reader.store.getSnapshot().views).toEqual([{ view: "other", opens: 1, activeMs: 0 }]);
    expect(reader.store.getSnapshot().operations[0].kind).toBe("unknown");
    const encoded = JSON.stringify(reader.store.getSnapshot());
    for (const secret of ["secret", "private", "rawSql", "rawRoute", "errorMessage", "machine"]) {
      expect(encoded).not.toContain(secret);
    }
    const exported = JSON.parse(exportUsageStatistics());
    expect(exported.version).toBe(1);
    expect(exported.scope).toBe("local-last-32-window-sessions");
    expect(Object.keys(exported).sort()).toEqual([
      "operations",
      "scope",
      "sessionCount",
      "startedAt",
      "startup",
      "transitions",
      "updatedAt",
      "version",
      "views",
    ]);
    writer.store.dispose();
    reader.store.dispose();
  });

  test("rejects malformed, oversized, incompatible and invalid persisted sessions", () => {
    const storage = new MemoryStorage();
    const writer = fixture(storage, "valid");
    writer.store.record({ type: "view", view: "query" });
    writer.store.record({
      type: "operation",
      operation: "query",
      kind: "postgres",
      status: "ok",
      ms: 1,
    });
    writer.store.flush();
    const raw = storage.values.get(`${USAGE_STORAGE_PREFIX}valid`) ?? "null";
    const mutations = [
      (value: ReturnType<typeof JSON.parse>) => {
        value.version = 2;
      },
      (value: ReturnType<typeof JSON.parse>) => {
        value.epoch = "obsolete";
      },
      (value: ReturnType<typeof JSON.parse>) => {
        value.data.sessionCount = 2;
      },
      (value: ReturnType<typeof JSON.parse>) => {
        value.data.startedAt = -1;
      },
      (value: ReturnType<typeof JSON.parse>) => {
        value.data.startedAt = Number.MAX_SAFE_INTEGER;
      },
      (value: ReturnType<typeof JSON.parse>) => {
        value.data.updatedAt = null;
      },
      (value: ReturnType<typeof JSON.parse>) => {
        value.data.updatedAt = Number.MAX_SAFE_INTEGER;
      },
      (value: ReturnType<typeof JSON.parse>) => {
        value.data.views[0].view = "private-name";
      },
      (value: ReturnType<typeof JSON.parse>) => {
        value.data.views[0].opens = "1";
      },
      (value: ReturnType<typeof JSON.parse>) => {
        value.data.views = Array(USAGE_GROUP_LIMIT + 1).fill(value.data.views[0]);
      },
      (value: ReturnType<typeof JSON.parse>) => {
        value.data.transitions = [{ from: "query", to: "tables", count: -1 }];
      },
      (value: ReturnType<typeof JSON.parse>) => {
        value.data.operations[0].operation = "secret-command";
      },
      (value: ReturnType<typeof JSON.parse>) => {
        value.data.operations[0].kind = "private-provider";
      },
      (value: ReturnType<typeof JSON.parse>) => {
        value.data.operations[0].histogram = [1];
      },
      (value: ReturnType<typeof JSON.parse>) => {
        value.data.operations[0].histogram[0] = -1;
      },
      (value: ReturnType<typeof JSON.parse>) => {
        value.data.startup.totalMs = Number.MAX_SAFE_INTEGER + 1;
      },
    ];
    const reader = fixture(storage, "reader");
    for (const mutate of mutations) {
      const value = JSON.parse(raw);
      mutate(value);
      storage.values.set(`${USAGE_STORAGE_PREFIX}valid`, JSON.stringify(value));
      reader.store.refresh();
      expect(reader.store.getSnapshot().sessionCount).toBe(0);
    }
    for (const invalid of ["{", "null", "[]", "x".repeat(65537)]) {
      storage.values.set(`${USAGE_STORAGE_PREFIX}valid`, invalid);
      expect(() => reader.store.refresh()).not.toThrow();
      expect(reader.store.getSnapshot().sessionCount).toBe(0);
    }
    writer.store.dispose();
    reader.store.dispose();
  });

  test("separate writers preserve each other's events and publish a merged snapshot", () => {
    const storage = new MemoryStorage();
    const first = fixture(storage, "first");
    const second = fixture(storage, "second");
    first.store.record({ type: "view", view: "query" });
    second.store.record({ type: "view", view: "query" });
    second.store.record({ type: "view", view: "tables" });
    first.store.flush();
    second.store.flush();
    first.store.refresh();
    expect(first.store.getSnapshot()).toEqual(second.store.getSnapshot());
    expect(first.store.getSnapshot().sessionCount).toBe(2);
    expect(first.store.getSnapshot().views).toEqual([
      { view: "query", opens: 2, activeMs: 0 },
      { view: "tables", opens: 1, activeMs: 0 },
    ]);
    expect(storage.values.has(`${USAGE_STORAGE_PREFIX}first`)).toBe(true);
    expect(storage.values.has(`${USAGE_STORAGE_PREFIX}second`)).toBe(true);
    first.store.dispose();
    second.store.dispose();
  });

  test("reset epochs cancel stale writes and preserve new events in other windows", () => {
    const storage = new MemoryStorage();
    storage.values.set("l8db.connections", "keep-connections");
    const first = fixture(storage, "first");
    const second = fixture(storage, "second");
    first.store.record({ type: "view", view: "query" });
    first.store.flush();
    second.store.record({ type: "view", view: "tables" });
    first.store.clear();
    expect(storage.values.get("l8db.connections")).toBe("keep-connections");
    expect(storage.values.get(USAGE_RESET_KEY)).toBeTruthy();
    second.store.flush();
    expect(second.store.getSnapshot().sessionCount).toBe(0);
    expect(second.pending.size).toBe(0);
    expect(
      [...storage.values.keys()].filter((key) => key.startsWith(USAGE_STORAGE_PREFIX)),
    ).toHaveLength(0);
    second.store.record({ type: "view", view: "home" });
    first.store.clear();
    second.store.record({ type: "view", view: "dashboard" });
    second.store.flush();
    first.store.refresh();
    expect(first.store.getSnapshot().views).toEqual([{ view: "dashboard", opens: 1, activeMs: 0 }]);
    expect(first.store.getSnapshot().sessionCount).toBe(1);
    first.store.dispose();
    second.store.dispose();
  });

  test("retains at most 32 window sessions and leaves unrelated storage intact", () => {
    const storage = new MemoryStorage();
    storage.values.set("l8db.connections", "preserve");
    for (let index = 0; index < USAGE_SESSION_LIMIT + 8; index++) {
      const writer = fixture(storage, String(index).padStart(3, "0"));
      writer.store.record({ type: "view", view: "query" });
      writer.store.dispose();
    }
    const keys = [...storage.values.keys()].filter((key) => key.startsWith(USAGE_STORAGE_PREFIX));
    expect(keys).toHaveLength(USAGE_SESSION_LIMIT);
    expect(storage.values.has(`${USAGE_STORAGE_PREFIX}000`)).toBe(false);
    expect(storage.values.has(`${USAGE_STORAGE_PREFIX}039`)).toBe(true);
    expect(storage.values.get("l8db.connections")).toBe("preserve");
    const reader = fixture(storage, "reader");
    expect(reader.store.getSnapshot().sessionCount).toBe(USAGE_SESSION_LIMIT);
    expect(reader.store.getSnapshot().views[0].opens).toBe(USAGE_SESSION_LIMIT);
    reader.store.dispose();
  });

  test("bounds route and operation groups while existing groups continue accumulating", () => {
    const f = fixture();
    for (const from of views) {
      for (const to of views) f.store.record({ type: "transition", from, to });
    }
    for (const operation of operations) {
      for (const kind of kinds)
        f.store.record({ type: "operation", operation, kind, status: "ok", ms: 10 });
    }
    f.store.record({ type: "transition", from: "home", to: "connections" });
    f.store.record({
      type: "operation",
      operation: "query",
      kind: "postgres",
      status: "error",
      ms: 20,
    });
    f.store.flush();
    const snapshot = f.store.getSnapshot();
    expect(snapshot.transitions).toHaveLength(USAGE_GROUP_LIMIT);
    expect(snapshot.operations).toHaveLength(USAGE_GROUP_LIMIT);
    expect(
      snapshot.transitions.find((row) => row.from === "home" && row.to === "connections")?.count,
    ).toBe(2);
    expect(
      snapshot.operations.find((row) => row.operation === "query" && row.kind === "postgres")
        ?.error,
    ).toBe(1);
    expect(f.storage?.writes[0].value.length ?? Infinity).toBeLessThanOrEqual(65536);
    f.store.dispose();
  });

  test("cancels deferred writes on clear and disposal and performs no idle work", () => {
    const f = fixture();
    f.advance(600000);
    expect(f.scheduled()).toBe(0);
    expect(f.storage?.writes).toHaveLength(0);
    f.store.record({ type: "view", view: "query" });
    f.store.clear();
    const writesAfterClear = f.storage?.writes.length;
    const readsAfterClear = f.storage?.reads;
    expect(f.pending.size).toBe(0);
    expect(f.cancelled).toHaveLength(1);
    f.advance(600000);
    expect(f.storage?.writes.length).toBe(writesAfterClear);
    expect(f.storage?.reads).toBe(readsAfterClear);
    f.store.record({ type: "view", view: "tables" });
    f.store.dispose();
    const writesAfterDispose = f.storage?.writes.length;
    const readsAfterDispose = f.storage?.reads;
    expect(f.pending.size).toBe(0);
    f.store.record({ type: "view", view: "query" });
    f.store.flush();
    f.advance(600000);
    expect(f.storage?.writes.length).toBe(writesAfterDispose);
    expect(f.storage?.reads).toBe(readsAfterDispose);
    expect(f.store.getSnapshot().views).toEqual([{ view: "tables", opens: 1, activeMs: 0 }]);
  });

  test("keeps recording in memory when storage is unavailable or missing", () => {
    const storage = new MemoryStorage();
    storage.fail = true;
    const f = fixture(storage);
    expect(() => f.store.record({ type: "view", view: "query" })).not.toThrow();
    expect(() => f.store.flush()).not.toThrow();
    expect(f.store.getSnapshot().views).toEqual([{ view: "query", opens: 1, activeMs: 0 }]);
    expect(() => f.store.clear()).not.toThrow();
    expect(() => f.store.dispose()).not.toThrow();
    const memoryOnly = fixture(null);
    memoryOnly.store.record({ type: "view", view: "tables" });
    memoryOnly.store.flush();
    expect(memoryOnly.store.getSnapshot().views).toEqual([
      { view: "tables", opens: 1, activeMs: 0 },
    ]);
    memoryOnly.store.dispose();
  });
});
