import { describe, expect, test } from "bun:test";

import type { CatalogObject } from "../src/lib/db";
import { compareCatalogs } from "../src/lib/schema-compare/diff";
import { buildSyncScript } from "../src/lib/schema-compare/script";
import {
  type CompareResult,
  compareTypesFor,
  DEFAULT_COMPARE_OPTIONS,
  defaultCompareTypes,
} from "../src/lib/schema-compare/types";

const table: CatalogObject = {
  object_type: "table",
  name: "item",
  parent: null,
  ddl: `CREATE TABLE "app"."item" (\n  "price" integer\n)`,
  attributes: {},
};
const column: CatalogObject = {
  object_type: "column",
  name: "price",
  parent: "item",
  ddl: `"price" integer`,
  attributes: { type: "integer", nullable: "YES" },
};
const rls = (kind: "enable" | "force"): CatalogObject => ({
  object_type: "policy",
  name: kind === "force" ? "FORCE ROW LEVEL SECURITY" : "ROW LEVEL SECURITY",
  parent: "item",
  ddl: `ALTER TABLE "app"."item" ${kind === "force" ? "FORCE" : "ENABLE"} ROW LEVEL SECURITY`,
  attributes: { kind },
});
const policy = (using: string): CatalogObject => ({
  object_type: "policy",
  name: "p_pos",
  parent: "item",
  ddl: `CREATE POLICY p_pos ON "app"."item" AS PERMISSIVE FOR SELECT TO PUBLIC USING (${using})`,
  attributes: {},
});

function sync(source: CatalogObject[], target: CatalogObject[]) {
  const context = {
    kind: "postgres" as const,
    sourceSchema: "app",
    targetSchema: "app",
    options: DEFAULT_COMPARE_OPTIONS,
  };
  const compare: CompareResult = {
    ...context,
    source: { connectionId: null, database: null, schema: "app" },
    target: { connectionId: null, database: null, schema: "app" },
    sourceLabel: "Quelle",
    targetLabel: "Ziel",
    types: ["table", "policy"],
    items: compareCatalogs(source, target, context),
    comparedAt: "",
  };
  const open = compare.items.filter((item) => item.status !== "identical");
  const script = buildSyncScript(
    compare,
    Object.fromEntries(compare.items.map((item) => [item.key, item.status !== "identical"])),
  );
  return { open, sql: script.statements.map((statement) => statement.sql) };
}

describe("Row-Level-Security im Schema-Vergleich", () => {
  test("Postgres vergleicht Policies standardmäßig", () => {
    expect(compareTypesFor("postgres")).toContain("policy");
    expect(defaultCompareTypes("postgres")).toContain("policy");
  });

  test("fehlende RLS und Policy im Ziel sind ein Unterschied und werden angelegt", () => {
    const { open, sql } = sync(
      [table, column, rls("enable"), rls("force"), policy("price > 0")],
      [table, column],
    );
    expect(open.map((item) => item.name).sort()).toEqual([
      "FORCE ROW LEVEL SECURITY",
      "ROW LEVEL SECURITY",
      "p_pos",
    ]);
    expect(sql).toContain(`ALTER TABLE "app"."item" ENABLE ROW LEVEL SECURITY`);
    expect(sql).toContain(`ALTER TABLE "app"."item" FORCE ROW LEVEL SECURITY`);
    expect(sql).toContain(policy("price > 0").ddl);
  });

  test("neue Tabelle bekommt RLS und Policy nach dem CREATE TABLE", () => {
    const { sql } = sync([table, column, rls("enable"), policy("price > 0")], []);
    const create = sql.findIndex((statement) => statement.startsWith("CREATE TABLE"));
    expect(create).toBeGreaterThanOrEqual(0);
    expect(sql.indexOf(policy("price > 0").ddl)).toBeGreaterThan(create);
    expect(sql.indexOf(rls("enable").ddl)).toBeGreaterThan(create);
  });

  test("überzählige RLS und Policy im Ziel werden entfernt, geänderte neu angelegt", () => {
    expect(
      sync([table, column], [table, column, rls("enable"), rls("force"), policy("true")]).sql,
    ).toEqual(
      expect.arrayContaining([
        `DROP POLICY "p_pos" ON "app"."item"`,
        `ALTER TABLE "app"."item" DISABLE ROW LEVEL SECURITY`,
        `ALTER TABLE "app"."item" NO FORCE ROW LEVEL SECURITY`,
      ]),
    );
    const changed = sync([table, column, policy("price > 0")], [table, column, policy("true")]).sql;
    expect(changed.indexOf(`DROP POLICY "p_pos" ON "app"."item"`)).toBeLessThan(
      changed.indexOf(policy("price > 0").ddl),
    );
  });
});
