import { afterEach, beforeEach, expect, test } from "bun:test";
import { useConnectionsStore } from "../src/lib/connections";
import { useQueryWorkspace } from "../src/lib/query-workspace";
import { useTableTabs } from "../src/lib/table-tabs";
import { tableViewStateKey, useTableViewStateStore } from "../src/lib/table-view-state";
import {
  captureInvestigation,
  restoreInvestigation,
  saveInvestigation,
} from "../src/lib/workbench/investigations";
import {
  parameterScope,
  parameterValues,
  saveParameterSet,
} from "../src/lib/workbench/parameter-sets";
import { createQueryVariant } from "../src/lib/workbench/query-variants";
import {
  deleteWorkbenchRecord,
  listWorkbenchRecords,
  RECORD_LIMITS,
  type RecordKind,
  saveWorkbenchRecord,
  subscribeWorkbench,
  workbenchScope,
} from "../src/lib/workbench/records";
import {
  compareWatchedRows,
  type RowWatch,
  saveRowWatch,
  watchSnapshot,
} from "../src/lib/workbench/row-watches";
import {
  recordSuccessfulSql,
  type SqlState,
  saveSqlCheckpoint,
  sqlStateScope,
} from "../src/lib/workbench/sql-states";

const kinds: RecordKind[] = ["checkpoint", "success", "parameters", "investigation", "watch"];
const connection = {
  id: "qol",
  name: "QoL",
  kind: "postgres" as const,
  connectionString: "postgres://secret@localhost/db",
  sslMode: "disable" as const,
};
async function clearRecords() {
  for (const kind of kinds)
    for (const record of await listWorkbenchRecords(kind)) await deleteWorkbenchRecord(record.id);
}
beforeEach(async () => {
  await clearRecords();
  useConnectionsStore.setState({ connections: [connection], activeId: connection.id });
  useTableTabs.setState({
    tabs: [
      {
        kind: "query",
        id: "source",
        title: "Original",
        sql: "SELECT 1",
        filePath: "/private/a.sql",
        autoRun: true,
      },
    ],
    tabsByConnection: {},
  });
  useTableViewStateStore.setState({ views: {} });
});
afterEach(clearRecords);

test("named SQL checkpoints persist independently of editor memory, are scoped and can be deleted", async () => {
  const scope = workbenchScope("qol", "db");
  const saved = await saveSqlCheckpoint(scope, " vor Join ", {
    sql: "SELECT 1",
    editorId: "source",
    source: "manual",
  });
  const read = await listWorkbenchRecords<SqlState>("checkpoint", scope);
  expect(read[0].name).toBe("vor Join");
  expect(read[0].value.sql).toBe("SELECT 1");
  expect(await listWorkbenchRecords("checkpoint", workbenchScope("other", "db"))).toEqual([]);
  expect(await listWorkbenchRecords("checkpoint", workbenchScope("qol", "other"))).toEqual([]);
  await deleteWorkbenchRecord(saved.id);
  expect(await listWorkbenchRecords("checkpoint", scope)).toEqual([]);
  expect(() =>
    saveSqlCheckpoint(scope, "empty", { sql: "", editorId: "source", source: "manual" }),
  ).toThrow("leer");
});

test("successful SQL replaces only the same editor and database, retaining placeholders", async () => {
  await recordSuccessfulSql("qol", "db", "source", "SELECT :customer");
  await recordSuccessfulSql("qol", "db", "other", "SELECT 2");
  await recordSuccessfulSql("qol", "other-db", "source", "SELECT 3");
  await recordSuccessfulSql("qol", "db", "source", "SELECT :new_customer");
  const saved = await listWorkbenchRecords<SqlState>("success");
  expect(saved).toHaveLength(3);
  expect(
    saved.find((record) => record.scope === sqlStateScope("qol", "db", "source"))?.value.sql,
  ).toBe("SELECT :new_customer");
});

test("variants retain their creation baseline without file binding or automatic execution", () => {
  const id = createQueryVariant("source", "SELECT 2");
  const tabs = useTableTabs.getState().tabs;
  expect(tabs).toHaveLength(2);
  expect(tabs[0]).toMatchObject({ sql: "SELECT 1", filePath: "/private/a.sql" });
  expect(tabs[1]).toMatchObject({
    id,
    sql: "SELECT 2",
    variant: { sourceId: "source", title: "Original", sql: "SELECT 2" },
  });
  expect(tabs[1]).not.toHaveProperty("autoRun");
  expect(tabs[1]).not.toHaveProperty("filePath");
  useTableTabs.getState().updateQuerySql(id, "SELECT 4");
  expect(useTableTabs.getState().tabs[1]).toMatchObject({ variant: { sql: "SELECT 2" } });
});

test("parameter sets match exact SQL and scope, preserve types and exclude unrelated values", async () => {
  const sql = "SELECT :customer";
  const scope = parameterScope("qol", "db", sql);
  const refs = [{ name: "customer", label: ":customer", named: true }];
  const saved = await saveParameterSet(scope, "Kunde A", sql, refs, {
    customer: { type: "int", value: "42" },
    secret: { type: "text", value: "not-saved" },
  });
  expect(saved.value.values).toEqual({ customer: { type: "int", value: "42" } });
  expect(
    await listWorkbenchRecords("parameters", parameterScope("qol", "db", "SELECT :other")),
  ).toHaveLength(0);
  expect(() => parameterValues(refs, {})).toThrow();
  expect(() =>
    parameterValues(refs, { customer: { type: "int", value: "not-a-number" } }),
  ).toThrow();
});

