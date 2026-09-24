import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

import type { SavedConnection } from "../src/lib/connections";
import type { CatalogObject } from "../src/lib/db";

type Handler = (command: string, args: Record<string, unknown>) => unknown;

const calls: { command: string; args: Record<string, unknown> }[] = [];
let handler: Handler = () => undefined;
let version = "PostgreSQL 18.0 on aarch64-apple-darwin";
let cancelled: string[] = [];

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown> = {}) => {
    if (command === "cancel_execution") {
      cancelled.push(String(args.jobId));
      return true;
    }
    calls.push({ command, args });
    if (command === "execute_query" && args.sql === "SELECT version()")
      return { columns: ["version"], rows: [{ version }] };
    return handler(command, args);
  },
}));

const { useConnectionsStore } = await import("../src/lib/connections");
const { useProvidersStore } = await import("../src/lib/providers");
const { runSyncStatements, supportsDdlRollback } = await import("../src/lib/schema-compare/run");
const { PRE_TRANSACTION_PHASE } = await import("../src/lib/schema-compare/script");
const { pickSchema, reverseSchemaCompare, runSchemaCompare, setupProblem, useSchemaCompareStore } =
  await import("../src/lib/schema-compare/store");

const PG: SavedConnection = {
  id: "pg",
  name: "PG",
  kind: "postgres",
  connectionString: "postgresql://u:p@127.0.0.1:5432/app",
  sslMode: "disable",
};
const ORA: SavedConnection = {
  id: "ora",
  name: "ORA",
  kind: "oracle",
  connectionString: "oracle://u:p@127.0.0.1:1521/FREEPDB1",
  sslMode: "disable",
};

const statement = (sql: string, phase = 12, checks?: { sql: string; message: string }[]) => ({
  key: sql,
  sql,
  plsql: false,
  dangerous: false,
  phase,
  ...(checks ? { checks } : {}),
});

async function execute(
  connection: SavedConnection,
  statements: ReturnType<typeof statement>[],
  dryRun: boolean,
  extra: { allowUnchecked?: boolean; stopped?: () => boolean } = {},
) {
  const steps: { status: string; message: string | null }[] = [];
  const summary = await runSyncStatements(
    connection,
    { database: null, schema: "app" },
    statements,
    {
      continueOnError: false,
      dryRun,
      stopped: () => false,
      ...extra,
      onStep: (index, step) => {
        steps[index] = step;
      },
    },
  );
  return { summary, steps: steps.map((step) => step.status), messages: steps };
}

const sent = () =>
  calls.map((call) =>
    call.command === "execute_in_transaction" ||
    call.command === "execute_script" ||
    call.command === "execute_query"
      ? `${call.command}: ${call.args.sql}`
      : call.command,
  );

beforeAll(() => useProvidersStore.setState({ loaded: true }));
afterAll(() => useProvidersStore.setState({ loaded: false }));

beforeEach(() => {
  calls.length = 0;
  cancelled = [];
  version = "PostgreSQL 18.0 on aarch64-apple-darwin";
  handler = (command) => (command === "begin_transaction" ? "tx" : undefined);
  useConnectionsStore.setState({ connections: [PG, ORA] });
});

