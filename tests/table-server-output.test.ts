import { beforeEach, expect, mock, test } from "bun:test";
import type { SavedConnection } from "../src/lib/connections";

const calls: string[] = [];
const warnings: string[] = [];
let messages = [{ level: "NOTICE", message: "trigger", detail: "detail" }];
let failOutput = false;
let failCommit = false;
let response: (() => Promise<typeof messages>) | null = null;
mock.module("sonner", () => ({ toast: { warning: (text: string) => warnings.push(text) } }));
mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string) => {
    calls.push(command);
    if (command === "begin_transaction") return "tx-output";
    if (command === "transaction_server_output") {
      if (failOutput) throw Error("output failure");
      return response ? response() : messages;
    }
    if (command === "commit_transaction" && failCommit) throw Error("commit failure");
  },
}));
const { runTableTransaction } = await import("../src/lib/managed-transactions");
const { withTableServerOutput } = await import("../src/lib/table-server-output");
const { useServerOutputStore, serverOutputForDatabase, clearServerOutputDatabase } = await import(
  "../src/lib/server-output"
);
const { useTransactionStore } = await import("../src/lib/transactions");
const { useSettingsStore } = await import("../src/lib/settings");
const { useProvidersStore, POSTGRES_CAPABILITIES } = await import("../src/lib/providers");
const connection: SavedConnection = {
  id: "output-connection",
  name: "Fixture",
  kind: "postgres",
  connectionString: "postgresql://fixture.invalid/db",
  sslMode: "disable",
};
const change = () => ({ type: "update" as const, schema: "s", table: "t", newValues: { v: "2" } });
const rows = () => useServerOutputStore.getState().entries[connection.id] ?? [];

beforeEach(() => {
  calls.length = 0;
  warnings.length = 0;
  failOutput = false;
  failCommit = false;
  response = null;
  messages = [{ level: "NOTICE", message: "trigger", detail: "detail" }];
  useServerOutputStore.setState({ entries: {}, enabled: { [connection.id]: true } });
  useTransactionStore.setState({
    transactions: [],
    busyTransactions: {},
    finalizingTransactions: [],
    panelOpen: false,
  });
  useSettingsStore.setState({ transactionsEnabled: false, transactionsPerTable: true });
  useProvidersStore.setState({
    loaded: true,
    providers: [
      {
        id: "postgres",
        kind: "postgres",
        capabilities: { ...POSTGRES_CAPABILITIES, server_output: true },
      },
    ] as never,
  });
});

test("immediate grid write collects exactly once before commit and preserves result", async () => {
  const result = { id: "new-row" };
  expect(
    await runTableTransaction(
      connection,
      "db",
      "s",
      "t",
      async () => {
        calls.push("write");
        return result;
      },
      change,
    ),
  ).toBe(result);
  expect(calls).toEqual([
    "begin_transaction",
    "write",
    "transaction_server_output",
    "commit_transaction",
  ]);
  expect(rows()).toMatchObject([
    { database: "db", level: "NOTICE", message: "trigger", detail: "detail" },
  ]);
});

test("failed write preserves its error and collects before rollback", async () => {
  const error = new Error("original write failure");
  await expect(
    runTableTransaction(
      connection,
      "db",
      "s",
      "t",
      async () => {
        throw error;
      },
      change,
    ),
  ).rejects.toBe(error);
  expect(calls).toEqual(["begin_transaction", "transaction_server_output", "rollback_transaction"]);
  expect(rows()).toHaveLength(1);
});

test("output failure cannot turn a successful write into rollback or hide its original failure", async () => {
  failOutput = true;
  expect(await runTableTransaction(connection, "db", "s", "t", async () => "ok", change)).toBe(
    "ok",
  );
  expect(calls).toEqual(["begin_transaction", "transaction_server_output", "commit_transaction"]);
  expect(warnings).toContain("Server-Ausgabe konnte nicht gelesen werden.");
  const error = new Error("write failure");
  await expect(
    runTableTransaction(
      connection,
      "db",
      "s",
      "t",
      async () => {
        throw error;
      },
      change,
    ),
  ).rejects.toBe(error);
});

