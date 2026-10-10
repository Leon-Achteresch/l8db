import { beforeEach, describe, expect, mock, test } from "bun:test";

const invocations: { command: string; args: Record<string, unknown> }[] = [];

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown>) => {
    invocations.push({ command, args });
    if (command === "execute_query" && String(args.sql).includes("FAIL"))
      throw new Error("ORA-00942: table or view does not exist");
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
const {
  FAILED_AFTER_CANCEL_NOTICE,
  LATE_CANCEL_NOTICE,
  PARTIAL_SCRIPT_NOTICE,
  UNSUPPORTED_CANCEL_NOTICE,
} = await import("../src/lib/multi-target/run");
const { OTHER_FAMILY_REASON } = await import("../src/lib/multi-target/safety");
const { partialRiskStatements } = await import("../src/lib/multi-target/script");
const { renderToStaticMarkup } = await import("react-dom/server");
const { createElement } = await import("react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { MultiTargetMergedView } = await import(
  "../src/features/query/multi-target/multi-target-merged-view"
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
          return true;
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
        cancel: async () => {
          gates.get(targets[1].id)?.reject(new Error("abgebrochen"));
          return true;
        },
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
    expect(
      operationConnections({ connectionString: scoped, options: { connectionId: "prod" } }).map(
        (entry) => entry.id,
      ),
    ).toEqual(["prod"]);
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

describe("review fixes", () => {
  test("schema scoping keeps every other parameter byte for byte", () => {
    const base =
      "postgresql://app:p%20w@db:5432/app?sslmode=require&options=-c%20default_transaction_read_only%3Don&application_name=l8db%20app&search_path=old";
    const scoped = schemaScopedConnectionString(base, "tenant 7");
    expect(scoped).toBe(
      "postgresql://app:p%20w@db:5432/app?sslmode=require&options=-c%20default_transaction_read_only%3Don&application_name=l8db%20app&schema=tenant%207",
    );
    expect(scoped).not.toContain("+");
    expect(schemaScopedConnectionString("postgresql://db/app", "s")).toBe(
      "postgresql://db/app?schema=s",
    );
  });

  test("connections that differ only by schema keep separate guards", () => {
    const dev = connection("dev", {
      connectionString: "postgresql://app@shared.example.test:5432/app?schema=dev",
    });
    const prod = connection("prod", {
      environment: "production",
      connectionString: "postgresql://app@shared.example.test:5432/app?schema=prod",
    });
    useConnectionsStore.setState({ connections: [dev, prod] });
    expect(
      operationConnections({ connectionString: dev.connectionString }).map((entry) => entry.id),
    ).toEqual(["dev"]);
    const scopedProd = schemaScopedConnectionString(prod.connectionString, "tenant");
    expect(operationConnections({ connectionString: scopedProd })).toEqual([]);
    expect(
      operationConnections({ connectionString: scopedProd, options: { connectionId: "prod" } }).map(
        (entry) => entry.id,
      ),
    ).toEqual(["prod"]);
  });

  test("targets of another database family are rejected", () => {
    const pg = connection("pg");
    const my = connection("my", { kind: "mysql", connectionString: "mysql://app@my/app" });
    const gate = multiTargetGate(
      "SELECT 1",
      [
        { target: multiTarget("pg"), connection: pg },
        { target: multiTarget("my"), connection: my },
      ],
      "mysql",
    );
    expect(gate.allowed.map((target) => target.connectionId)).toEqual(["my"]);
    expect(gate.rejected).toEqual([{ target: multiTarget("pg"), reason: OTHER_FAMILY_REASON }]);
  });

  test("the merged view waits for the run to finish before merging", () => {
    const items = [{ id: "a", label: "A" }];
    const runs = {
      a: {
        id: "a",
        status: "done" as const,
        durationMs: 1,
        rowCount: 1,
        rowsAffected: null,
        truncated: false,
        error: null,
        notice: null,
        result: result(["n"], [{ n: 1 }]),
      },
    };
    const waiting = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(MultiTargetMergedView, { items, runs, sql: "SELECT 1", running: true }),
      ),
    );
    expect(waiting).toContain("sobald alle Ziele fertig sind");
    expect(waiting).not.toContain("data-multi-target-grid");
  });
});