describe("PostgreSQL-Probelauf", () => {
  test("führt alles in einer Transaktion aus und rollt zurück", async () => {
    const { summary, steps } = await execute(
      PG,
      [
        statement(`ALTER TYPE "app"."s" ADD VALUE 'x'`, PRE_TRANSACTION_PHASE),
        statement(`CREATE TABLE "app"."t" ()`),
        statement(`SELECT setval('"app"."q"', 5)`, 11.1),
        statement(`CREATE VIEW "app"."v" AS SELECT 1`, 17),
      ],
      true,
    );
    expect(sent()).toEqual([
      "execute_query: SELECT version()",
      "begin_transaction",
      "execute_in_transaction: SET LOCAL check_function_bodies = false",
      "execute_in_transaction: SET LOCAL lock_timeout = '10s'",
      `execute_in_transaction: ALTER TYPE "app"."s" ADD VALUE 'x'`,
      `execute_in_transaction: CREATE TABLE "app"."t" ()`,
      `execute_in_transaction: CREATE VIEW "app"."v" AS SELECT 1`,
      "rollback_transaction",
    ]);
    expect(steps).toEqual(["ok", "ok", "warning", "ok"]);
    expect(summary).toMatchObject({ dryRun: true, failed: 0, incomplete: false, rolledBack: true });
  });

  test("meldet den ersten Fehler, prüft den Rest nicht und rollt zurück", async () => {
    handler = (command, args) => {
      if (command === "begin_transaction") return "tx";
      if (String(args.sql).startsWith("CREATE TABLE")) throw new Error("ERROR: relation exists");
    };
    const { summary, steps, messages } = await execute(
      PG,
      [statement(`CREATE TABLE "app"."t" ()`), statement(`CREATE VIEW "app"."v" AS SELECT 1`)],
      true,
    );
    expect(steps).toEqual(["error", "skipped"]);
    expect(messages[1].message).toBe("Nicht geprüft");
    expect(summary.failed).toBe(1);
    expect(sent().at(-1)).toBe("rollback_transaction");
    expect(sent()).not.toContain("commit_transaction");
  });

  test("endet bei neuen Enum-Werten als unvollständig statt fehlgeschlagen", async () => {
    handler = (command, args) => {
      if (command === "begin_transaction") return "tx";
      if (String(args.sql).includes("DEFAULT 'x'"))
        throw new Error('ERROR: unsafe use of new value "x"\nSQLSTATE 55P04');
    };
    const { summary, steps } = await execute(
      PG,
      [
        statement(`ALTER TYPE "app"."s" ADD VALUE 'x'`, PRE_TRANSACTION_PHASE),
        statement(`ALTER TABLE "app"."t" ALTER COLUMN "c" SET DEFAULT 'x'`, 13),
        statement(`CREATE VIEW "app"."v" AS SELECT 1`, 17),
      ],
      true,
    );
    expect(steps).toEqual(["ok", "warning", "skipped"]);
    expect(summary).toMatchObject({ failed: 0, incomplete: true });
  });

  test("meldet ein fehlgeschlagenes Zurückrollen deutlich", async () => {
    handler = (command) => {
      if (command === "begin_transaction") return "tx";
      if (command === "rollback_transaction") throw new Error("connection lost");
    };
    await expect(execute(PG, [statement(`CREATE TABLE "app"."t" ()`)], true)).rejects.toThrow(
      "Der Probelauf konnte nicht zurückgerollt werden: connection lost",
    );
  });

  test("echte Ausführung schreibt Enum-Werte vorab fest und committet", async () => {
    handler = (command) => {
      if (command === "begin_transaction") return "tx";
      if (command === "execute_script") return [{ statement: "", success: true, error: null }];
    };
    const { summary } = await execute(
      PG,
      [
        statement(`ALTER TYPE "app"."s" ADD VALUE 'x'`, PRE_TRANSACTION_PHASE),
        statement(`CREATE TABLE "app"."t" ()`),
      ],
      false,
    );
    expect(sent()).toEqual([
      `execute_script: ALTER TYPE "app"."s" ADD VALUE 'x'`,
      "begin_transaction",
      "execute_in_transaction: SET LOCAL check_function_bodies = false",
      `execute_in_transaction: CREATE TABLE "app"."t" ()`,
      "commit_transaction",
    ]);
    expect(summary).toMatchObject({ dryRun: false, failed: 0 });
  });

  test("verweigert den Probelauf auf Datenbanken ohne DDL-Rollback", async () => {
    for (const other of [
      "PostgreSQL 11.2-YB-2.20.1.0-b0 on x86_64-pc-linux-gnu",
      "CockroachDB CCL v23.2.1 (aarch64-apple-darwin21.2, built 2024/01/16)",
      "PostgreSQL 8.0.2 on i686-pc-linux-gnu, compiled by GCC gcc (GCC) 3.4.2, Redshift 1.0.62",
      "PostgreSQL 12.3, compiled by Visual C++ build 1914, 64-bit, QuestDB",
    ]) {
      calls.length = 0;
      version = other;
      await expect(execute(PG, [statement(`DROP TABLE "app"."t"`)], true)).rejects.toThrow(
        "Probelauf nicht möglich",
      );
      expect(sent()).toEqual(["execute_query: SELECT version()"]);
      expect(await supportsDdlRollback(PG, null)).toBe(false);
    }
    version = "PostgreSQL 16.4 (Greenplum Database 7.1.0 build commit:abc)";
    expect(await supportsDdlRollback(PG, null)).toBe(true);
    expect(await supportsDdlRollback(ORA, null)).toBe(false);
  });

  test("Anhalten bricht ab, rollt zurück und meldet keinen Fehler", async () => {
    let stopped = false;
    handler = (command, args) => {
      if (command === "begin_transaction") return "tx";
      if (String(args.sql).startsWith("CREATE TABLE")) {
        stopped = true;
        throw new Error("ERROR: canceling statement due to user request");
      }
    };
    const { summary, steps, messages } = await execute(
      PG,
      [
        statement(`CREATE SEQUENCE "app"."q"`, 11),
        statement(`CREATE TABLE "app"."t" ()`),
        statement(`CREATE VIEW "app"."v" AS SELECT 1`, 17),
      ],
      true,
      { stopped: () => stopped },
    );
    expect(steps).toEqual(["ok", "skipped", "skipped"]);
    expect(messages[1].message).toBe("Angehalten");
    expect(summary).toMatchObject({ failed: 0, incomplete: true });
    expect(sent().at(-1)).toBe("rollback_transaction");
  });

  test("lehnt schreibgeschützte Verbindungen ab", async () => {
    await expect(
      execute({ ...PG, readOnly: true }, [statement(`CREATE TABLE "app"."t" ()`)], true),
    ).rejects.toThrow("schreibgeschützt");
    expect(calls).toEqual([]);
  });
});