test("commit failure still rolls back without repeated output reads", async () => {
  failCommit = true;
  await expect(
    runTableTransaction(connection, "db", "s", "t", async () => "ok", change),
  ).rejects.toThrow("commit failure");
  expect(calls).toEqual([
    "begin_transaction",
    "transaction_server_output",
    "commit_transaction",
    "rollback_transaction",
  ]);
});

test("staged operation retains change/busy/error contracts and leaves transaction open", async () => {
  useSettingsStore.setState({ transactionsEnabled: true });
  await runTableTransaction(connection, "db", "s", "t", async () => "ok", change);
  expect(calls).toEqual(["begin_transaction", "transaction_server_output"]);
  expect(useTransactionStore.getState().transactions[0].changes).toHaveLength(1);
  expect(useTransactionStore.getState().busyTransactions).toEqual({});
  await expect(
    runTableTransaction(
      connection,
      "db",
      "s",
      "t",
      async () => {
        throw Error("failed second write");
      },
      change,
    ),
  ).rejects.toThrow("failed second write");
  expect(useTransactionStore.getState().transactions[0].lastError).toContain("failed second write");
  expect(useTransactionStore.getState().transactions[0].changes).toHaveLength(1);
  expect(calls.filter((cmd) => /commit|rollback/.test(cmd))).toEqual([]);
});

test("late output remains with the captured connection/database despite active context change", async () => {
  let resolve!: (value: typeof messages) => void;
  let started!: () => void;
  const ready = new Promise<void>((yes) => {
    started = yes;
  });
  response = () =>
    new Promise((yes) => {
      resolve = yes;
      started();
    });
  const pending = withTableServerOutput(connection, "old-db", "tx-output", async () => "ok");
  await ready;
  useServerOutputStore
    .getState()
    .append("new-connection", "new-db", [{ level: "NOTICE", message: "other" }]);
  resolve(messages);
  await pending;
  expect(rows()[0].database).toBe("old-db");
  expect(useServerOutputStore.getState().entries["new-connection"][0].message).toBe("other");
});

test("disabled capture keeps warning-only behavior, unsupported provider never requests output", async () => {
  useServerOutputStore.getState().setEnabled(connection.id, false);
  messages = [
    { level: "WARNING", message: "warning", detail: "detail" },
    { level: "NOTICE", message: "hidden", detail: "detail" },
  ];
  await withTableServerOutput(connection, null, "tx-output", async () => true);
  expect(rows().map((entry) => entry.level)).toEqual(["WARNING"]);
  calls.length = 0;
  useProvidersStore.setState({
    providers: [
      {
        id: "postgres",
        kind: "postgres",
        capabilities: { ...POSTGRES_CAPABILITIES, server_output: false },
      },
    ] as never,
  });
  await withTableServerOutput(connection, null, "tx-output", async () => true);
  expect(calls).toEqual([]);
});

test("database-filtered view and clear preserve unrelated databases and default query scope", () => {
  const store = useServerOutputStore.getState();
  for (const db of ["a", "b", null])
    store.append(connection.id, db, [{ level: "NOTICE", message: String(db) }]);
  expect(serverOutputForDatabase(rows(), "a").map((row) => row.message)).toEqual(["a"]);
  expect(serverOutputForDatabase(rows())).toBe(rows());
  clearServerOutputDatabase(connection.id, "a");
  expect(rows().map((row) => row.database)).toEqual(["b", null]);
  clearServerOutputDatabase(connection.id, null);
  expect(rows().map((row) => row.database)).toEqual(["b"]);
  clearServerOutputDatabase(connection.id);
  expect(rows()).toHaveLength(0);
});
