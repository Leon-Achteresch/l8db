import { expect, mock, test } from "bun:test";
import { measureScenario, reportScenario } from "../scripts/performance-report";

const sessions = new Map<string, number>();
let inFlight = 0;
let peak = 0;
let sessionPeak = 0;
let requests = 0;
const sessionsSeen = new Set<string>();

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown>) => {
    if (command !== "execute_query") return null;
    requests++;
    const session = String(args.session ?? "");
    sessionsSeen.add(session);
    sessions.set(session, (sessions.get(session) ?? 0) + 1);
    sessionPeak = Math.max(sessionPeak, sessions.get(session) ?? 0);
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 2));
    inFlight--;
    sessions.set(session, (sessions.get(session) ?? 1) - 1);
    return { columns: [], rows: [], rows_affected: 1, execution_time_ms: 2 };
  },
}));

const realMerge = await import("../src/lib/multi-target/merge");
const originalMerge = realMerge.mergeResults;
let merges = 0;
mock.module("../src/lib/multi-target/merge", () => ({
  ...realMerge,
  mergeResults: (...args: Parameters<typeof originalMerge>) => {
    merges++;
    return originalMerge(...args);
  },
}));

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { multiTarget, startMultiTargetRun } = await import("../src/lib/multi-target");
const { multiTargetExecutor } = await import("../src/lib/multi-target/executor");
const { useConnectionsStore } = await import("../src/lib/connections/store");
const { MultiTargetMergedView } = await import(
  "../src/features/query/multi-target/multi-target-merged-view"
);
type TargetRun = import("../src/lib/multi-target").TargetRun;
type SavedConnection = import("../src/lib/connections").SavedConnection;

const TARGETS = 20;
const STATEMENTS = 3;
const CONCURRENCY = 4;
const SCRIPT = Array.from(
  { length: STATEMENTS },
  (_, index) => `UPDATE t${index} SET v = v + 1 WHERE id = ${index};`,
).join("\n");

test("split Oracle scripts send one bounded, sequential request per statement and session", async () => {
  const connections: SavedConnection[] = Array.from({ length: TARGETS }, (_, index) => ({
    id: `ora-${index}`,
    name: `ORA ${index}`,
    kind: "oracle",
    connectionString: `oracle://app@ora${index}.example.test:1521/XE`,
    sslMode: "prefer",
  }));
  useConnectionsStore.setState({ connections });
  const byId = new Map(connections.map((entry) => [entry.id, entry]));
  let runs = new Map<string, TargetRun>();
  const runAll = async () => {
    requests = 0;
    peak = 0;
    sessionPeak = 0;
    sessionsSeen.clear();
    runs = new Map();
    await startMultiTargetRun({
      targets: connections.map((entry) => multiTarget(entry.id)),
      sql: SCRIPT,
      concurrency: CONCURRENCY,
      perServerLimit: 8,
      timeoutSeconds: 30,
      maxRows: 10,
      executor: multiTargetExecutor(true, async (id) => byId.get(id) as SavedConnection),
      onUpdate: (run) => runs.set(run.id, run),
    }).done;
  };
  const timing = await measureScenario(runAll, 5);
  expect(requests).toBe(TARGETS * STATEMENTS);
  expect(sessionsSeen.size).toBe(TARGETS);
  expect(sessionPeak).toBe(1);
  expect(peak).toBeLessThanOrEqual(CONCURRENCY);
  expect([...runs.values()].every((run) => run.status === "done" && run.rowsAffected === 3)).toBe(
    true,
  );
  expect(timing.p95Ms).toBeLessThan(250);
  await reportScenario("multi-target-oracle-split", {
    targets: TARGETS,
    statementsPerTarget: STATEMENTS,
    requestsPerTarget: requests / TARGETS,
    extraRequestsPerTarget: requests / TARGETS - 1,
    sessions: sessionsSeen.size,
    peakInFlightPerSession: sessionPeak,
    peakInFlight: peak,
    concurrencyLimit: CONCURRENCY,
    simulatedLatencyMsPerRequest: 2,
    total: timing,
    p95BudgetMs: 250,
  });
});

test("the merged view is built once per run, not on every target update", async () => {
  const items = Array.from({ length: 50 }, (_, index) => ({ id: `t${index}`, label: `T${index}` }));
  const result = {
    columns: ["id", "name"],
    rows: Array.from({ length: 1000 }, (_, id) => ({ id, name: `n${id}` })),
    rows_affected: null,
    execution_time_ms: 1,
  };
  const client = new QueryClient();
  const render = (running: boolean, finished: number) => {
    const runs: Record<string, TargetRun> = {};
    for (const item of items.slice(0, finished))
      runs[item.id] = {
        id: item.id,
        status: "done",
        durationMs: 1,
        rowCount: 1000,
        rowsAffected: null,
        truncated: false,
        error: null,
        notice: null,
        partial: null,
        result,
      };
    return renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(MultiTargetMergedView, { items, runs, sql: "SELECT 1", running }),
      ),
    );
  };
  merges = 0;
  for (let finished = 1; finished <= items.length; finished++) render(true, finished);
  const duringRun = merges;
  const started = performance.now();
  const markup = render(false, items.length);
  const finalMs = performance.now() - started;
  expect(duringRun).toBe(0);
  expect(merges).toBe(1);
  expect(markup).toContain("50.000 Zeilen aus 50 Zielen");
  expect(finalMs).toBeLessThan(500);
  await reportScenario("multi-target-merge-memo", {
    targets: items.length,
    rowsPerTarget: 1000,
    targetUpdates: items.length,
    mergesDuringRun: duringRun,
    mergesPerRun: merges,
    finalRenderMs: Math.round(finalMs),
    baselineMergesPerRunBeforeFix: items.length,
  });
});