describe("Oracle-Datenprüfung", () => {
  const checked = statement(`ALTER TABLE "APP"."T" ADD CONSTRAINT "C" CHECK (A > 0)`, 14, [
    { sql: `SELECT COUNT(*) FROM "APP"."T" WHERE NOT (A > 0)`, message: "Prüfbedingung verletzt" },
  ]);
  const plain = statement(`CREATE TABLE "APP"."N" ("A" NUMBER)`);

  test("Prüflauf liest nur und ändert nichts", async () => {
    handler = (command) =>
      command === "execute_query" ? { columns: ["C"], rows: [{ C: 3 }] } : undefined;
    const { summary, steps, messages } = await execute(ORA, [plain, checked], true);
    expect(sent()).toEqual([`execute_query: SELECT COUNT(*) FROM "APP"."T" WHERE NOT (A > 0)`]);
    expect(steps).toEqual(["skipped", "error"]);
    expect(messages[1].message).toBe(
      "Datenprüfung: Prüfbedingung verletzt (3 Zeilen). Die Anweisung würde fehlschlagen.",
    );
    expect(summary).toMatchObject({ dryRun: true, failed: 1, checked: 1, blocked: false });
  });

  test("echte Ausführung wird bei Datenkonflikten nicht gestartet", async () => {
    handler = (command) =>
      command === "execute_query" ? { columns: ["C"], rows: [{ C: "1" }] } : undefined;
    const { summary, messages } = await execute(ORA, [plain, checked], false);
    expect(messages[1].message).toContain("Prüfbedingung verletzt (1 Zeile)");
    expect(sent().some((line) => line.startsWith("execute_script"))).toBe(false);
    expect(summary).toMatchObject({ blocked: true, failed: 1 });
  });

  test("führt ohne Konflikte alle Anweisungen aus", async () => {
    handler = (command) => {
      if (command === "execute_query") return { columns: ["C"], rows: [{ C: 0 }] };
      if (command === "execute_script") return [{ statement: "", success: true, error: null }];
    };
    const { summary, steps } = await execute(ORA, [plain, checked], false);
    expect(sent()).toEqual([
      `execute_query: SELECT COUNT(*) FROM "APP"."T" WHERE NOT (A > 0)`,
      `execute_script: CREATE TABLE "APP"."N" ("A" NUMBER)`,
      `execute_script: ALTER TABLE "APP"."T" ADD CONSTRAINT "C" CHECK (A > 0)`,
    ]);
    expect(steps).toEqual(["ok", "ok"]);
    expect(summary).toMatchObject({ blocked: false, failed: 0, warnings: 0 });
  });

  describe("wenn eine Prüfabfrage nicht laufen kann", () => {
    beforeEach(() => {
      handler = (command) => {
        if (command === "execute_query") throw new Error("ORA-00942: table or view does not exist");
        if (command === "execute_script") return [{ statement: "", success: true, error: null }];
      };
    });

    test("meldet der Prüflauf das statt ohne Befund", async () => {
      const { summary, steps, messages } = await execute(ORA, [checked], true);
      expect(steps).toEqual(["warning"]);
      expect(messages[0].message).toContain("Datenprüfung nicht möglich: ORA-00942");
      expect(summary).toMatchObject({ failed: 0, unchecked: 1, incomplete: true });
    });

    test("blockiert die Ausführung ohne Bestätigung", async () => {
      const { summary } = await execute(ORA, [plain, checked], false);
      expect(summary).toMatchObject({ blocked: true, failed: 0, unchecked: 1 });
      expect(sent().some((line) => line.startsWith("execute_script"))).toBe(false);
    });

    test("führt nach Bestätigung aus", async () => {
      const { summary, steps } = await execute(ORA, [plain, checked], false, {
        allowUnchecked: true,
      });
      expect(summary).toMatchObject({ blocked: false, failed: 0, incomplete: false });
      expect(steps).toEqual(["ok", "ok"]);
      expect(sent().filter((line) => line.startsWith("execute_script"))).toHaveLength(2);
    });
  });
});

