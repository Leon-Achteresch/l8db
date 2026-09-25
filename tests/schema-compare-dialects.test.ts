import { describe, expect, test } from "bun:test";

import type { CatalogObject, DatabaseKind } from "../src/lib/db";
import { compareCatalogs, requalify } from "../src/lib/schema-compare/diff";
import { dryRunKind } from "../src/lib/schema-compare/run";
import { buildSyncScript, renderSyncScript } from "../src/lib/schema-compare/script";
import {
  type CompareResult,
  compareTypesFor,
  DEFAULT_COMPARE_OPTIONS,
  type SelectableType,
} from "../src/lib/schema-compare/types";

function object(
  object_type: CatalogObject["object_type"],
  name: string,
  ddl: string,
  parent: string | null = null,
  attributes: Record<string, string> = {},
): CatalogObject {
  return { object_type, name, parent, ddl, attributes };
}

function result(
  kind: DatabaseKind,
  source: CatalogObject[],
  target: CatalogObject[],
  sourceSchema = "app",
  targetSchema = "app",
): CompareResult {
  const context = { kind, sourceSchema, targetSchema, options: DEFAULT_COMPARE_OPTIONS };
  return {
    ...context,
    source: { connectionId: null, database: null, schema: sourceSchema },
    target: { connectionId: null, database: null, schema: targetSchema },
    sourceLabel: sourceSchema,
    targetLabel: targetSchema,
    types: [] as SelectableType[],
    items: compareCatalogs(source, target, context),
    comparedAt: "",
  };
}

function all(value: CompareResult): Record<string, boolean> {
  return Object.fromEntries(value.items.map((item) => [item.key, item.status !== "identical"]));
}

function sql(value: CompareResult): string[] {
  return buildSyncScript(value, all(value)).statements.map((statement) => statement.sql);
}

describe("Objekttypen und Probelauf je Datenbank", () => {
  test("liefert Objekttypen und Probelauf-Art", () => {
    expect(compareTypesFor("mysql")).toContain("procedure");
    expect(compareTypesFor("mssql")).toContain("trigger");
    expect(compareTypesFor("sqlite")).not.toContain("function");
    expect(dryRunKind("mysql")).toBeNull();
    expect(dryRunKind("mssql")).toBe("rollback");
    expect(dryRunKind("sqlite")).toBe("rollback");
  });

  test("qualifiziert MySQL- und SQL-Server-Namen um", () => {
    expect(requalify("select `sca`.`t`.`id` from `sca`.`t`", "sca", "scb", "mysql")).toBe(
      "select `scb`.`t`.`id` from `scb`.`t`",
    );
    expect(requalify("SELECT * FROM [sca].[t] JOIN sca.u", "sca", "scb", "mssql")).toBe(
      "SELECT * FROM [scb].[t] JOIN scb.u",
    );
  });
});

describe("MySQL", () => {
  const table = (schema: string, columns: string) =>
    object("table", "t", `CREATE TABLE \`${schema}\`.\`t\` (${columns})`);
  test("ändert Spalten per MODIFY und löscht Constraints mit MySQL-Syntax", () => {
    const value = result(
      "mysql",
      [
        table("app", "`id` int NOT NULL, PRIMARY KEY (`id`)"),
        object("column", "name", "`name` varchar(80) NOT NULL DEFAULT 'x'", "t", {
          type: "varchar(80)",
          nullable: "NO",
          default: "'x'",
        }),
        object("index", "t_name", "CREATE INDEX `t_name` ON `app`.`t` (`name`)", "t"),
        object(
          "constraint",
          "t_ref",
          "ALTER TABLE `app`.`t` ADD CONSTRAINT `t_ref` FOREIGN KEY (`name`) REFERENCES `app`.`u` (`n`)",
          "t",
          { kind: "R", definition: "FOREIGN KEY (`name`) REFERENCES `app`.`u` (`n`)" },
        ),
      ],
      [
        table("app", "`id` int NOT NULL, PRIMARY KEY (`id`)"),
        object("column", "name", "`name` varchar(40) NULL", "t", {
          type: "varchar(40)",
          nullable: "YES",
        }),
        object("constraint", "PRIMARY", "ALTER TABLE `app`.`t` ADD PRIMARY KEY (`id`)", "t", {
          kind: "P",
          definition: "PRIMARY KEY (`id`)",
        }),
        object(
          "constraint",
          "t_u",
          "ALTER TABLE `app`.`t` ADD CONSTRAINT `t_u` UNIQUE (`id`)",
          "t",
          { kind: "U", definition: "UNIQUE (`id`)" },
        ),
      ],
    );
    expect(sql(value)).toEqual([
      "ALTER TABLE `app`.`t` DROP PRIMARY KEY",
      "ALTER TABLE `app`.`t` DROP INDEX `t_u`",
      "ALTER TABLE `app`.`t` MODIFY COLUMN `name` varchar(80) NOT NULL DEFAULT 'x'",
      "CREATE INDEX `t_name` ON `app`.`t` (`name`)",
      "ALTER TABLE `app`.`t` ADD CONSTRAINT `t_ref` FOREIGN KEY (`name`) REFERENCES `app`.`u` (`n`)",
    ]);
  });

  test("ersetzt Routinen per DROP und CREATE und rendert DELIMITER", () => {
    const value = result(
      "mysql",
      [object("procedure", "p", "CREATE PROCEDURE `app`.`p`()\nBEGIN SELECT 1; END")],
      [object("procedure", "p", "CREATE PROCEDURE `app`.`p`()\nBEGIN SELECT 2; END")],
    );
    const script = buildSyncScript(value, all(value));
    expect(script.statements.map((statement) => statement.sql)).toEqual([
      "DROP PROCEDURE `app`.`p`",
      "CREATE PROCEDURE `app`.`p`()\nBEGIN SELECT 1; END",
    ]);
    const text = renderSyncScript(script, { kind: "mysql", sourceLabel: "a", targetLabel: "b" });
    expect(text).toContain("DELIMITER $$\nCREATE PROCEDURE `app`.`p`()\nBEGIN SELECT 1; END$$");
    expect(text).not.toContain("BEGIN;");
  });
});

