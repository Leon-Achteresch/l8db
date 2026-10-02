import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { DatabaseKind } from "../src/lib/db";

type Store = Map<string, string>;

const calls: { command: string; sql?: string }[] = [];
let committed: Store = new Map();
const transactions = new Map<string, Store>();
let failRestore = false;

function apply(store: Store, sql: string) {
  for (const statement of sql.split(/;\n/).filter((part) => part.trim())) {
    const dropped = /DROP TRIGGER IF EXISTS .*?["`]([^"`]+)["`](?: ON |;|$)/.exec(statement);
    if (dropped) {
      store.delete(dropped[1]);
      continue;
    }
    if (statement.includes("BROKEN")) throw new Error("syntax error near BROKEN");
    if (failRestore && statement.includes("ORIGINAL")) throw new Error("access denied");
    const created = /CREATE TRIGGER (\w+)/.exec(statement);
    if (!created) throw new Error(`unexpected statement ${statement}`);
    if (store.has(created[1])) throw new Error(`trigger ${created[1]} already exists`);
    store.set(created[1], statement);
  }
}

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown> = {}) => {
    calls.push({ command, sql: typeof args.sql === "string" ? args.sql : undefined });
    switch (command) {
      case "execute_query": {
        const sql = String(args.sql);
        if (args.kind === "postgres") {
          const draft = new Map(committed);
          apply(draft, sql);
          committed = draft;
        } else {
          apply(committed, sql);
        }
        return { columns: [], rows: [], rows_affected: 0, execution_time_ms: 3 };
      }
      case "begin_transaction": {
        const id = `tx${transactions.size + 1}`;
        transactions.set(id, new Map(committed));
        return id;
      }
      case "execute_in_transaction": {
        const store = transactions.get(String(args.txId));
        if (!store) throw new Error("unknown transaction");
        apply(store, String(args.sql));
        return { columns: [], rows: [], rows_affected: 0, execution_time_ms: 1 };
      }
      case "commit_transaction": {
        committed = transactions.get(String(args.txId)) ?? committed;
        transactions.delete(String(args.txId));
        return undefined;
      }
      case "rollback_transaction":
        transactions.delete(String(args.txId));
        return undefined;
      default:
        return undefined;
    }
  },
}));

const { useSettingsStore } = await import("../src/lib/settings");
const { useConnectionsStore } = await import("../src/lib/connections/store");
const { PRODUCTION_LOCK_MESSAGE } = await import("../src/lib/environments");
const { answerSqlConfirmation, useSqlConfirmation } = await import("../src/lib/sql-confirmation");
const { replaceTrigger, triggerDropSql } = await import(
  "../src/features/triggers/trigger-view/replace-trigger"
);

let confirmations = 0;
useSqlConfirmation.subscribe((state) => {
  for (const request of state.requests) {
    confirmations++;
    queueMicrotask(() => answerSqlConfirmation(request.id, true));
  }
});

const ORIGINAL = "CREATE TRIGGER trg BEFORE INSERT ON t FOR EACH ROW SET NEW.a = 1 -- ORIGINAL";
const KINDS: DatabaseKind[] = ["postgres", "mysql", "sqlite"];

function replacement(kind: DatabaseKind, definition: string) {
  return {
    kind,
    connectionString: `${kind}://u@h/db`,
    database: "db",
    schema: kind === "sqlite" ? "main" : "app",
    table: "t",
    trigger: "trg",
    original: ORIGINAL,
    definition,
  };
}

beforeEach(() => {
  calls.length = 0;
  committed = new Map([["trg", ORIGINAL]]);
  transactions.clear();
  failRestore = false;
  confirmations = 0;
  useSettingsStore.setState({ confirmDestructiveQueries: true, productionReadOnly: false });
  useConnectionsStore.setState({
    connections: KINDS.map((kind) => ({
      id: kind,
      name: kind,
      kind,
      connectionString: `${kind}://u@h/db`,
      environment: "production" as const,
    })),
  });
});

describe("replaceTrigger", () => {
  for (const kind of KINDS) {
    test(`${kind}: keeps the original trigger when the new definition fails`, async () => {
      await expect(
        replaceTrigger(replacement(kind, "CREATE TRIGGER trg BROKEN BODY")),
      ).rejects.toThrow("syntax error near BROKEN");
      expect(committed.get("trg")).toBe(ORIGINAL);
      expect(transactions.size).toBe(0);
    });

    test(`${kind}: replaces the trigger and asks for confirmation once`, async () => {
      const definition = "CREATE TRIGGER trg AFTER INSERT ON t FOR EACH ROW SET @x = 2";
      await replaceTrigger(replacement(kind, definition));
      expect(committed.get("trg")).toBe(definition);
      expect(confirmations).toBe(1);
    });

    test(`${kind}: supports renaming the trigger`, async () => {
      const definition = "CREATE TRIGGER trg2 AFTER INSERT ON t FOR EACH ROW SET @x = 2";
      await replaceTrigger(replacement(kind, definition));
      expect([...committed.keys()]).toEqual(["trg2"]);
    });
  }

  test("postgres sends drop and create as one implicit transaction", async () => {
    await replaceTrigger(replacement("postgres", "CREATE TRIGGER trg AFTER INSERT ON t"));
    const sql = calls.filter((c) => c.command === "execute_query").map((c) => c.sql);
    expect(sql).toEqual([
      `${triggerDropSql("postgres", "app", "t", "trg")}CREATE TRIGGER trg AFTER INSERT ON t`,
    ]);
  });

  test("sqlite runs drop and create inside one managed transaction", async () => {
    await expect(
      replaceTrigger(replacement("sqlite", "CREATE TRIGGER trg BROKEN")),
    ).rejects.toThrow();
    expect(calls.map((c) => c.command)).toEqual([
      "begin_transaction",
      "execute_in_transaction",
      "execute_in_transaction",
      "rollback_transaction",
    ]);
    expect(calls.some((c) => c.command === "execute_query")).toBe(false);
  });

  test("mysql reports the original definition when the restore fails too", async () => {
    failRestore = true;
    const error = await replaceTrigger(replacement("mysql", "CREATE TRIGGER trg BROKEN")).catch(
      (e: unknown) => String(e),
    );
    expect(error).toContain("syntax error near BROKEN");
    expect(error).toContain("nicht wiederhergestellt");
    expect(error).toContain(ORIGINAL);
  });

  for (const kind of ["mysql", "sqlite"] as DatabaseKind[]) {
    test(`${kind}: respects the production write lock before touching the trigger`, async () => {
      useSettingsStore.setState({ productionReadOnly: true });
      await expect(
        replaceTrigger(replacement(kind, "CREATE TRIGGER trg AFTER INSERT ON t")),
      ).rejects.toThrow(PRODUCTION_LOCK_MESSAGE);
      expect(calls).toEqual([]);
      expect(committed.get("trg")).toBe(ORIGINAL);
    });
  }

  test("kinds without drop prefix execute the definition unchanged", async () => {
    committed = new Map();
    const definition = "CREATE TRIGGER trg AFTER INSERT ON t";
    await replaceTrigger(replacement("mssql", definition));
    expect(calls.filter((c) => c.command === "execute_query").map((c) => c.sql)).toEqual([
      definition,
    ]);
  });
});
