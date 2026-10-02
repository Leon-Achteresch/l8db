import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

import type { SavedConnection } from "../src/lib/connections";

type Handler = (command: string, args: Record<string, unknown>) => unknown;

const calls: { command: string; args: Record<string, unknown> }[] = [];
let handler: Handler = () => undefined;

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown> = {}) => {
    calls.push({ command, args });
    return handler(command, args);
  },
}));

const { useConnectionsStore } = await import("../src/lib/connections");
const { useProvidersStore } = await import("../src/lib/providers");
const { runSyncStatements } = await import("../src/lib/schema-compare/run");

const LITE: SavedConnection = {
  id: "lite",
  name: "Lite",
  kind: "sqlite",
  connectionString: "/tmp/l8db-fk.db",
  sslMode: "disable",
};

const statement = (sql: string, phase = 12.5) => ({
  key: sql,
  sql,
  plsql: false,
  dangerous: false,
  phase,
});

const REBUILD = [
  statement("PRAGMA defer_foreign_keys = ON", -0.5),
  statement('CREATE TABLE "main"."_l8db_copy_parent" AS SELECT "id" FROM "main"."parent"'),
  statement('DROP TABLE "main"."parent"'),
  statement('CREATE TABLE "main"."parent" (id INTEGER PRIMARY KEY)'),
  statement('INSERT INTO "main"."parent" ("id") SELECT "id" FROM "main"."_l8db_copy_parent"'),
  statement('DROP TABLE "main"."_l8db_copy_parent"'),
];

const empty = { columns: [], rows: [], rows_affected: 0, execution_time_ms: 0 };

function sqliteHandler(
  options: {
    enabled?: number;
    existing?: Record<string, unknown>[];
    violations?: Record<string, unknown>[];
    fail?: string;
    mismatch?: string[];
  } = {},
): Handler {
  let checks = 0;
  let tableChecks = 0;
  return (command, args) => {
    if (command === "begin_transaction") return "tx";
    if (command !== "execute_in_transaction") return undefined;
    const sql = String(args.sql);
    if (options.fail && sql === options.fail) throw new Error("SQLITE_ERROR: boom");
    const mismatch = options.mismatch ?? [];
    if (mismatch.length > 0 && sql === "PRAGMA foreign_key_check")
      throw new Error(`SQLite: foreign key mismatch - "${mismatch[0]}" referencing "p"`);
    if (sql.startsWith("SELECT name FROM"))
      return {
        ...empty,
        columns: ["name"],
        rows: ["p", ...mismatch, "child"].map((name) => ({ name })),
      };
    const scoped = /^PRAGMA "main"\.foreign_key_check\("(.+)"\)$/.exec(sql);
    if (scoped) {
      if (mismatch.includes(scoped[1]))
        throw new Error(`SQLite: foreign key mismatch - "${scoped[1]}" referencing "p"`);
      if (scoped[1] !== "child") return { ...empty, rows: [] };
      tableChecks += 1;
      const existing = options.existing ?? [];
      return {
        ...empty,
        columns: ["fkid", "parent", "rowid", "table"],
        rows: tableChecks === 1 ? existing : [...existing, ...(options.violations ?? [])],
      };
    }
    if (sql === "PRAGMA foreign_keys")
      return {
        ...empty,
        columns: ["foreign_keys"],
        rows: [{ foreign_keys: options.enabled ?? 1 }],
      };
    if (sql === "PRAGMA foreign_key_check") {
      checks += 1;
      const existing = options.existing ?? [];
      return {
        ...empty,
        columns: ["fkid", "parent", "rowid", "table"],
        rows: checks === 1 ? existing : [...existing, ...(options.violations ?? [])],
      };
    }
    return empty;
  };
}

async function execute(dryRun: boolean) {
  const steps: { status: string; message: string | null }[] = [];
  const summary = await runSyncStatements(LITE, { database: null, schema: "main" }, REBUILD, {
    continueOnError: false,
    dryRun,
    stopped: () => false,
    onStep: (index, step) => {
      steps[index] = step;
    },
  });
  return { summary, steps };
}

const sent = () =>
  calls.map((call) =>
    call.command === "execute_in_transaction" ? String(call.args.sql) : call.command,
  );

const REBUILD_SQL = REBUILD.map((item) => item.sql);

beforeAll(() => useProvidersStore.setState({ loaded: true }));
afterAll(() => useProvidersStore.setState({ loaded: false }));

beforeEach(() => {
  calls.length = 0;
  handler = sqliteHandler();
  useConnectionsStore.setState({ connections: [LITE] });
});

