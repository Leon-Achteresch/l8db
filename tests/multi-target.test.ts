import { beforeEach, describe, expect, mock, test } from "bun:test";

const invocations: { command: string; args: Record<string, unknown> }[] = [];

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown>) => {
    invocations.push({ command, args });
    if (command === "execute_query")
      return { columns: ["n"], rows: [{ n: 1 }], rows_affected: null, execution_time_ms: 1 };
    if (command === "cancel_execution") return true;
    return null;
  },
}));

const {
  createLimiter,
  isMultiTargetCancelled,
  mergeResults,
  multiTarget,
  multiTargetGate,
  startMultiTargetRun,
  TARGET_COLUMN,
} = await import("../src/lib/multi-target");
const { multiTargetExecutor, schemaScopedConnectionString } = await import(
  "../src/lib/multi-target/executor"
);
const { MULTI_TARGET_GROUP_LIMITS, useMultiTargetGroups } = await import(
  "../src/lib/multi-target/groups"
);
const { useConnectionsStore } = await import("../src/lib/connections/store");
const { useSettingsStore } = await import("../src/lib/settings");
const { useWriteModeStore } = await import("../src/lib/environments");
const { operationConnections } = await import("../src/lib/operation-context");
type QueryResult = import("../src/lib/db/types").QueryResult;
type SavedConnection = import("../src/lib/connections").SavedConnection;
type TargetRun = import("../src/lib/multi-target").TargetRun;

function connection(id: string, extra: Partial<SavedConnection> = {}): SavedConnection {
  return {
    id,
    name: id.toUpperCase(),
    kind: "postgres",
    connectionString: `postgresql://app@${id}.example.test:5432/app`,
    sslMode: "prefer",
    ...extra,
  };
}

function result(columns: string[], rows: Record<string, unknown>[]): QueryResult {
  return { columns, rows, rows_affected: null, execution_time_ms: 1 };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  invocations.length = 0;
  useWriteModeStore.setState({ unlockedUntil: {} });
});

describe("concurrency limiter", () => {
  test("never exceeds the global and per-server limits", async () => {
    const limiter = createLimiter(4, 2);
    let active = 0;
    let peak = 0;
    const perKey = new Map<string, number>();
    let keyPeak = 0;
    const tasks = Array.from({ length: 30 }, (_, index) =>
      limiter.run(`server-${index % 3}`, async () => {
        const key = `server-${index % 3}`;
        active++;
        perKey.set(key, (perKey.get(key) ?? 0) + 1);
        peak = Math.max(peak, active);
        keyPeak = Math.max(keyPeak, perKey.get(key) ?? 0);
        await new Promise((resolve) => setTimeout(resolve, 1 + (index % 4)));
        active--;
        perKey.set(key, (perKey.get(key) ?? 1) - 1);
        return index;
      }),
    );
    expect(await Promise.all(tasks)).toEqual(Array.from({ length: 30 }, (_, index) => index));
    expect(peak).toBe(4);
    expect(keyPeak).toBe(2);
    expect(limiter.peak).toBe(4);
    expect(limiter.active).toBe(0);
    expect(limiter.queued).toBe(0);
  });

  test("an aborted queued task never starts", async () => {
    const limiter = createLimiter(1);
    const gate = deferred<void>();
    let started = 0;
    const first = limiter.run("a", async () => {
      started++;
      await gate.promise;
    });
    const controller = new AbortController();
    const second = limiter.run(
      "a",
      async () => {
        started++;
      },
      controller.signal,
    );
    controller.abort();
    gate.resolve();
    await first;
    expect(isMultiTargetCancelled(await second.catch((error: unknown) => error))).toBe(true);
    expect(started).toBe(1);
  });
});

