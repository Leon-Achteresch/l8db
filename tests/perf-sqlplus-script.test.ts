import { beforeEach, expect, mock, test } from "bun:test";
import { measureScenario, reportScenario } from "../scripts/performance-report";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});

const counts = new Map<string, number>();
let outputLines = 1;
let onExecute: (() => void | Promise<void>) | null = null;
mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown> = {}) => {
    if (command === "list_providers") return [];
    if (command === "sql_search_path") return [];
    counts.set(command, (counts.get(command) ?? 0) + 1);
    if (command === "begin_transaction") return "tx-perf";
    if (command === "transaction_database_changes") return [];
    if (command === "transaction_server_output" || command === "take_server_output")
      return Array.from({ length: outputLines }, (_, index) => ({
        level: "OUTPUT",
        message: `zeile ${index}`,
      }));
    if (command === "execute_in_transaction" || command === "execute_query") {
      if (onExecute) await onExecute();
      const sql = String(args.sql);
      if (sql.includes("LOCAL_TRANSACTION_ID"))
        return { columns: ["ID"], rows: [{ ID: null }], rows_affected: null, execution_time_ms: 0 };
      if (/^select/i.test(sql))
        return { columns: ["N"], rows: [{ N: 1 }], rows_affected: null, execution_time_ms: 0 };
      return { columns: [], rows: [], rows_affected: null, execution_time_ms: 0 };
    }
    return true;
  },
}));

const { useProvidersStore, FALLBACK_PROVIDERS } = await import("../src/lib/providers");
const { useConnectionsStore } = await import("../src/lib/connections");
const { useTransactionStore } = await import("../src/lib/transactions");
const { useTasksStore, cancelTask } = await import("../src/lib/tasks");
const { runSqlScript } = await import("../src/lib/script-runner");

const oracle = {
  id: "ora-perf",
  name: "ORA",
  kind: "oracle" as const,
  connectionString: "oracle://app@ora.example.test:1521/XE",
  sslMode: "disable" as const,
};
const postgres = {
  ...oracle,
  id: "pg-perf",
  kind: "postgres" as const,
  connectionString: "postgres://app@pg/db",
};
const BLOCKS = 2000;
const ORACLE_SCRIPT = [
  "set verify off serveroutput on",
  "whenever sqlerror exit failure rollback",
  ...Array.from({ length: BLOCKS }, (_, index) =>
    index % 500 === 499 ? "commit;" : `begin dbms_output.put_line('schritt ${index}'); end;\n/`,
  ),
  "select count(*) n from dual;",
].join("\n");
const PG_SCRIPT = Array.from({ length: BLOCKS }, (_, index) => `SELECT ${index};`).join("\n");

const base = FALLBACK_PROVIDERS[0];
beforeEach(() => {
  counts.clear();
  outputLines = 1;
  onExecute = null;
  useConnectionsStore.setState({ connections: [oracle, postgres], activeId: oracle.id });
  useTransactionStore.setState({
    transactions: [],
    busyTransactions: {},
    finalizingTransactions: [],
  });
  useTasksStore.setState({ tasks: [] });
  useProvidersStore.setState({
    providers: [
      base,
      {
        ...base,
        id: "oracle",
        kind: "oracle",
        capabilities: { ...base.capabilities, server_output: true, transactions: true },
      },
    ].map((provider) =>
      provider.kind === "postgres"
        ? { ...provider, capabilities: { ...provider.capabilities, server_output: true } }
        : provider,
    ),
    loaded: true,
  });
});

const per = (command: string, statements: number) => (counts.get(command) ?? 0) / statements;

test("an Oracle SQL*Plus script costs one execute and one output read per statement", async () => {
  let entries = 0;
  const timing = await measureScenario(async () => {
    counts.clear();
    useTransactionStore.setState({ transactions: [] });
    const outcome = await runSqlScript({
      connection: oracle,
      database: null,
      sql: ORACLE_SCRIPT,
      mode: "new-transaction",
    });
    entries = outcome.entries.length;
    expect(outcome.error).toBeNull();
  }, 5);
  const statements = BLOCKS + 1;
  const executes = per("execute_in_transaction", statements);
  const reads = per("transaction_server_output", statements);
  expect(entries).toBe(BLOCKS + 3);
  expect(executes).toBeLessThanOrEqual(1.01);
  expect(reads).toBeLessThanOrEqual(1.01);
  expect(counts.get("begin_transaction")).toBe(1);
  expect(timing.p95Ms).toBeLessThan(4000);
  await reportScenario("sqlplus-oracle-script", {
    statements,
    executeRequestsPerStatement: executes,
    outputReadsPerStatement: reads,
    transactionChecksPerRun: (counts.get("execute_in_transaction") ?? 0) - statements - 1,
    total: timing,
    p95BudgetMs: 4000,
  });
}, 60_000);

test("SET SERVEROUTPUT OFF removes the per-statement output read from the managed session", async () => {
  await runSqlScript({
    connection: oracle,
    database: null,
    sql: ORACLE_SCRIPT.replace("serveroutput on", "serveroutput off"),
    mode: "new-transaction",
  });
  expect(counts.get("transaction_server_output") ?? 0).toBe(0);
});

test("script output stays bounded when every statement prints many lines", async () => {
  outputLines = 100;
  const outcome = await runSqlScript({
    connection: oracle,
    database: null,
    sql: ORACLE_SCRIPT,
    mode: "new-transaction",
  });
  const kept = outcome.entries.reduce((sum, entry) => sum + (entry.output?.length ?? 0), 0);
  expect(kept).toBeLessThanOrEqual(20_000 + 10);
  expect(
    outcome.entries.some((entry) =>
      entry.output?.some((line) => line.message.includes("verworfen")),
    ),
  ).toBe(true);
  await reportScenario("sqlplus-script-output-cap", {
    producedLines: BLOCKS * outputLines,
    retainedLines: kept,
    capLines: 20_000,
  });
});

