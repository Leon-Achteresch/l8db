import { heapStats } from "bun:jsc";
import { expect, mock, test } from "bun:test";
import { measureScenario, reportScenario } from "./fixtures/usage-performance";

const requests: string[] = [];
mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown> = {}) => {
    if (command === "list_providers") return [];
    requests.push(command);
    if (command === "begin_transaction") return "tx-perf";
    if (command === "transaction_server_output") return [];
    if (command === "apply_row_changes_in_transaction")
      return { applied: (args.changes as unknown[]).length, failed: null, error: null };
    if (command === "preview_row_changes")
      return (args.changes as { type: string }[]).map((change, index) => ({
        index,
        sql: `${change.type.toUpperCase()} "public"."orders" SET "name" = 'value ${index}' WHERE ctid = '(0,${index})'::tid`,
        params: [],
      }));
    return null;
  },
}));
const storage = new Map<string, string>();
let guardWrites = 0;
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (key.startsWith("l8db.window-tasks:")) guardWrites++;
      storage.set(key, value);
    },
    removeItem: (key: string) => storage.delete(key),
  },
  configurable: true,
});
Object.defineProperty(globalThis, "window", {
  value: { localStorage: globalThis.localStorage, addEventListener() {}, removeEventListener() {} },
  configurable: true,
});

const staged = await import("../src/lib/staged-edits");
const { collectUpdateBlockers, describeUpdateBlockers } = await import(
  "../src/lib/update-blockers"
);
const { useConnectionsStore } = await import("../src/lib/connections/store");
const { useSettingsStore } = await import("../src/lib/settings");

const TABLE_ROWS = 100_000;
const STAGED = 5_000;
const WINDOW = 500;

test("5,000 staged changes over a 100k-row table stay fast, bounded and commit in one transaction", async () => {
  useConnectionsStore.setState({
    connections: [
      {
        id: "dev",
        name: "Dev",
        kind: "postgres",
        connectionString: "postgres://dev/app",
        sslMode: "disable",
      },
    ],
  });
  useSettingsStore.setState({ productionConfirmCommit: false });
  const table = Array.from({ length: TABLE_ROWS }, (_, id) => ({
    id,
    name: `row-${id}`,
    note: "x".repeat(24),
    __ctid__: `(${id >> 8},${id & 255})@1@1`,
  }));
  const target = { connectionId: "dev", database: null, schema: "public", table: "orders" };
  const key = staged.stagedTableKey(target);
  Bun.gc(true);
  const before = heapStats().heapSize;

  const latencies: number[] = [];
  for (let index = 0; index < STAGED; index++) {
    const row = table[(index * 19) % TABLE_ROWS];
    const started = performance.now();
    if (index % 10 === 9) staged.stageDelete(target, row.__ctid__ as string, row);
    else if (index % 10 === 8) staged.stageInsert(target, { name: `new-${index}` });
    else
      staged.stageUpdate(
        target,
        row.__ctid__ as string,
        { id: String(row.id), name: `edit-${index}`, note: row.note },
        row,
      );
    latencies.push(performance.now() - started);
  }
  latencies.sort((left, right) => left - right);
  const staging = {
    medianMs: latencies[Math.floor(latencies.length / 2)],
    p95Ms: latencies[Math.ceil(latencies.length * 0.95) - 1],
  };
  const entry = staged.useStagedEdits.getState().tables[key];
  expect(entry.changes).toHaveLength(STAGED);
  expect(requests).toHaveLength(0);

  Bun.gc(true);
  const retainedBytes = Math.max(0, heapStats().heapSize - before);

  const window = table.slice(0, WINDOW);
  let shown: Record<string, unknown>[] = [];
  const overlay = await measureScenario(() => {
    shown = staged.overlayStagedRows(window, entry, true);
  }, 21);
  const inserts = entry.changes.filter((change) => change.type === "insert").length;
  const markedInWindow = shown.filter((row) => staged.stagedMarkOf(row)).length;
  expect(shown.length).toBe(WINDOW + inserts);
  expect(markedInWindow).toBeLessThanOrEqual(WINDOW + inserts);
  expect(shown.slice(inserts).filter((row, index) => row !== window[index]).length).toBe(
    markedInWindow - inserts,
  );

  requests.length = 0;
  const statements = await staged.previewStagedTable(key);
  let text = "";
  const preview = await measureScenario(() => {
    text = staged.stagedSqlText(entry, statements);
  }, 11);
  expect(requests).toEqual(["preview_row_changes"]);
  expect(statements).toHaveLength(STAGED);
  expect(text.split(";\n\n")).toHaveLength(STAGED);

  requests.length = 0;
  let blockers = await collectUpdateBlockers();
  const guard = await measureScenario(async () => {
    blockers = await collectUpdateBlockers();
  }, 21);
  expect(blockers.staged).toBe(STAGED);
  expect(describeUpdateBlockers(blockers)).toContain(`${STAGED} nicht übernommene Änderungen`);
  expect(requests.every((command) => command === "list_transactions")).toBe(true);
  expect(guardWrites).toBe(1);

  requests.length = 0;
  const started = performance.now();
  expect(await staged.commitStagedTable(key)).toBe(STAGED);
  const commitMs = performance.now() - started;
  expect(requests).toEqual([
    "begin_transaction",
    "apply_row_changes_in_transaction",
    "transaction_server_output",
    "commit_transaction",
  ]);
  expect(staged.useStagedEdits.getState().tables[key]).toBeUndefined();
  const idle = requests.length;
  await new Promise((resolve) => setTimeout(resolve, 25));
  expect(requests.length).toBe(idle);

  reportScenario("staged-edits", {
    tableRows: TABLE_ROWS,
    staged: STAGED,
    window: WINDOW,
    staging,
    overlay,
    markedInWindow,
    preview,
    restartGuard: guard,
    guardWrites,
    commitMs,
    commitRequests: idle,
    retainedBytes,
  });
  expect(staging.medianMs).toBeLessThan(0.2);
  expect(staging.p95Ms).toBeLessThan(1);
  expect(overlay.medianMs).toBeLessThan(5);
  expect(preview.medianMs).toBeLessThan(20);
  expect(guard.p95Ms).toBeLessThan(5);
  expect(commitMs).toBeLessThan(100);
  expect(retainedBytes).toBeLessThan(8 * 1024 * 1024);
});