describe("run orchestration", () => {
  const targets = Array.from({ length: 6 }, (_, index) => multiTarget("c1", `db${index}`));

  test("one failing target does not abort the others", async () => {
    const updates = new Map<string, TargetRun>();
    const handle = startMultiTargetRun({
      targets,
      sql: "SELECT 1",
      concurrency: 2,
      perServerLimit: 8,
      timeoutSeconds: 30,
      maxRows: 100,
      executor: {
        execute: async ({ target }) => {
          if (target.database === "db2") throw new Error("relation does not exist");
          return result(["n"], [{ n: 1 }]);
        },
        cancel: async () => false,
      },
      onUpdate: (run) => updates.set(run.id, run),
    });
    await handle.done;
    expect([...updates.values()].map((run) => run.status).sort()).toEqual([
      "done",
      "done",
      "done",
      "done",
      "done",
      "error",
    ]);
    expect(updates.get(targets[2].id)?.error).toContain("relation does not exist");
    expect(updates.get(targets[3].id)?.rowCount).toBe(1);
  });

  test("cancel all stops running jobs and no further request starts", async () => {
    const started: string[] = [];
    const cancelled: string[] = [];
    const pending = new Map<string, ReturnType<typeof deferred<QueryResult>>>();
    const updates = new Map<string, TargetRun>();
    const handle = startMultiTargetRun({
      targets,
      sql: "SELECT 1",
      concurrency: 2,
      perServerLimit: 8,
      timeoutSeconds: 30,
      maxRows: 100,
      executor: {
        execute: ({ target, jobId }) => {
          started.push(target.id);
          const entry = deferred<QueryResult>();
          pending.set(jobId, entry);
          return entry.promise;
        },
        cancel: async (_target, jobId) => {
          cancelled.push(jobId);
          pending.get(jobId)?.reject(new Error("canceling statement due to user request"));
        },
      },
      onUpdate: (run) => updates.set(run.id, run),
    });
    await tick();
    expect(started).toHaveLength(2);
    handle.cancelAll();
    await handle.done;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(started).toHaveLength(2);
    expect(cancelled).toHaveLength(2);
    expect([...updates.values()].every((run) => run.status === "cancelled")).toBe(true);
    expect(handle.stats()).toMatchObject({ active: 0, queued: 0, started: 2 });
  });

  test("cancel one leaves the remaining targets running", async () => {
    const updates = new Map<string, TargetRun>();
    const gates = new Map<string, ReturnType<typeof deferred<QueryResult>>>();
    const handle = startMultiTargetRun({
      targets: targets.slice(0, 3),
      sql: "SELECT 1",
      concurrency: 4,
      perServerLimit: 8,
      timeoutSeconds: 30,
      maxRows: 100,
      executor: {
        execute: ({ target }) => {
          const entry = deferred<QueryResult>();
          gates.set(target.id, entry);
          return entry.promise;
        },
        cancel: async () => gates.get(targets[1].id)?.reject(new Error("abgebrochen")),
      },
      onUpdate: (run) => updates.set(run.id, run),
    });
    await tick();
    handle.cancel(targets[1].id);
    gates.get(targets[0].id)?.resolve(result(["n"], []));
    gates.get(targets[2].id)?.resolve(result(["n"], [{ n: 2 }]));
    await handle.done;
    expect(updates.get(targets[0].id)?.status).toBe("done");
    expect(updates.get(targets[1].id)?.status).toBe("cancelled");
    expect(updates.get(targets[2].id)?.status).toBe("done");
  });

  test("rejected targets are reported without a request and the row limit is bounded", async () => {
    const requests: number[] = [];
    const updates = new Map<string, TargetRun>();
    const rejected = multiTarget("ro", "app");
    await startMultiTargetRun({
      targets: targets.slice(0, 1),
      rejected: [{ target: rejected, reason: "Schreibgeschützte Verbindung" }],
      sql: "SELECT 1",
      concurrency: 99,
      perServerLimit: 99,
      timeoutSeconds: 30,
      maxRows: 50_000,
      executor: {
        execute: async ({ maxRows }) => {
          requests.push(maxRows);
          return result(["n"], []);
        },
        cancel: async () => false,
      },
      onUpdate: (run) => updates.set(run.id, run),
    }).done;
    expect(requests).toEqual([1000]);
    expect(updates.get(rejected.id)).toMatchObject({ status: "rejected" });
  });
});

describe("merge", () => {
  test("adds a __target column for compatible results", () => {
    const merged = mergeResults([
      { label: "tenant_a", result: result(["id", "name"], [{ id: 1, name: "x" }]) },
      { label: "tenant_b", result: result(["id", "name"], [{ id: 2, name: "y" }]) },
      { label: "ddl", result: result([], []) },
    ]);
    if (!merged.ok) throw new Error(merged.reason);
    expect(merged.result.columns).toEqual([TARGET_COLUMN, "id", "name"]);
    expect(merged.result.rows).toEqual([
      { __target: "tenant_a", id: 1, name: "x" },
      { __target: "tenant_b", id: 2, name: "y" },
    ]);
    expect(merged.targets).toBe(2);
  });

  test("refuses incompatible or clashing columns", () => {
    const different = mergeResults([
      { label: "a", result: result(["id", "name"], []) },
      { label: "b", result: result(["id", "title"], []) },
    ]);
    expect(different.ok).toBe(false);
    if (!different.ok) expect(different.reason).toContain("passen nicht");
    const reordered = mergeResults([
      { label: "a", result: result(["id", "name"], []) },
      { label: "b", result: result(["name", "id"], []) },
    ]);
    expect(reordered.ok).toBe(false);
    const clash = mergeResults([{ label: "a", result: result([TARGET_COLUMN], []) }]);
    expect(clash.ok).toBe(false);
    expect(mergeResults([]).ok).toBe(false);
  });
});

