import { describe, expect, test } from "bun:test";

import type { CatalogObject } from "../src/lib/db";
import { compareCatalogs, defaultSelection, requalify } from "../src/lib/schema-compare/diff";
import { buildSyncScript, renderSyncScript } from "../src/lib/schema-compare/script";
import {
  type CompareResult,
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
  kind: "oracle" | "postgres",
  source: CatalogObject[],
  target: CatalogObject[],
  sourceSchema: string,
  targetSchema: string,
): CompareResult {
  const context = { kind, sourceSchema, targetSchema, options: DEFAULT_COMPARE_OPTIONS };
  return {
    ...context,
    sourceLabel: sourceSchema,
    targetLabel: targetSchema,
    types: [] as SelectableType[],
    items: compareCatalogs(source, target, context),
    comparedAt: "",
  };
}

describe("requalify", () => {
  test("rewrites quoted and bare schema qualifiers only", () => {
    const sql = `SELECT a.id FROM "APP".kunde k JOIN app.auftrag a ON a.k = k.id WHERE mapp.x = 1 AND "app".y = 2`;
    const out = requalify(sql, "APP", "APP_TEST", "oracle");
    expect(out).toContain(`"APP_TEST".kunde`);
    expect(out).toContain("APP_TEST.auftrag");
    expect(out).toContain("mapp.x");
    expect(out).toContain(`"app".y`);
    expect(requalify(sql, "APP", "APP", "oracle")).toBe(sql);
  });

  test("quotes targets that are not plain identifiers", () => {
    expect(requalify("select public.f()", "public", "Kunde A", "postgres")).toBe(
      `select "Kunde A".f()`,
    );
  });
});

