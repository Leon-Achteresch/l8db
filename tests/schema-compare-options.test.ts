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
