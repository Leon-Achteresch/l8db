import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SavedConnection } from "../src/lib/connections";

const calls: { command: string; args: Record<string, unknown> }[] = [];
let failAt: number | null = null;
let sequence = 0;

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown> = {}) => {
    calls.push({ command, args });
    if (command === "begin_transaction") return `tx-${++sequence}`;
    if (command === "transaction_server_output") return [];
    if (command === "apply_row_changes_in_transaction") {
      const changes = args.changes as unknown[];
      return failAt === null
        ? { applied: changes.length, failed: null, error: null }
        : { applied: failAt, failed: failAt, error: "Zeile nicht gefunden" };
    }
    if (command === "preview_row_changes")
      return (args.changes as { type: string }[]).map((change, index) => ({
        index,
        sql: `${change.type.toUpperCase()} #${index}`,
        params: [],
      }));
    return null;
  },
}));

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
  configurable: true,
});
Object.defineProperty(globalThis, "window", {
  value: {
    localStorage: globalThis.localStorage,
    addEventListener() {},
    removeEventListener() {},
  },
  configurable: true,
});

const { POSTGRES_CAPABILITIES, useProvidersStore } = await import("../src/lib/providers");
const { useSettingsStore } = await import("../src/lib/settings");
const { useConnectionsStore } = await import("../src/lib/connections/store");
const { useTransactionStore } = await import("../src/lib/transactions");
const { answerSqlConfirmation, useSqlConfirmation } = await import("../src/lib/sql-confirmation");
const staged = await import("../src/lib/staged-edits");
const { stagedTablesClosedWith, tabHasStagedChanges } = await import("../src/lib/tab-transactions");
const { useTableTabs } = await import("../src/lib/table-tabs");
const { TabStatusMarkers } = await import("../src/features/shell/table-tabs/tab-status-markers");

const prod: SavedConnection = {
  id: "prod",
  name: "Prod",
  kind: "postgres",
  connectionString: "postgres://prod/app",
  sslMode: "disable",
  environment: "production",
};
const dev: SavedConnection = { ...prod, id: "dev", name: "Dev", environment: "development" };
const target = { connectionId: "prod", database: null, schema: "public", table: "orders" };
const key = staged.stagedTableKey(target);
const devTarget = { ...target, connectionId: "dev" };
const devKey = staged.stagedTableKey(devTarget);
const row = (id: number, name = `n${id}`) => ({ id, name, __ctid__: `(0,${id})@1@1` });
const full = (source: Record<string, unknown>, name: string | null) => ({
  id: String(source.id),
  name,
});
const entry = () => staged.useStagedEdits.getState().tables[key];
const devEntry = () => staged.useStagedEdits.getState().tables[devKey];

beforeEach(() => {
  calls.length = 0;
  failAt = null;
  staged.useStagedEdits.setState({ tables: {}, committing: [] });
  useTransactionStore.setState({
    transactions: [],
    busyTransactions: {},
    finalizingTransactions: [],
  });
  useSettingsStore.setState({ collectCellEdits: "production", productionConfirmCommit: false });
  useConnectionsStore.setState({ connections: [prod, dev], activeId: "prod" });
  useProvidersStore.setState({
    loaded: true,
    providers: (["postgres", "dynamodb"] as const).map((kind) => ({
      id: kind,
      name: kind,
      group: "test",
      kind,
      default_port: null,
      file_based: false,
      url_schemes: [kind],
      placeholder: "",
      hint: "",
      hosts: [],
      driver: { type: "builtin" },
      driver_status: { available: true, detail: "", install: [], install_command: null },
      capabilities: POSTGRES_CAPABILITIES,
    })),
  });
});