test("cancelling a running script stops all further database requests", async () => {
  let executed = 0;
  let jobId = "";
  onExecute = () => {
    executed++;
    if (executed === 100) void cancelTask(jobId);
  };
  const outcome = await runSqlScript({
    connection: postgres,
    database: null,
    sql: PG_SCRIPT,
    mode: "autocommit",
    onJob: (id) => {
      jobId = id;
    },
  });
  expect(executed).toBeLessThanOrEqual(101);
  expect(outcome.entries.filter((entry) => entry.status === "skipped").length).toBeGreaterThan(
    BLOCKS - 110,
  );
  expect(outcome.error).toBe("Skript zwischen den Statements abgebrochen.");
});

test("non-Oracle scripts read server messages without extra database round trips", async () => {
  outputLines = 0;
  const timing = await measureScenario(async () => {
    counts.clear();
    await runSqlScript({
      connection: postgres,
      database: null,
      sql: PG_SCRIPT,
      mode: "autocommit",
    });
  }, 5);
  expect(per("execute_query", BLOCKS)).toBe(1);
  expect(per("take_server_output", BLOCKS)).toBeLessThanOrEqual(1.001);
  expect(timing.p95Ms).toBeLessThan(4000);
  await reportScenario("script-server-messages-postgres", {
    statements: BLOCKS,
    executeRequestsPerStatement: per("execute_query", BLOCKS),
    messageReadsPerStatement: per("take_server_output", BLOCKS),
    total: timing,
    p95BudgetMs: 4000,
  });
}, 60_000);

test("visible progress for 2,000 statements bounds snapshots and task writes", async () => {
  outputLines = 0;
  let snapshots = 0;
  let copies = 0;
  let writes = 0;
  let maxSnapshots = 0;
  let maxCopies = 0;
  let maxWrites = 0;
  const timing = await measureScenario(async () => {
    counts.clear();
    useTasksStore.setState({ tasks: [] });
    let previous: Awaited<ReturnType<typeof runSqlScript>>["entries"] = [];
    snapshots = 0;
    copies = 0;
    writes = 0;
    const unsubscribe = useTasksStore.subscribe(() => {
      writes++;
    });
    try {
      const outcome = await runSqlScript({
        connection: postgres,
        database: null,
        sql: PG_SCRIPT,
        mode: "autocommit",
        onProgress(entries) {
          snapshots++;
          for (let index = 0; index < entries.length; index++)
            if (entries[index] !== previous[index]) copies++;
          previous = entries;
        },
      });
      expect(previous).toEqual(outcome.entries);
      expect(previous).toHaveLength(BLOCKS);
      expect(counts.get("execute_query")).toBe(BLOCKS);
      expect(outcome.error).toBeNull();
      maxSnapshots = Math.max(maxSnapshots, snapshots);
      maxCopies = Math.max(maxCopies, copies);
      maxWrites = Math.max(maxWrites, writes);
    } finally {
      unsubscribe();
    }
  }, 7);
  console.log("Visible SQL progress", { maxSnapshots, maxCopies, maxWrites, ...timing });
  expect(maxCopies).toBeLessThanOrEqual(BLOCKS * 3);
  expect(maxSnapshots).toBeLessThan(64);
  expect(maxWrites).toBeLessThan(68);
  expect(timing.medianMs).toBeLessThan(1000);
  expect(timing.p95Ms).toBeLessThan(3000);
}, 90000);

test("a waiting statement becomes visible and cancellation publishes one stable final state", async () => {
  const waiting = Promise.withResolvers<void>();
  const blocked = Promise.withResolvers<void>();
  let executes = 0;
  onExecute = () => {
    if (++executes === 3) {
      waiting.resolve();
      return blocked.promise;
    }
  };
  const frames: Awaited<ReturnType<typeof runSqlScript>>["entries"][] = [];
  let jobId = "";
  const running = runSqlScript({
    connection: postgres,
    database: null,
    sql: PG_SCRIPT,
    mode: "autocommit",
    onJob: (id) => {
      jobId = id;
    },
    onProgress: (entries) => frames.push(entries),
  });
  try {
    await waiting.promise;
    await Bun.sleep(100);
    const frame = frames.at(-1);
    expect(frame?.slice(0, 4).map((entry) => entry.status)).toEqual([
      "success",
      "success",
      "running",
      "pending",
    ]);
    expect(frames[0][0].status).toBe("running");
    expect(frames[0][3]).toBe(frame?.[3]);
    const updates = frames.length;
    await Bun.sleep(100);
    expect(frames.length).toBe(updates);
    await cancelTask(jobId);
  } finally {
    blocked.resolve();
  }
  const outcome = await running;
  expect(executes).toBe(3);
  expect(outcome.entries.slice(3).every((entry) => entry.status === "skipped")).toBe(true);
  expect(frames.at(-1)).toEqual(outcome.entries);
  expect(frames[0][3].status).toBe("pending");
  const task = useTasksStore.getState().tasks.find((entry) => entry.id === jobId);
  expect(task?.status).toBe("cancelled");
  expect(task?.progress).toBe(3);
  const finalUpdates = frames.length;
  await Bun.sleep(100);
  expect(frames.length).toBe(finalUpdates);
}, 10000);
