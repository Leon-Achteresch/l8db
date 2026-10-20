import { describe, expect, test } from "bun:test";

import type { CatalogObject } from "../src/lib/db";
import { compareCatalogs } from "../src/lib/schema-compare/diff";
import { buildSyncScript } from "../src/lib/schema-compare/script";
import {
  type CompareResult,
  DEFAULT_COMPARE_OPTIONS,
  type SelectableType,
} from "../src/lib/schema-compare/types";

function view(name: string, sql: string, deps?: string[]): CatalogObject {
  return {
    object_type: "view",
    name,
    parent: null,
    ddl: `CREATE OR REPLACE VIEW "APP"."${name}" AS ${sql}`,
    attributes: {},
    ...(deps ? { depends_on: deps } : {}),
  };
}

function result(
  kind: "oracle" | "postgres",
  source: CatalogObject[],
  target: CatalogObject[],
): CompareResult {
  const context = {
    kind,
    sourceSchema: "APP",
    targetSchema: "APP",
    options: DEFAULT_COMPARE_OPTIONS,
  };
  return {
    ...context,
    source: { connectionId: null, database: null, schema: "APP" },
    target: { connectionId: null, database: null, schema: "APP" },
    sourceLabel: "Quelle",
    targetLabel: "Ziel",
    types: ["view"] as SelectableType[],
    items: compareCatalogs(source, target, context),
    comparedAt: "",
  };
}

function script(compare: CompareResult) {
  return buildSyncScript(
    compare,
    Object.fromEntries(compare.items.map((item) => [item.key, item.status !== "identical"])),
  );
}

const created = (sql: string[]) =>
  sql.map((statement) => /VIEW "APP"\."(\w+)"/.exec(statement)?.[1] ?? statement);

describe("Abhängigkeitsgraph aus dem Katalog", () => {
  test("legt Views mit unqualifizierten Verweisen in Abhängigkeitsreihenfolge an", () => {
    const compare = result(
      "oracle",
      [
        view("A_TOP", "SELECT * FROM M_MID", ["M_MID"]),
        view("M_MID", "SELECT * FROM Z_BASE", ["Z_BASE"]),
        view("Z_BASE", "SELECT 1 x FROM dual", []),
      ],
      [],
    );
    const { statements, warnings } = script(compare);
    expect(created(statements.map((statement) => statement.sql))).toEqual([
      "Z_BASE",
      "M_MID",
      "A_TOP",
    ]);
    expect(warnings).toEqual([]);
  });

  test("löscht abhängige Views vor ihren Grundlagen", () => {
    const compare = result(
      "oracle",
      [],
      [
        view("A_BASE", "SELECT 1 x FROM dual", []),
        view("Z_TOP", "SELECT * FROM A_BASE", ["A_BASE"]),
      ],
    );
    expect(script(compare).statements.map((statement) => statement.sql)).toEqual([
      `DROP VIEW "APP"."Z_TOP"`,
      `DROP VIEW "APP"."A_BASE"`,
    ]);
  });

  test("gibt Zyklen mit Warnung aus und verliert keine Anweisung", () => {
    const compare = result(
      "oracle",
      [
        view("C_FREE", "SELECT 1 x FROM dual", []),
        view("A_ONE", "SELECT * FROM B_TWO", ["B_TWO"]),
        view("B_TWO", "SELECT * FROM A_ONE", ["A_ONE"]),
      ],
      [],
    );
    const { statements, warnings } = script(compare);
    expect(created(statements.map((statement) => statement.sql))).toEqual([
      "C_FREE",
      "A_ONE",
      "B_TWO",
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Zyklische Abhängigkeit zwischen A_ONE, B_TWO");
  });

  test("nutzt ohne Kataloginformation weiter schemaqualifizierte Verweise", () => {
    const compare = result(
      "oracle",
      [view("A_TOP", `SELECT * FROM "APP"."Z_BASE"`), view("Z_BASE", "SELECT 1 x FROM dual")],
      [],
    );
    expect(created(script(compare).statements.map((statement) => statement.sql))).toEqual([
      "Z_BASE",
      "A_TOP",
    ]);
  });

  test("ignoriert Namen in Kommentaren und Literalen, wenn der Katalog Abhängigkeiten kennt", () => {
    const compare = result(
      "oracle",
      [
        view("A_TOP", "SELECT 'x.Z_BASE' t FROM dual -- .Z_BASE", []),
        view("Z_BASE", "SELECT * FROM APP.A_TOP", ["A_TOP"]),
      ],
      [],
    );
    const { statements, warnings } = script(compare);
    expect(created(statements.map((statement) => statement.sql))).toEqual(["A_TOP", "Z_BASE"]);
    expect(warnings).toEqual([]);
  });

  test("baut Postgres-Views nach Katalogabhängigkeit neu auf, auch ohne Schemapräfix", () => {
    const table = (type: string): CatalogObject[] => [
      {
        object_type: "table",
        name: "t",
        parent: null,
        ddl: `CREATE TABLE "APP"."t" (a ${type})`,
        attributes: {},
      },
      {
        object_type: "column",
        name: "a",
        parent: "t",
        ddl: `"a" ${type}`,
        attributes: { type, nullable: "YES" },
      },
    ];
    const v = (deps: string[]): CatalogObject => ({
      object_type: "view",
      name: "v",
      parent: null,
      ddl: `CREATE OR REPLACE VIEW "APP"."v" AS\n SELECT a FROM t`,
      attributes: {},
      depends_on: deps,
    });
    const compare = result(
      "postgres",
      [...table("bigint"), v(["t"])],
      [...table("integer"), v(["t"])],
    );
    compare.types = ["table", "view"];
    const sql = script(compare).statements.map((statement) => statement.sql);
    expect(sql[0]).toBe(`DROP VIEW "APP"."v"`);
    expect(sql).toContain(`CREATE OR REPLACE VIEW "APP"."v" AS\n SELECT a FROM t`);
  });

  test("ordnet Postgres-Routinen nach Katalogabhängigkeit hinter neue Tabellen", () => {
    const compare = result(
      "postgres",
      [
        {
          object_type: "function",
          name: "f()",
          parent: null,
          ddl: `CREATE OR REPLACE FUNCTION "APP".f()\n RETURNS SETOF t\nAS $$ SELECT * FROM t $$`,
          attributes: { routine: "f", arguments: "" },
          depends_on: ["t"],
        },
        {
          object_type: "table",
          name: "t",
          parent: null,
          ddl: `CREATE TABLE "APP"."t" (a int)`,
          attributes: {},
        },
      ],
      [],
    );
    const statements = script(compare).statements;
    const table = statements.findIndex((statement) => statement.sql.startsWith("CREATE TABLE"));
    const routine = statements.findIndex((statement) => statement.sql.includes("FUNCTION"));
    expect(table).toBeGreaterThanOrEqual(0);
    expect(routine).toBeGreaterThan(table);
  });
});
