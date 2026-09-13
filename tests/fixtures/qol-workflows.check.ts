import { beforeEach, expect, mock, test } from "bun:test";
const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } });
Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: globalThis.localStorage } });
const calls: { command: string; args: Record<string, unknown> }[] = [];
let failSql = "";
let inserts = 0;
let failInsert = 0;
mock.module("@tauri-apps/api/core", () => ({ invoke: async (command: string, args: Record<string, unknown> = {}) => {
  calls.push({ command, args });
  if (command === "begin_transaction") return "qol-tx";
  if (command === "execute_query" || command === "execute_in_transaction") {
    if (failSql && String(args.sql).includes(failSql)) throw new Error("statement failed");
    return { columns: ["id"], rows: [{ id: "1" }], rows_affected: 1, execution_time_ms: 2 };
  }
  if (command === "insert_row_in_transaction") {
    inserts++;
    if (inserts === failInsert) throw new Error("insert failed");
    return { id: String(inserts) };
  }
  return true;
} }));
const { useSettingsStore } = await import("../../src/lib/settings");
const { useConnectionsStore } = await import("../../src/lib/connections");
const { useTransactionStore } = await import("../../src/lib/transactions");
const { executeQuery } = await import("../../src/lib/db");
const { useSqlConfirmation, answerSqlConfirmation } = await import("../../src/lib/sql-confirmation");
const { runSqlScript } = await import("../../src/lib/script-runner");
const { pasteRows } = await import("../../src/lib/paste-rows");
const { useTasksStore, startTask, finishTask, cancelTask } = await import("../../src/lib/tasks");
const { parsePortableWorkspace, exportPortableWorkspace, applyPortableWorkspace } = await import("../../src/lib/portable-workspace");
const { useTableTabs, tabKey, isQueryTabDirty, queryNeedsCloseConfirmation } = await import("../../src/lib/table-tabs");
const { remapPreset } = await import("../../src/lib/csv-mapping-presets");
const connection = { id: "qol", name: "QoL", kind: "postgres" as const, connectionString: "postgres://localhost/qol", sslMode: "disable" as const };

beforeEach(() => {
  calls.length = 0;
  failSql = "";
  inserts = 0;
  failInsert = 0;
  useSettingsStore.getState().resetToDefaults();
  useConnectionsStore.setState({ connections: [connection], activeId: connection.id });
  useTransactionStore.setState({ transactions: [], busyTransactions: {}, finalizingTransactions: [] });
  useTasksStore.setState({ tasks: [] });
});

test("destructive SQL waits for confirmation and rejection never reaches the backend", async () => {
  const execution = executeQuery("postgres", connection.connectionString, "DELETE FROM users", "qol");
  for (let i = 0; i < 50 && !useSqlConfirmation.getState().requests.length; i++) await new Promise((resolve) => setTimeout(resolve, 1));
  const request = useSqlConfirmation.getState().requests[0];
  expect(request.connection).toBe("QoL");
  expect(calls).toHaveLength(0);
  answerSqlConfirmation(request.id, false);
  await expect(execution).rejects.toThrow("abgebrochen");
  expect(calls).toHaveLength(0);
});

test("query and connection timeouts reach the bridge per execution", async () => {
  useSettingsStore.setState({ queryTimeout: 5, connectionTimeout: 60 });
  await executeQuery("postgres", connection.connectionString, "SELECT 1", "qol");
  expect(calls[0].args.options).toMatchObject({ queryTimeout: 5, connectionTimeout: 60 });
  useSettingsStore.setState({ queryTimeout: 60 });
  await executeQuery("postgres", connection.connectionString, "SELECT 1", "qol");
  expect(calls[1].args.options).toMatchObject({ queryTimeout: 60 });
});

test("script mode leaves successful writes in a reviewable transaction and skips after errors", async () => {
  failSql = "broken";
  const outcome = await runSqlScript({ connection, database: "qol", sql: "INSERT INTO t VALUES ('a;b'); SELECT broken; SELECT 3;", mode: "new-transaction" });
  expect(outcome.entries.map((entry) => entry.status)).toEqual(["success", "error", "skipped"]);
  expect(outcome.txId).toBe("qol-tx");
  expect(calls.some((call) => call.command === "commit_transaction")).toBe(false);
  expect(useTransactionStore.getState().transactions[0].changes).toHaveLength(1);
});

test("autocommit continues only when explicitly selected", async () => {
  failSql = "broken";
  const outcome = await runSqlScript({ connection, database: "qol", sql: "SELECT broken; SELECT 2;", mode: "autocommit", stopOnError: false });
  expect(outcome.entries.map((entry) => entry.status)).toEqual(["error", "success"]);
});