describe("staged cell edits", () => {
  test("mode decides where edits are collected", () => {
    expect(staged.collectsTableChanges(prod, null, "public", "orders")).toBe(true);
    expect(staged.collectsTableChanges(dev, null, "public", "orders")).toBe(false);
    useSettingsStore.setState({ collectCellEdits: "always" });
    expect(staged.collectsTableChanges(dev, null, "public", "orders")).toBe(true);
    expect(staged.collectsTableChanges({ ...dev, kind: "dynamodb" }, null, "public", "t")).toBe(
      false,
    );
    useSettingsStore.setState({ collectCellEdits: "off" });
    expect(staged.collectsTableChanges(prod, null, "public", "orders")).toBe(false);
  });

  test("an open managed transaction keeps the immediate path", () => {
    useTransactionStore.setState({
      transactions: [
        {
          txId: "open",
          connectionId: "prod",
          connectionName: "Prod",
          scope: { type: "table", schema: "public", table: "orders" },
          changes: [],
          startedAt: 0,
        },
      ],
    });
    expect(staged.collectsTableChanges(prod, null, "public", "orders")).toBe(false);
  });

  test("staging sends no request, re-edits merge and editing back removes the change", () => {
    const original = row(1, "a");
    staged.stageUpdate(target, original.__ctid__, full(original, "b"), original);
    staged.stageUpdate(target, original.__ctid__, full(original, "c"), { ...original, name: "b" });
    expect(entry().changes).toHaveLength(1);
    expect(entry().changes[0]).toMatchObject({ type: "update", updates: { name: "c" } });
    staged.stageUpdate(target, original.__ctid__, full(original, "a"), { ...original, name: "c" });
    expect(entry()).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  test("inserts, deletes and per-change discard", () => {
    const first = row(1);
    staged.stageUpdate(target, first.__ctid__, full(first, "x"), first);
    staged.stageDelete(target, first.__ctid__, { ...first, name: "x" });
    expect(entry().changes).toEqual([
      { id: expect.any(String), type: "delete", ctid: first.__ctid__, original: first },
    ]);
    staged.stageInsert(target, { name: "new" });
    const insert = entry().changes[1];
    const insertCtid = `${staged.STAGED_ROW_PREFIX}${insert.id}`;
    staged.stageUpdate(target, insertCtid, { id: null, name: "newer" }, { name: "new" });
    expect(entry().changes[1]).toMatchObject({ type: "insert", values: { name: "newer" } });
    staged.discardStagedChange(key, entry().changes[0].id);
    expect(entry().changes.map((change) => change.type)).toEqual(["insert"]);
    staged.stageDelete(target, insertCtid, {});
    expect(entry()).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  test("markers follow rows across pages, sorting and refreshes", () => {
    const rows = [row(1), row(2), row(3)];
    staged.stageUpdate(target, rows[1].__ctid__, full(rows[1], "edited"), rows[1]);
    staged.stageDelete(target, rows[2].__ctid__, rows[2]);
    staged.stageInsert(target, { name: "fresh" });
    const otherPage = [row(7), row(8)];
    expect(staged.overlayStagedRows(otherPage, entry(), false)).toBe(otherPage);
    const resorted = [row(3), row(2), row(1)];
    const shown = staged.overlayStagedRows(resorted, entry(), true);
    expect(shown.map((item) => item.name)).toEqual(["fresh", "n3", "edited", "n1"]);
    expect(staged.stagedMarkOf(shown[0])?.type).toBe("insert");
    expect(staged.stagedMarkOf(shown[1])?.type).toBe("delete");
    expect([...(staged.stagedMarkOf(shown[2])?.columns ?? [])]).toEqual(["name"]);
    expect(staged.stagedMarkOf(shown[3])).toBeUndefined();
    expect(shown[3]).toBe(resorted[2]);
    expect(entry().changes).toHaveLength(3);
  });

  test("preview and commit send the same ordered changes in one transaction", async () => {
    const rows = [row(1), row(2)];
    staged.stageUpdate(devTarget, rows[0].__ctid__, full(rows[0], "u"), rows[0]);
    staged.stageInsert(devTarget, { name: "i" });
    staged.stageDelete(devTarget, rows[1].__ctid__, rows[1]);
    const preview = await staged.previewStagedTable(devKey);
    expect(preview.map((item) => item.sql)).toEqual(["UPDATE #0", "INSERT #1", "DELETE #2"]);
    expect(staged.stagedSqlText(devEntry(), preview)).toBe(
      "UPDATE #0;\n\nINSERT #1;\n\nDELETE #2;",
    );
    const previewChanges = calls.find((call) => call.command === "preview_row_changes")?.args
      .changes;
    calls.length = 0;
    expect(await staged.commitStagedTable(devKey)).toBe(3);
    expect(calls.map((call) => call.command)).toEqual([
      "begin_transaction",
      "apply_row_changes_in_transaction",
      "transaction_server_output",
      "commit_transaction",
    ]);
    const applied = calls[1].args;
    expect(applied.changes).toEqual(previewChanges);
    expect(applied.changes).toEqual([
      { type: "update", ctid: rows[0].__ctid__, updates: { name: "u" } },
      { type: "insert", values: { name: "i" } },
      { type: "delete", ctid: rows[1].__ctid__ },
    ]);
    expect(devEntry()).toBeUndefined();
  });

  test("a failing change rolls back everything and stays staged with a marker", async () => {
    const rows = [row(1), row(2)];
    staged.stageUpdate(devTarget, rows[0].__ctid__, full(rows[0], "u"), rows[0]);
    staged.stageDelete(devTarget, rows[1].__ctid__, rows[1]);
    failAt = 1;
    await expect(staged.commitStagedTable(devKey)).rejects.toThrow("Änderung 2 von 2");
    expect(calls.map((call) => call.command)).toContain("rollback_transaction");
    expect(calls.map((call) => call.command)).not.toContain("commit_transaction");
    expect(devEntry().changes).toHaveLength(2);
    expect(devEntry().failedId).toBe(devEntry().changes[1].id);
    const shown = staged.overlayStagedRows(rows, devEntry(), false);
    expect(staged.stagedMarkOf(shown[1])?.failed).toBe(true);
    failAt = null;
    await staged.commitStagedTable(devKey);
    expect(devEntry()).toBeUndefined();
  });

  test("production commits with deletes ask first and keep changes on cancel", async () => {
    const original = row(1);
    staged.stageDelete(target, original.__ctid__, original);
    const pending = staged.commitStagedTable(key);
    await Bun.sleep(0);
    const request = useSqlConfirmation.getState().requests[0];
    expect(request.title).toBe("Auf Produktion committen?");
    expect(() => staged.stageInsert(target, { name: "late" })).toThrow("übernommen");
    answerSqlConfirmation(request.id, false);
    await expect(pending).rejects.toThrow("abgebrochen");
    expect(calls.map((call) => call.command)).not.toContain("begin_transaction");
    expect(entry().changes).toHaveLength(1);
  });

  test("closing the last tab of a table reports its staged changes", () => {
    const orders = { kind: "table" as const, schema: "public", table: "orders" };
    const other = { kind: "table" as const, schema: "public", table: "items" };
    useTableTabs.setState({ tabs: [orders, other], tabsByConnection: {} });
    staged.stageInsert(target, { name: "x" });
    expect(tabHasStagedChanges(orders, "prod", staged.useStagedEdits.getState().tables)).toBe(true);
    expect(tabHasStagedChanges(other, "prod", staged.useStagedEdits.getState().tables)).toBe(false);
    const keys = useTableTabs
      .getState()
      .tabs.map((tab) => (tab.kind === "table" ? `table:${tab.schema}.${tab.table}` : ""));
    expect(stagedTablesClosedWith(keys)).toEqual([key]);
    expect(stagedTablesClosedWith([keys[1]])).toEqual([]);
    expect(staged.hasStagedChanges("prod")).toBe(true);
    expect(staged.hasStagedChanges("dev")).toBe(false);
  });

  test("switching away from a connection with staged changes is refused", async () => {
    const { activateConnection } = await import("../src/lib/ssh/activation");
    staged.stageInsert(target, { name: "x" });
    const outcome = await activateConnection("dev");
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("gesammelten Änderungen");
    expect(useConnectionsStore.getState().activeId).toBe("prod");
    expect(calls).toHaveLength(0);
  });

  test("tabs with staged changes show a marker", () => {
    const html = renderToStaticMarkup(
      createElement(TabStatusMarkers, {
        environment: null,
        transaction: false,
        staged: true,
        isActive: false,
      }),
    );
    expect(html).toContain("data-tab-staged");
  });
});