describe("write confirmation gating", () => {
  const dev = connection("dev");
  const prod = connection("prod", { environment: "production" });
  const readOnly = connection("ro", { readOnly: true });

  test("reads run without confirmation, even on production", () => {
    const gate = multiTargetGate("SELECT count(*) FROM users", [
      { target: multiTarget("dev"), connection: dev },
      { target: multiTarget("prod"), connection: prod },
      { target: multiTarget("ro"), connection: readOnly },
    ]);
    expect(gate.write).toBe(false);
    expect(gate.allowed).toHaveLength(3);
    expect(gate.requiresConfirmation).toBe(false);
    expect(gate.production.map((target) => target.connectionId)).toEqual(["prod"]);
  });

  test("writes need confirmation; read-only targets are rejected and force the extra confirmation", () => {
    const gate = multiTargetGate("UPDATE users SET active = false WHERE id = 1", [
      { target: multiTarget("dev"), connection: dev },
      { target: multiTarget("ro"), connection: readOnly },
      { target: multiTarget("gone"), connection: null },
    ]);
    expect(gate.write).toBe(true);
    expect(gate.allowed.map((target) => target.connectionId)).toEqual(["dev"]);
    expect(gate.rejected.map((entry) => entry.target.connectionId)).toEqual(["ro", "gone"]);
    expect(gate.requiresConfirmation).toBe(true);
    expect(gate.requiresProductionConfirmation).toBe(true);
  });

  test("locked production is rejected, unlocked production needs the extra confirmation", () => {
    useSettingsStore.setState({ productionReadOnly: true });
    const locked = multiTargetGate("DELETE FROM t WHERE id = 1", [
      { target: multiTarget("prod"), connection: prod },
      { target: multiTarget("dev"), connection: dev },
    ]);
    expect(locked.rejected.map((entry) => entry.target.connectionId)).toEqual(["prod"]);
    expect(locked.requiresProductionConfirmation).toBe(false);
    useWriteModeStore.getState().unlock("prod");
    const unlocked = multiTargetGate("CREATE TABLE t (id int)", [
      { target: multiTarget("prod"), connection: prod },
      { target: multiTarget("dev"), connection: dev },
    ]);
    expect(unlocked.write).toBe(true);
    expect(unlocked.allowed).toHaveLength(2);
    expect(unlocked.requiresProductionConfirmation).toBe(true);
  });
});

describe("executor", () => {
  test("schema targets scope the PostgreSQL URL and still match their connection guards", () => {
    const prod = connection("prod", { environment: "production" });
    useConnectionsStore.setState({ connections: [prod] });
    const scoped = schemaScopedConnectionString(prod.connectionString, "tenant_7");
    expect(new URL(scoped).searchParams.get("schema")).toBe("tenant_7");
    expect(operationConnections({ connectionString: scoped }).map((entry) => entry.id)).toEqual([
      "prod",
    ]);
  });

  test("reads use pooled clients, writes do not; both pass limits and prepare once", async () => {
    const dev = connection("dev");
    useConnectionsStore.setState({ connections: [dev] });
    let prepared = 0;
    const prepare = async () => {
      prepared++;
      return dev;
    };
    const read = multiTargetExecutor(false, prepare);
    await Promise.all(
      ["a", "b", "c"].map((database, index) =>
        read.execute({
          target: multiTarget("dev", database, index === 2 ? "tenant" : null),
          sql: "SELECT 1",
          jobId: `job-${database}`,
          timeoutSeconds: 12,
          maxRows: 250,
        }),
      ),
    );
    await multiTargetExecutor(true, prepare).execute({
      target: multiTarget("dev", "a"),
      sql: "UPDATE t SET a = 1",
      jobId: "job-write",
      timeoutSeconds: 12,
      maxRows: 250,
    });
    const queries = invocations.filter((entry) => entry.command === "execute_query");
    expect(queries).toHaveLength(4);
    expect(queries.slice(0, 3).every((entry) => entry.args.pooled === true)).toBe(true);
    expect(queries[3].args.pooled).toBeUndefined();
    for (const entry of queries) {
      const options = entry.args.options as Record<string, unknown>;
      expect(options.maxRows).toBe(250);
      expect(options.queryTimeout).toBe(12);
    }
    expect(String(queries[2].args.connectionString)).toContain("schema=tenant");
    expect(prepared).toBe(2);
  });
});

describe("saved target groups", () => {
  test("groups are deduplicated, bounded and persisted under their own key", () => {
    const store = useMultiTargetGroups.getState();
    const saved = store.save("Tenants", [
      multiTarget("c1", "a"),
      multiTarget("c1", "a"),
      multiTarget("c1", "b", "s"),
    ]);
    expect(saved?.targets.map((target) => target.id)).toHaveLength(2);
    const replaced = useMultiTargetGroups.getState().save("tenants", [multiTarget("c2")]);
    expect(replaced?.id).toBe(saved?.id);
    expect(useMultiTargetGroups.getState().groups).toHaveLength(1);
    expect(useMultiTargetGroups.getState().save("  ", [multiTarget("c1")])).toBeNull();
    const many = Array.from({ length: MULTI_TARGET_GROUP_LIMITS.targets + 20 }, (_, index) =>
      multiTarget("c1", `db${index}`),
    );
    expect(useMultiTargetGroups.getState().save("Viele", many)?.targets).toHaveLength(
      MULTI_TARGET_GROUP_LIMITS.targets,
    );
    expect(window.localStorage.getItem("l8db.multi-target-groups")).toContain("Viele");
    useMultiTargetGroups.getState().remove(replaced?.id ?? "");
    expect(useMultiTargetGroups.getState().groups.map((group) => group.name)).toEqual(["Viele"]);
  });
});