describe("SQL Server", () => {
  test("setzt Defaults über Default-Constraints und baut abhängige Indizes neu auf", () => {
    const value = result(
      "mssql",
      [
        object("column", "code", "[code] varchar(40) NOT NULL DEFAULT 'a'", "t", {
          type: "varchar(40)",
          nullable: "NO",
          default: "'a'",
        }),
        object("index", "t_code", "CREATE NONCLUSTERED INDEX [t_code] ON [app].[t] ([code])", "t"),
      ],
      [
        object("column", "code", "[code] varchar(20) NOT NULL DEFAULT 'b'", "t", {
          type: "varchar(20)",
          nullable: "NO",
          default: "'b'",
        }),
        object("index", "t_code", "CREATE NONCLUSTERED INDEX [t_code] ON [app].[t] ([code])", "t"),
      ],
    );
    const statements = sql(value);
    expect(statements[0]).toBe("DROP INDEX [t_code] ON [app].[t]");
    expect(statements[1]).toStartWith("DECLARE @l8db_default sysname");
    expect(statements.slice(2)).toEqual([
      "ALTER TABLE [app].[t] ALTER COLUMN [code] varchar(40) NOT NULL",
      "ALTER TABLE [app].[t] ADD DEFAULT 'a' FOR [code]",
      "CREATE NONCLUSTERED INDEX [t_code] ON [app].[t] ([code])",
    ]);
  });

  test("rendert GO zwischen Batches in einer Transaktion", () => {
    const value = result(
      "mssql",
      [object("view", "v", "CREATE OR ALTER VIEW [app].[v] AS SELECT 1 AS a")],
      [],
    );
    const text = renderSyncScript(buildSyncScript(value, all(value)), {
      kind: "mssql",
      sourceLabel: "a",
      targetLabel: "b",
    });
    expect(text).toContain("BEGIN TRANSACTION;\nGO");
    expect(text).toContain("CREATE OR ALTER VIEW [app].[v] AS SELECT 1 AS a\nGO");
    expect(text.trimEnd()).toEndWith("COMMIT TRANSACTION;\nGO");
  });
});

describe("SQLite", () => {
  const column = (name: string, ddl: string, attributes: Record<string, string>) =>
    object("column", name, ddl, "t", attributes);
  test("baut Tabellen mit Datenkopie neu auf und legt Indizes wieder an", () => {
    const value = result(
      "sqlite",
      [
        object("table", "t", 'CREATE TABLE "app"."t" (id INTEGER PRIMARY KEY, a INTEGER NOT NULL)'),
        column("id", "id INTEGER PRIMARY KEY", { type: "INTEGER", nullable: "YES" }),
        column("a", "a INTEGER NOT NULL", { type: "INTEGER", nullable: "NO" }),
        object("index", "t_a", 'CREATE INDEX "app"."t_a" ON t (a)', "t"),
      ],
      [
        object("table", "t", 'CREATE TABLE "app"."t" (id INTEGER PRIMARY KEY, a TEXT, b TEXT)'),
        column("id", "id INTEGER PRIMARY KEY", { type: "INTEGER", nullable: "YES" }),
        column("a", "a TEXT", { type: "TEXT", nullable: "YES" }),
        column("b", "b TEXT", { type: "TEXT", nullable: "YES" }),
        object("index", "t_a", 'CREATE INDEX "app"."t_a" ON t (a)', "t"),
      ],
    );
    expect(sql(value)).toEqual([
      "PRAGMA defer_foreign_keys = ON",
      'CREATE TABLE "app"."_l8db_copy_t" AS SELECT "a", "id" FROM "app"."t"',
      'DROP TABLE "app"."t"',
      'CREATE TABLE "app"."t" (id INTEGER PRIMARY KEY, a INTEGER NOT NULL)',
      'INSERT INTO "app"."t" ("a", "id") SELECT "a", "id" FROM "app"."_l8db_copy_t"',
      'DROP TABLE "app"."_l8db_copy_t"',
      'CREATE INDEX "app"."t_a" ON t (a)',
    ]);
  });

  test("hängt einfache Spalten per ALTER TABLE an", () => {
    const value = result(
      "sqlite",
      [
        object("table", "t", 'CREATE TABLE "app"."t" (id INTEGER, b TEXT DEFAULT \'x\')'),
        column("b", "b TEXT DEFAULT 'x'", { type: "TEXT", nullable: "YES", default: "'x'" }),
      ],
      [object("table", "t", 'CREATE TABLE "app"."t" (id INTEGER)')],
    );
    expect(sql(value)).toEqual([
      "PRAGMA defer_foreign_keys = ON",
      `ALTER TABLE "app"."t" ADD COLUMN b TEXT DEFAULT 'x'`,
    ]);
  });
});