describe("second review fixes", () => {
  const ora = connection("ora2", { kind: "oracle", connectionString: "oracle://app@ora2:1521/XE" });

  test("a cancel during connect never runs the first statement", async () => {
    useConnectionsStore.setState({ connections: [ora] });
    invocations.length = 0;
    const controller = new AbortController();
    const connecting = deferred<SavedConnection>();
    const running = multiTargetExecutor(true, () => connecting.promise).execute({
      target: multiTarget("ora2"),
      sql: "UPDATE a SET x = 1",
      jobId: "job-connect",
      timeoutSeconds: 10,
      maxRows: 10,
      signal: controller.signal,
    });
    controller.abort();
    connecting.resolve(ora);
    expect(isMultiTargetCancelled(await running.catch((error: unknown) => error))).toBe(true);
    expect(invocations.filter((entry) => entry.command === "execute_query")).toHaveLength(0);
  });

  test("Oracle scripts go to the backend as one call; its adapter splits them on one session", async () => {
    useConnectionsStore.setState({ connections: [ora] });
    invocations.length = 0;
    const script = "UPDATE a SET x = 1;\nUPDATE b SET y = 2;";
    await multiTargetExecutor(true, async () => ora).execute({
      target: multiTarget("ora2"),
      sql: script,
      jobId: "job-ora",
      timeoutSeconds: 10,
      maxRows: 10,
    });
    const calls = invocations.filter((entry) => entry.command === "execute_query");
    expect(calls.map((entry) => entry.args.sql)).toEqual([script]);
    expect(calls[0].args.session).toBeUndefined();
  });

  test("a target counts as cancelled only when the cancel took effect", async () => {
    const cases = [
      { requested: true, accepted: true, message: "network reset", expected: "cancelled" },
      {
        requested: true,
        accepted: false,
        message: "ERROR: canceling statement due to user request (SQLSTATE 57014)",
        expected: "cancelled",
      },
      { requested: true, accepted: false, message: "deadlock detected", expected: "error" },
      {
        requested: false,
        accepted: false,
        message: "ORA-01013: user requested cancel of current operation",
        expected: "error",
      },
    ] as const;
    for (const entry of cases) {
      const updates = new Map<string, TargetRun>();
      const gate = deferred<QueryResult>();
      const target = multiTarget("c9");
      const handle = startMultiTargetRun({
        targets: [target],
        sql: "UPDATE t SET a = 1",
        concurrency: 1,
        perServerLimit: 1,
        timeoutSeconds: 30,
        maxRows: 10,
        executor: {
          execute: () => gate.promise,
          cancel: async () => {
            gate.reject(new Error(entry.message));
            return entry.accepted;
          },
        },
        onUpdate: (run) => updates.set(run.id, run),
      });
      await tick();
      if (entry.requested) handle.cancelAll();
      else gate.reject(new Error(entry.message));
      await handle.done;
      const run = updates.get(target.id);
      expect(run?.status).toBe(entry.expected);
      if (entry.requested && entry.expected === "error")
        expect(run?.notice).toBe(FAILED_AFTER_CANCEL_NOTICE);
    }
  });

  test("a statement that finished despite the cancel is reported as done", async () => {
    const updates = new Map<string, TargetRun>();
    const gate = deferred<QueryResult>();
    const target = multiTarget("c8");
    const handle = startMultiTargetRun({
      targets: [target],
      sql: "UPDATE t SET a = 1",
      concurrency: 1,
      perServerLimit: 1,
      timeoutSeconds: 30,
      maxRows: 10,
      executor: { execute: () => gate.promise, cancel: async () => false },
      onUpdate: (run) => updates.set(run.id, run),
    });
    await tick();
    handle.cancelAll();
    gate.resolve({ ...result([], []), rows_affected: 4 });
    await handle.done;
    expect(updates.get(target.id)).toMatchObject({
      status: "done",
      rowsAffected: 4,
      notice: LATE_CANCEL_NOTICE,
    });
  });
});