describe("compareCatalogs", () => {
  const source = [
    object("table", "KUNDE", `CREATE TABLE "SRC"."KUNDE"\n(\n  "ID" NUMBER NOT NULL\n)`),
    object("column", "ID", `"ID" NUMBER NOT NULL`, "KUNDE", { type: "NUMBER", nullable: "NO" }),
    object("column", "NAME", `"NAME" VARCHAR2(50 CHAR)`, "KUNDE", {
      type: "VARCHAR2(50 CHAR)",
      nullable: "YES",
    }),
    object("table", "NEU", `CREATE TABLE "SRC"."NEU"\n(\n  "ID" NUMBER\n)`),
    object("column", "ID", `"ID" NUMBER`, "NEU", { type: "NUMBER", nullable: "YES" }),
    object("constraint", "SYS_C001", `ALTER TABLE "SRC"."NEU" ADD PRIMARY KEY ("ID")`, "NEU", {
      kind: "P",
      definition: `PRIMARY KEY ("ID")`,
      generated: "YES",
    }),
    object("constraint", "SYS_C002", `ALTER TABLE "SRC"."KUNDE" ADD PRIMARY KEY ("ID")`, "KUNDE", {
      kind: "P",
      definition: `PRIMARY KEY ("ID")`,
      generated: "YES",
    }),
    object(
      "constraint",
      "FK_NEU",
      `ALTER TABLE "SRC"."NEU" ADD CONSTRAINT "FK_NEU" FOREIGN KEY ("ID") REFERENCES "SRC"."KUNDE" ("ID")`,
      "NEU",
      { kind: "R", definition: `FOREIGN KEY ("ID") REFERENCES "SRC"."KUNDE" ("ID")` },
    ),
    object("sequence", "SEQ_A", "CREATE SEQUENCE ...", null, {
      increment: "1",
      current: "500",
      cache: "CACHE 20",
    }),
    object(
      "view",
      "V_KUNDE",
      `CREATE OR REPLACE FORCE VIEW "SRC"."V_KUNDE" AS SELECT id FROM src.kunde;`,
    ),
    object(
      "package_body",
      "PKG",
      `CREATE OR REPLACE PACKAGE BODY "SRC"."PKG" AS\nBEGIN\n  NULL;\nEND;`,
    ),
  ];
  const target = [
    object("table", "KUNDE", `CREATE TABLE "DST"."KUNDE"\n(\n  "ID" NUMBER NOT NULL\n)`),
    object("column", "ID", `"ID" NUMBER NOT NULL`, "KUNDE", { type: "NUMBER", nullable: "NO" }),
    object("column", "NAME", `"NAME" VARCHAR2(20 CHAR)`, "KUNDE", {
      type: "VARCHAR2(20 CHAR)",
      nullable: "NO",
    }),
    object("column", "ALT", `"ALT" DATE`, "KUNDE", { type: "DATE", nullable: "YES" }),
    object("constraint", "SYS_C999", `ALTER TABLE "DST"."KUNDE" ADD PRIMARY KEY ("ID")`, "KUNDE", {
      kind: "P",
      definition: `PRIMARY KEY ("ID")`,
      generated: "YES",
    }),
    object("sequence", "SEQ_A", "CREATE SEQUENCE ...", null, {
      increment: "1",
      current: "7",
      cache: "CACHE 20",
    }),
    object(
      "view",
      "V_KUNDE",
      `CREATE OR REPLACE FORCE VIEW "DST"."V_KUNDE" AS\nSELECT id   FROM dst.kunde`,
    ),
    object("view", "V_ALT", `CREATE OR REPLACE FORCE VIEW "DST"."V_ALT" AS SELECT 1 FROM dual`),
    object(
      "package_body",
      "PKG",
      `CREATE OR REPLACE PACKAGE BODY "DST"."PKG" AS\nBEGIN\n  RETURN;\nEND;`,
    ),
  ];
  const compared = result("oracle", source, target, "SRC", "DST");
  const find = (type: string, name: string) =>
    compared.items.find((item) => item.type === type && item.name === name);

  test("classifies objects across schemas", () => {
    expect(find("view", "V_KUNDE")?.status).toBe("identical");
    expect(find("view", "V_ALT")?.status).toBe("only_target");
    expect(find("package_body", "PKG")?.status).toBe("different");
    expect(find("column", "ALT")?.status).toBe("only_target");
    expect(find("column", "NAME")?.differsBy).toEqual(["Datentyp", "Nullable"]);
    expect(find("sequence", "SEQ_A")?.status).toBe("identical");
  });

  test("matches system generated constraint names by definition", () => {
    const pk = compared.items.filter(
      (item) => item.type === "constraint" && item.parent === "KUNDE",
    );
    expect(pk).toHaveLength(1);
    expect(pk[0].status).toBe("identical");
  });

  test("nests children of tables that exist only in the source", () => {
    const created = find("table", "NEU");
    expect(created?.status).toBe("only_source");
    expect(created?.children.map((child) => child.name).sort()).toEqual([
      "FK_NEU",
      "ID",
      "SYS_C001",
    ]);
    expect(compared.items.some((item) => item.parent === "NEU")).toBe(false);
  });

  test("builds an ordered oracle sync script", () => {
    const selection = defaultSelection(compared.items);
    expect(selection[find("view", "V_ALT")?.key ?? ""]).toBeUndefined();
    selection[find("view", "V_ALT")?.key ?? ""] = true;
    selection[find("column", "ALT")?.key ?? ""] = true;
    const script = buildSyncScript(compared, selection);
    const sql = script.statements.map((statement) => statement.sql);
    expect(sql).toEqual([
      `DROP VIEW "DST"."V_ALT"`,
      `ALTER TABLE "DST"."KUNDE" DROP COLUMN "ALT"`,
      `CREATE TABLE "DST"."NEU"\n(\n  "ID" NUMBER\n)`,
      `ALTER TABLE "DST"."KUNDE" MODIFY ("NAME" VARCHAR2(50 CHAR) NULL)`,
      `ALTER TABLE "DST"."NEU" ADD PRIMARY KEY ("ID")`,
      `ALTER TABLE "DST"."NEU" ADD CONSTRAINT "FK_NEU" FOREIGN KEY ("ID") REFERENCES "DST"."KUNDE" ("ID")`,
      `CREATE OR REPLACE PACKAGE BODY "DST"."PKG" AS\nBEGIN\n  NULL;\nEND;`,
    ]);
    expect(script.statements.filter((statement) => statement.dangerous)).toHaveLength(3);
    const text = renderSyncScript(script, {
      kind: "oracle",
      sourceLabel: "SRC",
      targetLabel: "DST",
    });
    expect(text).toContain("END;\n/");
    expect(text).toContain(`DROP VIEW "DST"."V_ALT";`);
  });

  test("does not ignore sequence values when asked", () => {
    const context = {
      kind: "oracle" as const,
      sourceSchema: "SRC",
      targetSchema: "DST",
      options: { ...DEFAULT_COMPARE_OPTIONS, ignoreSequenceValues: false },
    };
    const items = compareCatalogs(source, target, context);
    const sequence = items.find((item) => item.type === "sequence");
    expect(sequence?.differsBy).toEqual(["Aktueller Wert"]);
    const script = buildSyncScript(
      { ...compared, ...context, items },
      { [sequence?.key ?? ""]: true },
    );
    expect(script.statements.map((statement) => statement.sql)).toEqual([
      `ALTER SEQUENCE "DST"."SEQ_A" RESTART START WITH 500`,
    ]);
  });
});

