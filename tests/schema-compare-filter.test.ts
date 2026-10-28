import { describe, expect, test } from "bun:test";

import type { CatalogObject } from "../src/lib/db";
import {
  compareCatalogs,
  defaultSelection,
  excludePattern,
  limitDifferences,
} from "../src/lib/schema-compare/diff";
import { buildSyncScript, renderSyncScript } from "../src/lib/schema-compare/script";
import { type CompareResult, DEFAULT_COMPARE_OPTIONS } from "../src/lib/schema-compare/types";

const table = (name: string): CatalogObject[] => [
  {
    object_type: "table",
    name,
    parent: null,
    ddl: `CREATE TABLE "APP"."${name}" ("ID" NUMBER)`,
    attributes: {},
  },
  {
    object_type: "column",
    name: "ID",
    parent: name,
    ddl: `"ID" NUMBER`,
    attributes: { type: "NUMBER", nullable: "YES" },
  },
  {
    object_type: "index",
    name: `${name}_I`,
    parent: name,
    ddl: `CREATE INDEX "APP"."${name}_I" ON "APP"."${name}" ("ID")`,
    attributes: { definition: `ON "APP"."${name}" ("ID")` },
  },
];

const compare = (source: CatalogObject[], options = {}) =>
  compareCatalogs(source, [], {
    kind: "oracle",
    sourceSchema: "APP",
    targetSchema: "APP",
    options: { ...DEFAULT_COMPARE_OPTIONS, ...options },
  });

describe("Ausschlussmuster", () => {
  test("übersetzt LIKE-Muster ohne Groß- und Kleinschreibung", () => {
    const pattern = excludePattern("tmp%, %_BAK;\nX_1") as RegExp;
    expect(pattern.test("TMP_ORDERS")).toBe(true);
    expect(pattern.test("ORDERS_BAK")).toBe(true);
    expect(pattern.test("XY1")).toBe(true);
    expect(pattern.test("ORDERS")).toBe(false);
    expect(pattern.test("A.TMP")).toBe(false);
    expect(excludePattern(" , ")).toBeNull();
    expect((excludePattern("A(B)$") as RegExp).test("A(B)$")).toBe(true);
    const escaped = excludePattern("TMP\\_%") as RegExp;
    expect(escaped.test("TMP_X")).toBe(true);
    expect(escaped.test("TMPAX")).toBe(false);
  });

  test("schließt Objekte samt Kindobjekten aus", () => {
    const items = compare([...table("ORDERS"), ...table("TMP_LOAD")], {
      excludePatterns: "TMP%",
    });
    expect(items.map((item) => item.name)).toEqual(["ORDERS"]);
    expect(items[0].children.map((child) => child.name)).toEqual(["ID", "ORDERS_I"]);
    const own = compare(table("ORDERS"), { excludePatterns: "%_I, ID" });
    expect(own[0].children.map((child) => child.name)).toEqual(["ID", "ORDERS_I"]);
  });
});

describe("Unterschiedslimit", () => {
  test("zeigt nur die ersten Unterschiede und zählt den Rest", () => {
    const items = compare(["A", "B", "C", "D"].flatMap(table));
    expect(limitDifferences(items, 0)).toEqual({ items, omitted: 0 });
    const limited = limitDifferences(items, 3);
    expect(limited.items.map((item) => item.name)).toEqual(["A", "B", "C"]);
    expect(limited.omitted).toBe(1);
  });

  test("erzeugt bei erreichtem Limit kein Skript", () => {
    const limited = limitDifferences(compare(["A", "B"].flatMap(table)), 1);
    const result: CompareResult = {
      kind: "oracle",
      sourceSchema: "APP",
      targetSchema: "APP",
      options: DEFAULT_COMPARE_OPTIONS,
      source: { connectionId: null, database: null, schema: "APP" },
      target: { connectionId: null, database: null, schema: "APP" },
      sourceLabel: "Quelle",
      targetLabel: "Ziel",
      types: ["table", "index"],
      items: limited.items,
      comparedAt: "",
      omitted: limited.omitted,
    };
    const script = buildSyncScript(result, defaultSelection(result.items));
    expect(script.statements).toEqual([]);
    expect(script.warnings[0]).toContain("Limit erreicht: 1 weitere Unterschiede");
    expect(
      renderSyncScript(script, { kind: "oracle", sourceLabel: "Q", targetLabel: "Z" }),
    ).toContain("-- Hinweis: Limit erreicht");
  });
});

describe("SQLite-Neuaufbau mit Filter", () => {
  test("kopiert auch Spalten zurück, deren Name einem Ausschlussmuster entspricht", () => {
    const sqliteTable = (type: string): CatalogObject[] => [
      {
        object_type: "table",
        name: "T",
        parent: null,
        ddl: `CREATE TABLE "main"."T" ("id" ${type}, "x_bak" TEXT)`,
        attributes: {},
      },
      ...[
        ["id", type],
        ["x_bak", "TEXT"],
      ].map(([name, columnType]) => ({
        object_type: "column" as const,
        name,
        parent: "T",
        ddl: `"${name}" ${columnType}`,
        attributes: { type: columnType, nullable: "YES" },
      })),
    ];
    const context = {
      kind: "sqlite" as const,
      sourceSchema: "main",
      targetSchema: "main",
      options: { ...DEFAULT_COMPARE_OPTIONS, excludePatterns: "%_BAK" },
    };
    const items = compareCatalogs(sqliteTable("INTEGER"), sqliteTable("TEXT"), context);
    const result: CompareResult = {
      ...context,
      source: { connectionId: null, database: null, schema: "main" },
      target: { connectionId: null, database: null, schema: "main" },
      sourceLabel: "Quelle",
      targetLabel: "Ziel",
      types: ["table"],
      items,
      comparedAt: "",
    };
    const sql = buildSyncScript(result, defaultSelection(items)).statements.map(
      (statement) => statement.sql,
    );
    expect(sql).toContain(
      `CREATE TABLE "main"."_l8db_copy_T" AS SELECT "id", "x_bak" FROM "main"."T"`,
    );
  });
});