test("investigations restore SQL and table filters additively, without secrets, file writes or auto-run", async () => {
  useTableTabs.getState().openTab({ schema: "public", table: "orders" });
  const key = tableViewStateKey("qol", "db", "public", "orders");
  if (!key) throw new Error("Missing table scope");
  useTableViewStateStore.getState().patch(key, {
    filter: "id = 4711",
    filterRaw: false,
    sorting: [{ id: "id", desc: true }],
    page: 3,
  });
  useQueryWorkspace.getState().update({ layout: "horizontal" });
  const value = captureInvestigation("qol", "db", "query:source", "Kunde hat doppelt bestellt");
  const saved = await saveInvestigation(workbenchScope("qol", "db"), "Bestellung", value);
  expect(JSON.stringify(saved)).not.toContain("secret@");
  expect(JSON.stringify(saved)).not.toContain("/private/a.sql");
  useTableViewStateStore.setState({ views: {} });
  useQueryWorkspace.getState().update({ layout: "vertical" });
  const active = restoreInvestigation("qol", "db", value);
  expect(active?.kind).toBe("query");
  expect(useTableTabs.getState().tabs).toHaveLength(3);
  expect(useTableTabs.getState().tabs.at(-1)).toMatchObject({
    kind: "query",
    sql: "SELECT 1",
    autoRun: false,
  });
  expect(useTableViewStateStore.getState().views[key]).toMatchObject({
    filter: "id = 4711",
    sorting: [{ id: "id", desc: true }],
    page: 0,
  });
  expect(useQueryWorkspace.getState().layout).toBe("horizontal");
});

test("row watches use composite primary keys across reloads and show absent rows without inferring deletion", async () => {
  const scope = JSON.stringify(["qol", "db", "public", "orders"]);
  const row = { account: "a", id: 1, value: "old", __ctid__: "old-physical-id" };
  await saveRowWatch(scope, row, ["account", "id"], ["account", "id", "value", "__ctid__"]);
  await saveRowWatch(scope, row, ["account", "id"], ["account", "id", "value"]);
  const watches = await listWorkbenchRecords<RowWatch>("watch", scope);
  expect(watches).toHaveLength(1);
  expect(watches[0].value.cells).not.toHaveProperty("__ctid__");
  expect(
    compareWatchedRows(watches, [{ account: "a", id: 1, value: "new", __ctid__: "different" }])[0]
      .changed,
  ).toEqual(["value"]);
  expect(compareWatchedRows(watches, [{ account: "b", id: 1, value: "new" }])[0]).toMatchObject({
    row: null,
    changed: [],
  });
  expect(compareWatchedRows(watches, [{ account: "a", id: 1 }])[0].changed).toEqual([]);
  expect(() => watchSnapshot({ __ctid__: "unstable" }, [], ["__ctid__"])).toThrow(
    "Primärschlüssel",
  );
  expect(() => watchSnapshot({ id: null }, ["id"], ["id"])).toThrow();
});

test("concurrent writers enforce fixed budgets atomically and retain unrelated records", async () => {
  const attempts = await Promise.allSettled(
    Array.from({ length: 105 }, (_, index) =>
      saveWorkbenchRecord({
        kind: "checkpoint",
        scope: String(index),
        name: `Stand ${index}`,
        value: "x",
      }),
    ),
  );
  const saved = await listWorkbenchRecords("checkpoint");
  expect(saved).toHaveLength(RECORD_LIMITS.checkpoint[0]);
  expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(5);
  const update = saved[0];
  await saveWorkbenchRecord({ ...update, value: "updated" });
  expect(await listWorkbenchRecords("checkpoint")).toHaveLength(100);
  await expect(
    saveWorkbenchRecord({ kind: "watch", scope: "db", name: "huge", value: "x".repeat(500_001) }),
  ).rejects.toThrow();
  await expect(
    saveWorkbenchRecord({ kind: "watch", scope: "db", name: " ", value: "x" }),
  ).rejects.toThrow();
});

test("subscribers are disposable and nothing polls or notifies while idle", async () => {
  let updates = 0;
  const unsubscribe = subscribeWorkbench(() => {
    updates++;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(updates).toBe(0);
  await saveWorkbenchRecord({ kind: "watch", scope: "a", name: "b", value: {} });
  expect(updates).toBe(1);
  unsubscribe();
  await saveWorkbenchRecord({ kind: "watch", scope: "a", name: "c", value: {} });
  expect(updates).toBe(1);
});

test("oversized cell values are rejected before serialization and remain safe when a watched value grows", async () => {
  const watch = await saveRowWatch("large-cell", { id: 1, value: "old" }, ["id"], ["id", "value"]);
  const row = { id: 1, value: "x".repeat(1_000_000) };
  expect(() => watchSnapshot(row, ["id"], ["id", "value"])).toThrow();
  expect(compareWatchedRows([watch], [row])[0].changed).toEqual(["value"]);
});
