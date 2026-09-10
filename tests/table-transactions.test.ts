import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { SavedConnection } from "../src/lib/connections";
import type { DatabaseKind } from "../src/lib/db";

const calls: { command: string; args: Record<string, unknown> }[] = [];
let sequence = 0;
let failBegin = false;
const active = new Set<string>();

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown> = {}) => {
    calls.push({ command, args });
    if (command === "begin_transaction") {
      if (failBegin) throw new Error("unavailable");
      const id = `table-test-${++sequence}`;
      active.add(id);
      return id;
    }
    if (command === "commit_transaction" || command === "rollback_transaction") {
      active.delete(String(args.txId));
    }
    if (command === "list_transactions") return [...active];
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
  value: { localStorage: globalThis.localStorage },
  configurable: true,
});

const { POSTGRES_CAPABILITIES, useProvidersStore } = await import("../src/lib/providers");
const { useSettingsStore } = await import("../src/lib/settings");
const { useTransactionStore, getQueryTransaction, getTableTransaction } = await import(
  "../src/lib/transactions"
);
const { ensureManagedTransaction, runTableTransaction, finishManagedTransaction } = await import(
  "../src/lib/managed-transactions"
);

function connection(kind: DatabaseKind = "oracle"): SavedConnection {
  return {
    id: "table-test",
    name: "Table test",
    kind,
    connectionString: `${kind}://localhost/test`,
    sslMode: "disable",
  };
}

async function edit(table: string, db: string | null = null, conn = connection()) {
  return runTableTransaction(
    conn,
    db,
    "APP",
    table,
    async (txId) => txId,
    () => ({ type: "update", schema: "APP", table, newValues: { name: "updated" } }),
  );
}

beforeEach(() => {
  calls.length = 0;
  active.clear();
  failBegin = false;
  useTransactionStore.setState({
    transactions: [],
    busyTransactions: {},
    finalizingTransactions: [],
    panelOpen: false,
  });
  useSettingsStore.setState({ transactionsEnabled: true, transactionsPerTable: true });
  useProvidersStore.setState({
    loaded: true,
    providers: (["oracle", "postgres", "mysql", "mssql", "sqlite"] as const).map((kind) => ({
      id: kind,
      name: kind,
      group: "test",
      kind,
      default_port: null,
      file_based: kind === "sqlite",
      url_schemes: [kind],
      placeholder: "",
      hint: "",
      hosts: [],
      driver: { type: "builtin" },
      driver_status: { available: true, detail: "", install: [], install_command: null },
      capabilities: { ...POSTGRES_CAPABILITIES, table_transactions: kind !== "sqlite" },
    })),
  });
});

describe("table transactions", () => {
  for (const kind of ["oracle", "postgres", "mysql", "mssql"] as const) {
    test(`${kind}: committing B leaves A and C open`, async () => {
      const ids = await Promise.all(
        ["A", "B", "C"].map((table) => edit(table, null, connection(kind))),
      );
      expect(new Set(ids).size).toBe(3);
      await finishManagedTransaction(ids[1], true);
      expect([...active]).toEqual([ids[0], ids[2]]);
      expect(useTransactionStore.getState().transactions.map((tx) => tx.scope)).toEqual([
        { type: "table", schema: "APP", table: "A" },
        { type: "table", schema: "APP", table: "C" },
      ]);
      expect(calls.filter((call) => call.command === "commit_transaction")).toEqual([
        { command: "commit_transaction", args: { txId: ids[1] } },
      ]);
    });
  }

  test("parallel edits of the same table reuse a single session", async () => {
    const ids = await Promise.all([edit("A"), edit("A"), edit("B")]);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[0]).not.toBe(ids[2]);
    expect(useTransactionStore.getState().transactions[0].changes).toHaveLength(2);
    expect(calls.filter((call) => call.command === "begin_transaction")).toHaveLength(2);
  });

  test("database and schema are part of the transaction identity", async () => {
    const first = await edit("A", "one");
    const second = await edit("A", "two");
    const other = await ensureManagedTransaction(connection(), "one", {
      type: "table",
      schema: "OTHER",
      table: "A",
    });
    expect(new Set([first, second, other.txId]).size).toBe(3);
    expect(getTableTransaction("table-test", "one", "APP", "A")?.txId).toBe(first);
    expect(getTableTransaction("table-test", "two", "APP", "A")?.txId).toBe(second);
    expect(getTableTransaction("table-test", "three", "APP", "A")).toBeUndefined();
  });

  test("SQL never picks the first table transaction", async () => {
    const tableId = await edit("A");
    expect(getQueryTransaction("table-test")).toBeUndefined();
    const query = await ensureManagedTransaction(connection(), null, { type: "query" });
    expect(query.txId).not.toBe(tableId);
    expect(getQueryTransaction("table-test")?.txId).toBe(query.txId);
    expect(getTableTransaction("table-test", null, "APP", "B")).toBeUndefined();
    expect(await edit("A")).toBe(tableId);
  });

  test("existing legacy transactions stay together", async () => {
    useTransactionStore.getState().addTransaction({
      txId: "legacy",
      connectionId: "table-test",
      connectionName: "Legacy",
      changes: [],
      startedAt: 0,
    });
    expect(await edit("A")).toBe("legacy");
    expect(await edit("B")).toBe("legacy");
    expect(getQueryTransaction("table-test")?.txId).toBe("legacy");
    expect(calls).toHaveLength(0);
  });

  test("shared mode keeps table edits and SQL together", async () => {
    useSettingsStore.setState({ transactionsPerTable: false });
    const first = await edit("A");
    expect(await edit("B")).toBe(first);
    expect(getQueryTransaction("table-test")?.txId).toBe(first);
    expect(useTransactionStore.getState().transactions[0].scope).toEqual({ type: "connection" });
  });

  test("SQLite uses one writer even with table mode enabled", async () => {
    const first = await edit("A", null, connection("sqlite"));
    expect(await edit("B", null, connection("sqlite"))).toBe(first);
    expect(useTransactionStore.getState().transactions[0].scope).toEqual({ type: "connection" });
  });

  test("rollback only closes its table", async () => {
    const first = await edit("A");
    const second = await edit("B");
    await finishManagedTransaction(first, false);
    expect([...active]).toEqual([second]);
    expect(useTransactionStore.getState().transactions[0].txId).toBe(second);
  });

  test("autocommit mode does not accidentally commit another open table", async () => {
    const first = await edit("A");
    useSettingsStore.setState({ transactionsEnabled: false });
    const second = await edit("B");
    expect(second).not.toBe(first);
    expect([...active]).toEqual([first]);
    expect(await edit("A")).toBe(first);
  });

  test("failed session creation can be retried without a stale pending promise", async () => {
    failBegin = true;
    await expect(edit("A")).rejects.toThrow("unavailable");
    failBegin = false;
    await edit("A");
    expect(useTransactionStore.getState().transactions).toHaveLength(1);
  });

  test("commit is blocked while a table edit is running", async () => {
    const txId = await edit("A");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = runTableTransaction(
      connection(),
      null,
      "APP",
      "A",
      async () => gate,
      () => ({ type: "delete", schema: "APP", table: "A" }),
    );
    await Promise.resolve();
    await expect(finishManagedTransaction(txId, true)).rejects.toThrow("laufende Operation");
    release();
    await pending;
    await finishManagedTransaction(txId, true);
    expect(active.size).toBe(0);
  });
});
