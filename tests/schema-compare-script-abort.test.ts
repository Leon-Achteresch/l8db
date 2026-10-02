import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import type { CatalogObject, DatabaseKind } from "../src/lib/db";
import { compareCatalogs } from "../src/lib/schema-compare/diff";
import {
  buildSyncScript,
  renderSyncScript,
  type SyncStatement,
} from "../src/lib/schema-compare/script";
import { type CompareResult, DEFAULT_COMPARE_OPTIONS } from "../src/lib/schema-compare/types";

function object(
  object_type: CatalogObject["object_type"],
  name: string,
  ddl: string,
  parent: string | null = null,
  attributes: Record<string, string> = {},
): CatalogObject {
  return { object_type, name, parent, ddl, attributes };
}

function result(kind: DatabaseKind, source: CatalogObject[], target: CatalogObject[]) {
  const context = {
    kind,
    sourceSchema: "app",
    targetSchema: "app",
    options: DEFAULT_COMPARE_OPTIONS,
  };
  const value: CompareResult = {
    ...context,
    source: { connectionId: null, database: null, schema: "app" },
    target: { connectionId: null, database: null, schema: "app" },
    sourceLabel: "app",
    targetLabel: "app",
    types: [],
    items: compareCatalogs(source, target, context),
    comparedAt: "",
  };
  return value;
}

function render(value: CompareResult): string {
  const selected = Object.fromEntries(
    value.items.map((item) => [item.key, item.status !== "identical"]),
  );
  return renderSyncScript(buildSyncScript(value, selected), {
    kind: value.kind,
    sourceLabel: "a",
    targetLabel: "b",
  });
}

function runContinuingOnError(db: Database, script: string): string[] {
  const errors: string[] = [];
  const statements = script
    .split("\n")
    .filter((line) => !line.startsWith("--"))
    .join("\n")
    .split(/;\n/)
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) {
    try {
      db.run(statement);
    } catch (error) {
      errors.push(String(error));
    }
  }
  return errors;
}

const column = (table: string, name: string, ddl: string, attributes: Record<string, string>) =>
  object("column", name, ddl, table, attributes);

function rebuildTable(table: string): [CatalogObject[], CatalogObject[]] {
  return [
    [
      object(
        "table",
        table,
        `CREATE TABLE "app"."${table}" (id INTEGER PRIMARY KEY, a TEXT NOT NULL)`,
      ),
      column(table, "id", "id INTEGER PRIMARY KEY", { type: "INTEGER", nullable: "YES" }),
      column(table, "a", "a TEXT NOT NULL", { type: "TEXT", nullable: "NO" }),
    ],
    [
      object("table", table, `CREATE TABLE "app"."${table}" (id INTEGER PRIMARY KEY, a TEXT)`),
      column(table, "id", "id INTEGER PRIMARY KEY", { type: "INTEGER", nullable: "YES" }),
      column(table, "a", "a TEXT", { type: "TEXT", nullable: "YES" }),
    ],
  ];
}

describe("SQLite-Skript bei fortgesetzter Ausführung nach Fehlern", () => {
  test("verliert keine Daten, wenn das Zurückkopieren scheitert", () => {
    const [source, target] = rebuildTable("t");
    const script = render(result("sqlite", source, target));
    const db = new Database(":memory:");
    db.run("ATTACH ':memory:' AS app");
    db.run('CREATE TABLE "app"."t" (id INTEGER PRIMARY KEY, a TEXT)');
    db.run("INSERT INTO app.t VALUES (1, NULL), (2, 'b')");
    const errors = runContinuingOnError(db, script);
    expect(errors.length).toBeGreaterThan(0);
    expect(db.query("SELECT id, a FROM app.t ORDER BY id").all()).toEqual([
      { id: 1, a: null },
      { id: 2, a: "b" },
    ]);
    expect(
      db.query("SELECT name FROM app.sqlite_master WHERE name LIKE '_l8db_copy_%'").all(),
    ).toEqual([]);
  });

  test("übernimmt den Neuaufbau, wenn die Daten passen", () => {
    const [source, target] = rebuildTable("t");
    const script = render(result("sqlite", source, target));
    const db = new Database(":memory:");
    db.run("ATTACH ':memory:' AS app");
    db.run('CREATE TABLE "app"."t" (id INTEGER PRIMARY KEY, a TEXT)');
    db.run("INSERT INTO app.t VALUES (1, 'a'), (2, 'b')");
    expect(runContinuingOnError(db, script)).toEqual([]);
    expect(db.query("SELECT count(*) AS n FROM app.t").get()).toEqual({ n: 2 });
    expect(
      (db.query("SELECT sql FROM app.sqlite_master WHERE name = 't'").get() as { sql: string }).sql,
    ).toContain("NOT NULL");
  });
});

describe("SQL-Server-Skript mit GO-Batches", () => {
  const statement = (sql: string, plsql = false): SyncStatement => ({
    key: sql,
    sql,
    plsql,
    dangerous: false,
    phase: 1,
  });

  test("bricht nach einem fehlgeschlagenen Batch jede weitere Ausführung ab", () => {
    const statements = [
      statement("CREATE TABLE dbo.a (id int)"),
      statement("CREATE PROCEDURE dbo.p AS SELECT 1", true),
    ];
    const text = renderSyncScript(
      { statements, warnings: [] },
      { kind: "mssql", sourceLabel: "a", targetLabel: "b" },
    );
    const batches = text.split(/^GO$/m).map((batch) => batch.trim());
    const guard = (batch: string) =>
      batch.startsWith("IF @@ERROR <> 0 AND @@TRANCOUNT > 0 ROLLBACK TRANSACTION;") &&
      batch.includes("IF @@TRANCOUNT = 0") &&
      batch.includes("SET NOEXEC ON;");
    const statementIndex = batches.indexOf("CREATE TABLE dbo.a (id int);");
    expect(guard(batches[statementIndex + 1])).toBe(true);
    const procedureIndex = batches.indexOf("CREATE PROCEDURE dbo.p AS SELECT 1");
    expect(procedureIndex).toBeGreaterThan(statementIndex);
    expect(guard(batches[procedureIndex + 1])).toBe(true);
    expect(batches[procedureIndex + 2]).toBe("COMMIT TRANSACTION;");
    expect(batches[procedureIndex + 3]).toBe("SET NOEXEC OFF;");
    expect(batches[0]).toContain("SET NOEXEC OFF;\nBEGIN TRANSACTION;");
  });
});