test("unterminated scripts execute nothing", async () => {
  await expect(runSqlScript({ connection, database: "qol", sql: "SELECT 1; SELECT 'broken", mode: "autocommit" })).rejects.toThrow("Nicht abgeschlossen");
  expect(calls).toHaveLength(0);
});

test("paste uses one managed transaction even when safe mode is off", async () => {
  useSettingsStore.setState({ transactionsEnabled: false });
  await pasteRows(connection, "qol", "public", "t", [{ id: "1" }, { id: "2" }]);
  expect(calls.filter((call) => call.command === "begin_transaction")).toHaveLength(1);
  expect(calls.filter((call) => call.command === "insert_row_in_transaction").map((call) => call.args.txId)).toEqual(["qol-tx", "qol-tx"]);
  expect(calls.some((call) => call.command === "commit_transaction")).toBe(false);
  expect(useTransactionStore.getState().transactions[0].changes).toHaveLength(2);
});

test("partial paste failures retain their transaction and report progress", async () => {
  failInsert = 2;
  await expect(pasteRows(connection, "qol", "public", "t", [{ id: "1" }, { id: "2" }, { id: "3" }])).rejects.toThrow("1 Zeilen eingefügt");
  expect(inserts).toBe(2);
  expect(useTransactionStore.getState().transactions).toHaveLength(1);
  expect(useTasksStore.getState().tasks[0].status).toBe("error");
});

test("portable import rejects unknown fields, malformed layouts and prototype keys", () => {
  const valid = exportPortableWorkspace();
  expect(parsePortableWorkspace(JSON.stringify(valid))).toEqual(valid);
  expect(() => parsePortableWorkspace(JSON.stringify({ ...valid, connections: [] }))).toThrow();
  expect(() => parsePortableWorkspace(JSON.stringify({ ...valid, layouts: { x: { order: [null], hidden: [] } } }))).toThrow();
  expect(() => parsePortableWorkspace('{"__proto__": {"polluted": true}}')).toThrow();
  expect(JSON.stringify(valid)).not.toContain(connection.connectionString);
});

test("portable import can be rolled back", () => {
  const value = exportPortableWorkspace();
  value.settings.queryTimeout = 60;
  const restore = applyPortableWorkspace(value);
  expect(useSettingsStore.getState().queryTimeout).toBe(60);
  restore();
  expect(useSettingsStore.getState().queryTimeout).toBe(30);
});

test("executed file changes remain dirty and closed drafts survive persistence", async () => {
  const tab = { kind: "query" as const, id: "draft", title: "draft.sql", sql: "SELECT 2", savedSql: "SELECT 1", lastExecutedSql: "SELECT 2", filePath: "/tmp/draft.sql" };
  expect(isQueryTabDirty(tab)).toBe(true);
  expect(queryNeedsCloseConfirmation(tab)).toBe(true);
  useTableTabs.setState({ tabs: [tab], recentlyClosed: [] });
  useTableTabs.getState().closeTab(tabKey(tab));
  const recovered = useTableTabs.getState().recentlyClosed[0];
  expect(recovered.sql).toBe("SELECT 2");
  await new Promise((resolve) => setTimeout(resolve, 300));
  const serialized = storage.get("l8db.table-tabs")!;
  expect(JSON.parse(serialized).state.recentlyClosed[0].sql).toBe("SELECT 2");
  useTableTabs.setState({ recentlyClosed: [] });
  await new Promise((resolve) => setTimeout(resolve, 300));
  storage.set("l8db.table-tabs", serialized);
  await useTableTabs.persist.rehydrate();
  expect(useTableTabs.getState().recentlyClosed[0].sql).toBe("SELECT 2");
});

test("mapping presets match headers by name after columns are reordered", () => {
  const preset = { id: "1", name: "sample", scope: "x", headers: ["name", "id"], mappings: [{ csvIndex: 0, target: "label" }, { csvIndex: 1, target: "id" }], delimiter: ",", quote: '"', hasHeader: true, emptyField: "null" as const };
  expect(remapPreset(preset, ["id", "name"])).toEqual([{ csvIndex: 0, target: "id" }, { csvIndex: 1, target: "label" }]);
  expect(() => remapPreset(preset, ["id", "id"])).toThrow();
});


test("late cancellation responses cannot revive completed tasks", async () => {
  let respond: (accepted: boolean) => void = () => {};
  const job = startTask({ title: "race" }, () => new Promise<boolean>((resolve) => { respond = resolve; }));
  const cancelling = cancelTask(job);
  finishTask(job, { ok: true });
  respond(false);
  await cancelling;
  expect(useTasksStore.getState().tasks[0].status).toBe("success");
});