describe("SQLite-Schemasynchronisation mit Fremdschlüsseln", () => {
  test("schaltet Fremdschlüssel vor der Transaktion ab, prüft sie und stellt sie wieder her", async () => {
    const { summary, steps } = await execute(false);
    expect(sent()).toEqual([
      "begin_transaction",
      "COMMIT",
      "PRAGMA foreign_keys",
      "PRAGMA foreign_keys = OFF",
      "BEGIN",
      "PRAGMA foreign_key_check",
      ...REBUILD_SQL,
      "PRAGMA foreign_key_check",
      "COMMIT",
      "PRAGMA foreign_keys = ON",
      "BEGIN",
      "commit_transaction",
    ]);
    expect(summary).toMatchObject({ failed: 0, rolledBack: false });
    expect(steps.map((step) => step.status)).toEqual(REBUILD.map(() => "ok"));
  });

  test("behält abgeschaltete Fremdschlüssel bei", async () => {
    handler = sqliteHandler({ enabled: 0 });
    await execute(false);
    expect(sent().slice(-3)).toEqual(["PRAGMA foreign_keys = OFF", "BEGIN", "commit_transaction"]);
  });

  test("ignoriert Verletzungen, die vor der Synchronisation schon bestanden", async () => {
    const old = { table: "other", rowid: 3, parent: "missing", fkid: 0 };
    handler = sqliteHandler({ existing: [old, { ...old, rowid: 4 }] });
    const { summary } = await execute(false);
    expect(summary).toMatchObject({ failed: 0, rolledBack: false });
    expect(sent().at(-1)).toBe("commit_transaction");
  });

  test("meldet zusätzliche Verletzungen derselben Beziehung", async () => {
    const old = { table: "child", rowid: 3, parent: "parent", fkid: 0 };
    handler = sqliteHandler({ existing: [old], violations: [{ ...old, rowid: 4 }] });
    const { summary, steps } = await execute(false);
    expect(summary).toMatchObject({ failed: 1, rolledBack: true });
    expect(steps.at(-1)?.message).toContain("1 Zeile: child → parent");
    expect(sent()).not.toContain("commit_transaction");
  });

  test("meldet eine nach dem Festschreiben fehlgeschlagene Wiederherstellung als Warnung", async () => {
    handler = sqliteHandler({ fail: "PRAGMA foreign_keys = ON" });
    const { summary, steps } = await execute(false);
    expect(summary).toMatchObject({ failed: 0, rolledBack: false, warnings: 1 });
    expect(steps.at(-1)?.status).toBe("warning");
    expect(steps.at(-1)?.message).toContain("festgeschrieben");
  });

  test("rollt bei Fremdschlüsselverletzungen zurück und meldet sie", async () => {
    handler = sqliteHandler({
      violations: [{ table: "child", rowid: 11, parent: "parent", fkid: 0 }],
    });
    const { summary, steps } = await execute(false);
    expect(sent().slice(-5)).toEqual([
      "PRAGMA foreign_key_check",
      "ROLLBACK",
      "PRAGMA foreign_keys = ON",
      "BEGIN",
      "rollback_transaction",
    ]);
    expect(sent()).not.toContain("commit_transaction");
    expect(summary).toMatchObject({ failed: 1, rolledBack: true });
    expect(steps.at(-1)?.status).toBe("error");
    expect(steps.at(-1)?.message).toContain("Fremdschlüssel");
    expect(steps.at(-1)?.message).toContain("child");
  });

  test("stellt Fremdschlüssel auch nach einem fehlgeschlagenen Schritt wieder her", async () => {
    handler = sqliteHandler({ fail: 'DROP TABLE "main"."parent"' });
    const { summary, steps } = await execute(false);
    expect(sent().slice(-4)).toEqual([
      "ROLLBACK",
      "PRAGMA foreign_keys = ON",
      "BEGIN",
      "rollback_transaction",
    ]);
    expect(summary).toMatchObject({ failed: 1, rolledBack: true });
    expect(steps.map((step) => step.status)).toEqual([
      "ok",
      "ok",
      "error",
      "skipped",
      "skipped",
      "skipped",
    ]);
  });

  test("Probelauf nutzt dieselbe Fremdschlüsselbehandlung und rollt zurück", async () => {
    const { summary } = await execute(true);
    expect(sent()).toEqual([
      "begin_transaction",
      "COMMIT",
      "PRAGMA foreign_keys",
      "PRAGMA foreign_keys = OFF",
      "BEGIN",
      "PRAGMA foreign_key_check",
      ...REBUILD_SQL,
      "PRAGMA foreign_key_check",
      "ROLLBACK",
      "PRAGMA foreign_keys = ON",
      "BEGIN",
      "rollback_transaction",
    ]);
    expect(summary).toMatchObject({ dryRun: true, failed: 0, rolledBack: true });
  });

  test("Probelauf meldet Fremdschlüsselverletzungen", async () => {
    handler = sqliteHandler({
      violations: [{ table: "child", rowid: 11, parent: "parent", fkid: 0 }],
    });
    const { summary, steps } = await execute(true);
    expect(summary.failed).toBe(1);
    expect(steps.at(-1)?.message).toContain("Fremdschlüssel");
    expect(sent().at(-1)).toBe("rollback_transaction");
  });

  test("übernimmt Änderungen, wenn eine fremde Tabelle einen ungültigen Fremdschlüssel hat", async () => {
    handler = sqliteHandler({ mismatch: ["c"] });
    const { summary, steps } = await execute(false);
    expect(summary).toMatchObject({ failed: 0, rolledBack: false });
    expect(steps.map((step) => step.status)).toEqual(REBUILD.map(() => "ok"));
    expect(sent()).toContain('PRAGMA "main".foreign_key_check("child")');
    expect(sent().at(-1)).toBe("commit_transaction");
  });

  test("Probelauf scheitert nicht an einem ungültigen Fremdschlüssel einer fremden Tabelle", async () => {
    handler = sqliteHandler({ mismatch: ["c"] });
    const { summary } = await execute(true);
    expect(summary).toMatchObject({ dryRun: true, failed: 0, rolledBack: true });
  });

  test("meldet neue Verletzungen auch neben einem ungültigen Fremdschlüssel", async () => {
    handler = sqliteHandler({
      mismatch: ["c"],
      violations: [{ table: "child", rowid: 11, parent: "parent", fkid: 0 }],
    });
    const { summary, steps } = await execute(false);
    expect(summary).toMatchObject({ failed: 1, rolledBack: true });
    expect(steps.at(-1)?.message).toContain("1 Zeile: child → parent");
    expect(sent()).not.toContain("commit_transaction");
  });
});
