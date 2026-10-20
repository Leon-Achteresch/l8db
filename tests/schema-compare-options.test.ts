import { describe, expect, test } from "bun:test";

import type { CatalogObject } from "../src/lib/db";
import { compareCatalogs } from "../src/lib/schema-compare/diff";
import { DEFAULT_COMPARE_OPTIONS } from "../src/lib/schema-compare/types";

describe("Optionen für Default und Constraint-Namen", () => {
  const column = (fallback?: string): CatalogObject => ({
    object_type: "column",
    name: "A",
    parent: "T",
    ddl: `"A" NUMBER`,
    attributes: { type: "NUMBER", nullable: "YES", ...(fallback ? { default: fallback } : {}) },
  });
  const check = (name: string): CatalogObject => ({
    object_type: "constraint",
    name,
    parent: "T",
    ddl: `ALTER TABLE "APP"."T" ADD CONSTRAINT "${name}" CHECK (A > 0)`,
    attributes: { kind: "C", definition: "CHECK (A > 0)" },
  });
  const statuses = (source: CatalogObject[], target: CatalogObject[], options = {}) =>
    compareCatalogs(source, target, {
      kind: "oracle",
      sourceSchema: "APP",
      targetSchema: "APP",
      options: { ...DEFAULT_COMPARE_OPTIONS, ...options },
    }).map((item) => [item.name, item.status]);

  test("behandelt DEFAULT NULL wie keinen Default", () => {
    expect(statuses([column("NULL ")], [column()])).toEqual([["A", "different"]]);
    expect(statuses([column("NULL ")], [column()], { ignoreDefaultNull: true })).toEqual([
      ["A", "identical"],
    ]);
    expect(statuses([column("0")], [column()], { ignoreDefaultNull: true })).toEqual([
      ["A", "different"],
    ]);
  });

  test("ordnet Constraints auf Wunsch nur über die Definition zu", () => {
    expect(statuses([check("CK_NEU")], [check("CK_ALT")])).toEqual([
      ["CK_ALT", "only_target"],
      ["CK_NEU", "only_source"],
    ]);
    expect(statuses([check("CK_NEU")], [check("CK_ALT")], { ignoreConstraintNames: true })).toEqual(
      [["CK_NEU", "identical"]],
    );
  });
});

describe("benannte Unterschiede", () => {
  const table = (columns: string[], tablespace?: string): CatalogObject[] => [
    {
      object_type: "table",
      name: "T",
      parent: null,
      ddl: `CREATE TABLE "APP"."T" (${columns.join(", ")})`,
      attributes: tablespace ? { tablespace } : {},
    },
    ...columns.map((name) => ({
      object_type: "column" as const,
      name,
      parent: "T",
      ddl: `"${name}" NUMBER`,
      attributes: { type: "NUMBER", nullable: "YES" },
    })),
  ];
  const index = (tablespace: string): CatalogObject => ({
    object_type: "index",
    name: "T_I",
    parent: "T",
    ddl: `CREATE INDEX "APP"."T_I" ON "APP"."T" ("A")`,
    attributes: { definition: `ON "APP"."T" ("A")`, tablespace },
  });
  const reasons = (source: CatalogObject[], target: CatalogObject[], options = {}) =>
    compareCatalogs(source, target, {
      kind: "oracle",
      sourceSchema: "APP",
      targetSchema: "APP",
      options: { ...DEFAULT_COMPARE_OPTIONS, ...options },
    })
      .filter((item) => item.status !== "identical")
      .map((item) => [item.type, item.name, item.differsBy]);

  test("meldet eine abweichende Spaltenreihenfolge nur auf Wunsch", () => {
    const source = table(["A", "B", "C"]);
    const target = table(["B", "A", "D"]);
    expect(reasons(source, target).map(([type]) => type)).toEqual(["column", "column"]);
    expect(reasons(source, target, { ignoreColumnOrder: false })[0]).toEqual([
      "table",
      "T",
      ["Spaltenreihenfolge"],
    ]);
    expect(
      reasons(table(["A", "X", "B"]), table(["A", "B"]), { ignoreColumnOrder: false })[0],
    ).toEqual(["column", "X", []]);
  });

  test("meldet Tablespaces von Tabellen und Indizes nur auf Wunsch", () => {
    const source = [...table(["A"], "DATA"), index("IDX")];
    const target = [...table(["A"], "USERS"), index("USERS")];
    expect(reasons(source, target)).toEqual([]);
    expect(reasons(source, target, { ignoreTablespace: false })).toEqual([
      ["table", "T", ["Tablespace"]],
      ["index", "T_I", ["Tablespace"]],
    ]);
  });
});