describe("Einrichtung", () => {
  test("wählt ein einzelnes oder gleichnamiges Schema automatisch", () => {
    expect(pickSchema(["public"], null, null)).toBe("public");
    expect(pickSchema(["a", "b"], null, null)).toBeNull();
    expect(pickSchema(["a", "b"], null, "b")).toBe("b");
    expect(pickSchema(["a", "b"], "a", "b")).toBe("a");
    expect(pickSchema(["a", "b"], "weg", null)).toBeNull();
    expect(pickSchema(["x"], "weg", null)).toBe("x");
    expect(pickSchema([], null, "b")).toBeNull();
  });

  test("erklärt, was für den Vergleich noch fehlt", () => {
    const side = (connectionId: string | null, schema: string | null, database = "app") => ({
      connectionId,
      database,
      schema,
    });
    const types = ["table" as const];
    expect(setupProblem(side(null, null), side(null, null), types)).toBe(
      "Quelle: Verbindung wählen.",
    );
    expect(setupProblem(side("pg", null), side(null, null), types)).toBe("Quelle: Schema wählen.");
    expect(setupProblem(side("pg", "a"), side(null, null), types)).toBe("Ziel: Verbindung wählen.");
    expect(setupProblem(side("pg", "a"), side("pg", null), types)).toBe("Ziel: Schema wählen.");
    expect(setupProblem(side("pg", "a"), side("ora", "A", ""), types)).toContain(
      "dieselbe Datenbankart",
    );
    expect(setupProblem(side("pg", "a"), side("pg", "a"), types)).toContain("identisch");
    expect(setupProblem(side("pg", "a"), side("pg", "a", "other"), types)).toBeNull();
    expect(setupProblem(side("pg", "a"), side("pg", "b"), [])).toBe(
      "Mindestens einen Objekttyp wählen.",
    );
    expect(setupProblem(side("gone", "a"), side("pg", "b"), types)).toBe(
      "Quelle: Verbindung wählen.",
    );
  });
});

describe("Richtung umkehren", () => {
  const table = (schema: string, name: string): CatalogObject => ({
    object_type: "table",
    name,
    parent: null,
    ddl: `CREATE TABLE "${schema}"."${name}" ()`,
    attributes: {},
  });

  beforeEach(() => {
    handler = (command, args) => {
      if (command === "schema_catalog")
        return args.schema === "a" ? [table("a", "nur_a")] : [table("b", "nur_b")];
    };
    useSchemaCompareStore.setState({
      source: { connectionId: "pg", database: "app", schema: "a" },
      target: { connectionId: "pg", database: "app", schema: "b" },
      types: ["table"],
      result: null,
      error: null,
      loading: null,
    });
  });

  test("tauscht Quelle und Ziel und vergleicht neu", async () => {
    await runSchemaCompare();
    const forward = useSchemaCompareStore.getState();
    expect(forward.result?.targetSchema).toBe("b");
    expect(Object.keys(forward.selection)).toEqual(["table||nur_a"]);

    await reverseSchemaCompare();
    const state = useSchemaCompareStore.getState();
    expect(state.source.schema).toBe("b");
    expect(state.target.schema).toBe("a");
    expect(state.result?.sourceSchema).toBe("b");
    expect(state.result?.targetSchema).toBe("a");
    expect(state.result?.target.schema).toBe("a");
    expect(state.result?.items.map((item) => [item.name, item.status])).toEqual([
      ["nur_a", "only_target"],
      ["nur_b", "only_source"],
    ]);
    expect(Object.keys(state.selection)).toEqual(["table||nur_b"]);
  });

  test("kehrt die angezeigten Seiten um, auch wenn die Einstellungen inzwischen geändert wurden", async () => {
    await runSchemaCompare();
    useSchemaCompareStore.setState({
      source: { connectionId: "pg", database: "app", schema: "anders" },
    });
    await reverseSchemaCompare();
    const state = useSchemaCompareStore.getState();
    expect(state.result?.source.schema).toBe("b");
    expect(state.result?.target.schema).toBe("a");
    expect(
      calls.filter((call) => call.command === "schema_catalog").map((call) => call.args.schema),
    ).not.toContain("anders");
  });

  test("lässt Quelle, Ziel und Ergebnis unverändert, wenn der neue Vergleich scheitert", async () => {
    await runSchemaCompare();
    const before = useSchemaCompareStore.getState().result;
    handler = (command) => {
      if (command === "schema_catalog") throw new Error("Verbindung verloren");
    };
    await reverseSchemaCompare();
    const state = useSchemaCompareStore.getState();
    expect(state.error).toBe("Verbindung verloren");
    expect(state.source.schema).toBe("a");
    expect(state.target.schema).toBe("b");
    expect(state.result).toBe(before);
  });
});