describe("third review fixes", () => {
  const runOnce = async (options: {
    supported: boolean;
    scriptStatements: number;
    outcome: "resolve" | "reject";
    cancel: boolean;
  }) => {
    const updates = new Map<string, TargetRun>();
    const gate = deferred<QueryResult>();
    const target = multiTarget("c7");
    const handle = startMultiTargetRun({
      targets: [target],
      sql: "UPDATE a SET x = 1; UPDATE b SET y = 2",
      scriptStatements: options.scriptStatements,
      concurrency: 1,
      perServerLimit: 1,
      timeoutSeconds: 30,
      maxRows: 10,
      executor: {
        execute: ({ onExecuting }) => {
          onExecuting?.();
          return gate.promise;
        },
        cancel: async () => false,
        canCancel: () => options.supported,
      },
      onUpdate: (run) => updates.set(run.id, run),
    });
    await tick();
    if (options.cancel) handle.cancelAll();
    if (options.outcome === "resolve") gate.resolve({ ...result([], []), rows_affected: 520 });
    else gate.reject(new Error("ORA-00942: table or view does not exist"));
    await handle.done;
    return updates.get(target.id);
  };

  test("drivers without query_cancel get their own notice", async () => {
    const done = await runOnce({
      supported: false,
      scriptStatements: 1,
      outcome: "resolve",
      cancel: true,
    });
    expect(done).toMatchObject({
      status: "done",
      notice: UNSUPPORTED_CANCEL_NOTICE,
      rowsAffected: 520,
    });
    const failed = await runOnce({
      supported: false,
      scriptStatements: 1,
      outcome: "reject",
      cancel: true,
    });
    expect(failed).toMatchObject({ status: "error", notice: UNSUPPORTED_CANCEL_NOTICE });
    const late = await runOnce({
      supported: true,
      scriptStatements: 1,
      outcome: "resolve",
      cancel: true,
    });
    expect(late?.notice).toBe(LATE_CANCEL_NOTICE);
  });

  test("a failing script warns that a part may already have run", async () => {
    const failed = await runOnce({
      supported: true,
      scriptStatements: 2,
      outcome: "reject",
      cancel: false,
    });
    expect(failed?.status).toBe("error");
    expect(failed?.notice).toBe(PARTIAL_SCRIPT_NOTICE);
    const single = await runOnce({
      supported: true,
      scriptStatements: 1,
      outcome: "reject",
      cancel: false,
    });
    expect(single?.notice).toBeNull();
  });

  test("the executor derives cancel support from the capability", () => {
    const pg = connection("pg3");
    const my = connection("my3", { kind: "mysql", connectionString: "mysql://app@my3/app" });
    useConnectionsStore.setState({ connections: [pg, my] });
    const executor = multiTargetExecutor(false, async () => pg);
    expect(executor.canCancel?.(multiTarget("pg3"))).toBe(true);
    expect(executor.canCancel?.(multiTarget("my3"))).toBe(false);
  });
});

describe("fourth review fixes", () => {
  test("the partial notice needs a statement that actually reached the target", async () => {
    for (const reached of [false, true]) {
      const updates = new Map<string, TargetRun>();
      const target = multiTarget("c6");
      await startMultiTargetRun({
        targets: [target],
        sql: "UPDATE a SET x = 1; UPDATE b SET y = 2",
        scriptStatements: 2,
        concurrency: 1,
        perServerLimit: 1,
        timeoutSeconds: 30,
        maxRows: 10,
        executor: {
          execute: async ({ onExecuting }) => {
            if (reached) onExecuting?.();
            throw new Error(reached ? "ORA-00942" : "Ohne Passwort kann nicht verbunden werden.");
          },
          cancel: async () => false,
        },
        onUpdate: (run) => updates.set(run.id, run),
      }).done;
      expect(updates.get(target.id)?.notice).toBe(reached ? PARTIAL_SCRIPT_NOTICE : null);
    }
  });

  test("statements are counted like the target backend runs them", () => {
    expect(
      partialRiskStatements(
        "SET SERVEROUTPUT ON\nUPDATE a SET x = 1;\nUPDATE b SET y = 2;",
        "oracle",
      ),
    ).toBe(2);
    expect(partialRiskStatements("SET SERVEROUTPUT ON\nUPDATE a SET x = 1;", "oracle")).toBe(1);
    expect(partialRiskStatements("UPDATE a SET x = 1; UPDATE b SET y = 2;", "postgres")).toBe(1);
    expect(
      partialRiskStatements("UPDATE a SET x = 1; COMMIT; UPDATE b SET y = 2;", "postgres"),
    ).toBe(3);
    expect(partialRiskStatements("UPDATE a SET x = 1; UPDATE b SET y = 2;", "mysql")).toBe(2);
  });
});
