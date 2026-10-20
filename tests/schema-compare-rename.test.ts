import { describe, expect, test } from "bun:test";

import type { CatalogObject, DatabaseKind } from "../src/lib/db";
import { compareCatalogs, renameCandidates } from "../src/lib/schema-compare/diff";
import { buildSyncScript } from "../src/lib/schema-compare/script";
import { toggleRename, useSchemaCompareStore } from "../src/lib/schema-compare/store";
import { type CompareResult, DEFAULT_COMPARE_OPTIONS } from "../src/lib/schema-compare/types";

function table(kind: DatabaseKind, columns: [string, string, string?][]): CatalogObject[] {
  const quote = (name: string) =>
    kind === "mysql" ? `\`${name}\`` : kind === "mssql" ? `[${name}]` : `"${name}"`;
  return [
    {
      object_type: "table",
      name: "T",
      parent: null,
      ddl: `CREATE TABLE ${quote("app")}.${quote("T")} (${columns.map(([name, type]) => `${quote(name)} ${type}`).join(", ")})`,
      attributes: {},
    },
    ...columns.map(([name, type, nullable]) => ({
      object_type: "column" as const,
      name,
      parent: "T",
      ddl: `${quote(name)} ${type}${nullable === "NO" ? " NOT NULL" : ""}`,
      attributes: { type, nullable: nullable ?? "YES" },
    })),
  ];
}

function result(
  kind: DatabaseKind,
  source: CatalogObject[],
  target: CatalogObject[],
): CompareResult {
  const context = {
    kind,
    sourceSchema: "app",
    targetSchema: "app",
    options: DEFAULT_COMPARE_OPTIONS,
  };
  return {
    ...context,
    source: { connectionId: null, database: null, schema: "app" },
    target: { connectionId: null, database: null, schema: "app" },
    sourceLabel: "Quelle",
    targetLabel: "Ziel",
    types: ["table"],
    items: compareCatalogs(source, target, context),
    comparedAt: "",
  };
}

function sql(kind: DatabaseKind, renamed: boolean, nullable = "YES") {
  const compare = result(
    kind,
    table(kind, [
      ["id", "integer"],
      ["full_name", "varchar(80)", nullable],
    ]),
    table(kind, [
      ["id", "integer"],
      ["name", "varchar(80)"],
    ]),
  );
  const added = compare.items.find((item) => item.name === "full_name");
  const dropped = compare.items.find((item) => item.name === "name");
  const renames: Record<string, string> =
    renamed && added && dropped ? { [added.key]: dropped.key } : {};
  const selected = Object.fromEntries(compare.items.map((item) => [item.key, true]));
  return buildSyncScript(compare, selected, renames).statements.map((statement) => statement.sql);
}

describe("Spalten umbenennen statt löschen und anlegen", () => {
  test("bietet nur Spalten derselben Tabelle mit gleichem Datentyp an", () => {
    const compare = result(
      "postgres",
      table("postgres", [
        ["full_name", "varchar(80)"],
        ["age", "integer"],
      ]),
      table("postgres", [
        ["name", "varchar(80)"],
        ["born", "date"],
      ]),
    );
    const item = compare.items.find((entry) => entry.name === "full_name");
    expect(renameCandidates(compare.items, item as never).map((entry) => entry.name)).toEqual([
      "name",
    ]);
    const age = compare.items.find((entry) => entry.name === "age");
    expect(renameCandidates(compare.items, age as never)).toEqual([]);
  });

  test("löscht und legt an, solange niemand umbenennen wählt", () => {
    expect(sql("postgres", false)).toEqual([
      `ALTER TABLE "app"."T" DROP COLUMN "name"`,
      `ALTER TABLE "app"."T" ADD COLUMN "full_name" varchar(80)`,
    ]);
  });

  test("benennt je Dialekt um und passt weitere Attribute danach an", () => {
    expect(sql("postgres", true, "NO")).toEqual([
      `ALTER TABLE "app"."T" RENAME COLUMN "name" TO "full_name"`,
      `ALTER TABLE "app"."T" ALTER COLUMN "full_name" SET NOT NULL`,
    ]);
    expect(sql("oracle", true)).toEqual([
      `ALTER TABLE "app"."T" RENAME COLUMN "name" TO "full_name"`,
    ]);
    expect(sql("mysql", true)).toEqual([
      "ALTER TABLE `app`.`T` RENAME COLUMN `name` TO `full_name`",
    ]);
    expect(sql("mssql", true)).toEqual([
      "EXEC sp_rename N'[app].[T].[name]', N'full_name', N'COLUMN'",
    ]);
    expect(sql("sqlite", true).filter((statement) => !statement.startsWith("PRAGMA"))).toEqual([
      `ALTER TABLE "app"."T" RENAME COLUMN "name" TO "full_name"`,
    ]);
  });

  test("übernimmt die Daten beim SQLite-Neuaufbau unter dem neuen Namen", () => {
    const statements = sql("sqlite", true, "NO");
    expect(statements).toContain(
      `CREATE TABLE "app"."_l8db_copy_T" AS SELECT "id", "name" FROM "app"."T"`,
    );
    expect(statements).toContain(
      `INSERT OR ROLLBACK INTO "app"."T" ("id", "full_name") SELECT "id", "name" FROM "app"."_l8db_copy_T"`,
    );
    expect(statements.some((statement) => statement.includes("RENAME COLUMN"))).toBe(false);
  });

  test("merkt sich pro Paar genau eine Umbenennung", () => {
    useSchemaCompareStore.setState({ renames: {}, selection: {} });
    toggleRename("a", "x", true);
    toggleRename("b", "x", true);
    expect(useSchemaCompareStore.getState().renames).toEqual({ b: "x" });
    expect(useSchemaCompareStore.getState().selection).toEqual({ a: true, x: true, b: true });
    toggleRename("b", "x", false);
    expect(useSchemaCompareStore.getState().renames).toEqual({});
  });
});