describe("postgres sync script", () => {
  test("handles enums, routines, dependent views and transactions", () => {
    const source = [
      object("type", "status", `CREATE TYPE "app"."status" AS ENUM ('neu', 'aktiv', 'alt')`, null, {
        kind: "enum",
        labels: JSON.stringify(["neu", "aktiv", "alt"]),
      }),
      object("view", "v_b", `CREATE OR REPLACE VIEW "app"."v_b" AS\nSELECT * FROM app.v_a`),
      object("view", "v_a", `CREATE OR REPLACE VIEW "app"."v_a" AS\nSELECT 1 AS x`),
    ];
    const target = [
      object("type", "status", `CREATE TYPE "test"."status" AS ENUM ('neu', 'alt')`, null, {
        kind: "enum",
        labels: JSON.stringify(["neu", "alt"]),
      }),
      object("function", "f(integer)", "CREATE OR REPLACE FUNCTION test.f(integer)", null, {
        routine: "f",
        arguments: "integer",
      }),
    ];
    const compared = result("postgres", source, target, "app", "test");
    const selection = Object.fromEntries(compared.items.map((item) => [item.key, true]));
    const script = buildSyncScript(compared, selection);
    expect(script.statements.map((statement) => statement.sql)).toEqual([
      `ALTER TYPE "test"."status" ADD VALUE 'aktiv' AFTER 'neu'`,
      `DROP FUNCTION "test"."f"(integer)`,
      `CREATE OR REPLACE VIEW "test"."v_a" AS\nSELECT 1 AS x`,
      `CREATE OR REPLACE VIEW "test"."v_b" AS\nSELECT * FROM test.v_a`,
    ]);
    const text = renderSyncScript(script, { kind: "postgres", sourceLabel: "a", targetLabel: "b" });
    expect(text.startsWith("-- Schema-Synchronisation")).toBe(true);
    expect(text).toContain("BEGIN;\nSET LOCAL check_function_bodies = false;");
    expect(text.indexOf("ADD VALUE")).toBeLessThan(text.indexOf("BEGIN;"));
    expect(text.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  test("rebuilds dependent views around column type changes", () => {
    const side = (schema: string, type: string) => [
      object("table", "t", `CREATE TABLE "${schema}"."t" ("c" ${type})`),
      object("column", "c", `"c" ${type}`, "t", { type, nullable: "YES" }),
      object("view", "v1", `CREATE OR REPLACE VIEW "${schema}"."v1" AS\nSELECT c FROM ${schema}.t`),
      object(
        "view",
        "v2",
        `CREATE OR REPLACE VIEW "${schema}"."v2" AS\nSELECT c FROM ${schema}.v1`,
      ),
      object("grant", "SELECT TO r", `GRANT SELECT ON TABLE "${schema}"."v1" TO "r"`, "v1"),
    ];
    const compared = result(
      "postgres",
      side("app", "bigint"),
      side("test", "integer"),
      "app",
      "test",
    );
    const script = buildSyncScript(compared, defaultSelection(compared.items));
    expect(script.statements.map((statement) => statement.sql)).toEqual([
      `DROP VIEW "test"."v2"`,
      `DROP VIEW "test"."v1"`,
      `ALTER TABLE "test"."t" ALTER COLUMN "c" TYPE bigint USING "c"::bigint`,
      `CREATE OR REPLACE VIEW "test"."v1" AS\nSELECT c FROM test.t`,
      `CREATE OR REPLACE VIEW "test"."v2" AS\nSELECT c FROM test.v1`,
      `GRANT SELECT ON TABLE "test"."v1" TO "r"`,
    ]);
  });
});
