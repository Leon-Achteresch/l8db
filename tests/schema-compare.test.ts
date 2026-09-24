import { describe, expect, test } from "bun:test";

import type { CatalogObject } from "../src/lib/db";
import { compareCatalogs, defaultSelection, requalify } from "../src/lib/schema-compare/diff";
import { addColumnCheck, columnChecks, keyCheck } from "../src/lib/schema-compare/precheck";
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
    target: { connectionId: null, database: null, schema: targetSchema },
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

  test("keeps data literals and settings but rewrites sql and regclass literals", () => {
    const pg = (sql: string) => requalify(sql, "app", "app_test", "postgres");
    expect(pg("SELECT current_setting('app.tenant_id') FROM app.t")).toBe(
      "SELECT current_setting('app.tenant_id') FROM app_test.t",
    );
    expect(pg("DEFAULT 'https://app.example.com'")).toBe("DEFAULT 'https://app.example.com'");
    expect(pg(" SET app.tenant_id TO '1'")).toBe(" SET app.tenant_id TO '1'");
    expect(pg("nextval('app.seq'::regclass)")).toBe("nextval('app_test.seq'::regclass)");
    expect(pg("EXECUTE 'SELECT 1 FROM app.t'")).toBe("EXECUTE 'SELECT 1 FROM app_test.t'");
    expect(pg("-- don't\nSELECT 'it''s' FROM app.t")).toBe(
      "-- don't\nSELECT 'it''s' FROM app_test.t",
    );
    expect(
      requalify("EXECUTE IMMEDIATE q'[DROP TABLE APP.T -- it's]'", "APP", "APP2", "oracle"),
    ).toBe("EXECUTE IMMEDIATE q'[DROP TABLE APP2.T -- it's]'");
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

  test("orders types, routines, unique indexes and drops by dependency", () => {
    const source = [
      object("table", "a", `CREATE TABLE "s"."a" (\n  "code" text\n)`),
      object("column", "code", `"code" text`, "a", { type: "text", nullable: "YES" }),
      object(
        "index",
        "a_code_key",
        "CREATE UNIQUE INDEX a_code_key ON s.a USING btree (code)",
        "a",
      ),
      object("table", "b", `CREATE TABLE "s"."b" (\n  "code" text\n)`),
      object(
        "constraint",
        "b_fk",
        `ALTER TABLE "s"."b" ADD CONSTRAINT "b_fk" FOREIGN KEY (code) REFERENCES s.a(code)`,
        "b",
        { kind: "R", definition: "FOREIGN KEY (code) REFERENCES s.a(code)" },
      ),
      object(
        "function",
        "all_a()",
        "CREATE OR REPLACE FUNCTION s.all_a()\n RETURNS SETOF s.a\n LANGUAGE sql\nAS $function$ SELECT * FROM s.a $function$",
        null,
        { routine: "all_a", arguments: "" },
      ),
      object("type", "a_dom", `CREATE DOMAIN "s"."a_dom" AS s.z_kind`, null, { kind: "domain" }),
      object("type", "z_kind", `CREATE TYPE "s"."z_kind" AS ENUM ('x')`, null, { kind: "enum" }),
    ];
    const created = result("postgres", source, [], "s", "s");
    const sqls = buildSyncScript(created, defaultSelection(created.items)).statements.map(
      (statement) => statement.sql,
    );
    const at = (prefix: string) => sqls.findIndex((sql) => sql.startsWith(prefix));
    expect(at(`CREATE TYPE "s"."z_kind"`)).toBeLessThan(at(`CREATE DOMAIN "s"."a_dom"`));
    expect(at(`CREATE TABLE "s"."a"`)).toBeLessThan(at("CREATE OR REPLACE FUNCTION"));
    expect(at("CREATE UNIQUE INDEX")).toBeLessThan(at(`ALTER TABLE "s"."b"`));
    expect(Math.min(...["CREATE TYPE", "CREATE TABLE", "CREATE OR"].map(at))).toBeGreaterThan(-1);

    const target = [
      object("table", "t", `CREATE TABLE "s"."t" ("old" text)`),
      object("column", "old", `"old" text`, "t", { type: "text", nullable: "YES" }),
      object("comment", "t.old", `COMMENT ON COLUMN "s"."t"."old" IS 'x'`, "t"),
      object("table", "m", `CREATE TABLE "s"."m" ("d" date) PARTITION BY RANGE (d)`),
      object("table", "m_2024", `CREATE TABLE "s"."m_2024" PARTITION OF s.m`, null, {
        partition_of: "s.m",
      }),
    ];
    const dropped = result("postgres", [object("table", "t", "")], target, "s", "s");
    const selection = Object.fromEntries(
      dropped.items.filter((item) => item.name !== "m_2024").map((item) => [item.key, true]),
    );
    const script = buildSyncScript(dropped, selection);
    expect(script.statements.map((statement) => statement.sql)).toEqual([
      `COMMENT ON COLUMN "s"."t"."old" IS NULL`,
      `ALTER TABLE "s"."t" DROP COLUMN "old"`,
      `DROP TABLE "s"."m"`,
    ]);
    expect(script.warnings.some((warning) => warning.includes("m_2024"))).toBe(true);
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

describe("routinen über Schemagrenzen", () => {
  test("ordnet Funktionen mit schemaqualifizierten Parametertypen zu", () => {
    const routine = (schema: string, body: string) =>
      object(
        "function",
        `label(c ${schema}.customer)`,
        `CREATE OR REPLACE FUNCTION ${schema}.label(c ${schema}.customer)\n RETURNS text\nAS $$ ${body} $$`,
        null,
        { routine: "label", arguments: `c ${schema}.customer` },
      );
    const compared = result("postgres", [routine("a", "x")], [routine("b", "x")], "a", "b");
    expect(compared.items.map((item) => [item.name, item.status])).toEqual([
      ["label(c b.customer)", "identical"],
    ]);
    const changed = result("postgres", [routine("a", "x")], [routine("b", "y")], "a", "b");
    expect(changed.items.map((item) => item.status)).toEqual(["different"]);
  });
});

describe("berechnete Spalten", () => {
  const table = (schema: string, type: string, generated: boolean) => [
    object("table", "t", `CREATE TABLE "${schema}"."t" ()`),
    object("column", "code", `"code" ${type}`, "t", { type, nullable: "YES" }),
    ...(generated
      ? [
          object("column", "len", `"len" integer GENERATED ALWAYS AS (length(code)) STORED`, "t", {
            type: "integer",
            nullable: "YES",
            generated: "length(code)",
          }),
        ]
      : []),
  ];

  test("ändert keinen Datentyp, auf dem eine berechnete Spalte aufbaut", () => {
    const compared = result(
      "postgres",
      table("a", "text", true),
      table("b", "varchar(20)", true),
      "a",
      "b",
    );
    const script = buildSyncScript(compared, defaultSelection(compared.items));
    expect(script.statements.some((statement) => statement.sql.includes("TYPE text"))).toBe(false);
    expect(script.warnings.join("\n")).toContain("berechnete Spalte len");
  });

  test("ändert den Datentyp, wenn die berechnete Spalte vorher gelöscht wird", () => {
    const compared = result(
      "postgres",
      table("a", "text", false),
      table("b", "varchar(20)", true),
      "a",
      "b",
    );
    const selection = Object.fromEntries(compared.items.map((item) => [item.key, true]));
    const script = buildSyncScript(compared, selection);
    expect(script.statements.map((statement) => statement.sql)).toEqual([
      `ALTER TABLE "b"."t" DROP COLUMN "len"`,
      `ALTER TABLE "b"."t" ALTER COLUMN "code" TYPE text USING "code"::text`,
    ]);
    expect(script.warnings).toEqual([]);
  });

  test("erkennt Oracle-Ausdrücke mit Anführungszeichen", () => {
    const side = (schema: string, size: number) => [
      object("table", "T", `CREATE TABLE "${schema}"."T" ()`),
      object("column", "NAME", `"NAME" VARCHAR2(${size} CHAR)`, "T", {
        type: `VARCHAR2(${size} CHAR)`,
        nullable: "YES",
      }),
      object(
        "column",
        "UP",
        `"UP" VARCHAR2(400 CHAR) GENERATED ALWAYS AS (UPPER("NAME")) VIRTUAL`,
        "T",
        {
          type: "VARCHAR2(400 CHAR)",
          nullable: "YES",
          virtual: `UPPER("NAME")`,
        },
      ),
    ];
    const compared = result("oracle", side("A", 100), side("B", 80), "A", "B");
    const script = buildSyncScript(compared, defaultSelection(compared.items));
    expect(script.statements).toEqual([]);
    expect(script.warnings.join("\n")).toContain("berechnete Spalte UP");
  });
});

describe("Oracle-Datenprüfung", () => {
  test("erzeugt Prüfabfragen für Schlüssel, Fremdschlüssel und Prüfbedingungen", () => {
    const exists = (name: string) => name !== `"S"."NEU"`;
    expect(keyCheck(`PRIMARY KEY ("ID", "NR")`, `"S"."T"`, exists)?.sql).toBe(
      `SELECT (SELECT COUNT(*) FROM "S"."T" WHERE "ID" IS NULL OR "NR" IS NULL) + (SELECT NVL(SUM(n), 0) FROM (SELECT COUNT(*) n FROM "S"."T" WHERE "ID" IS NOT NULL OR "NR" IS NOT NULL GROUP BY "ID", "NR" HAVING COUNT(*) > 1)) FROM dual`,
    );
    expect(keyCheck(`UNIQUE ON "S"."T" ("A" DESC)`, `"S"."T"`, exists)?.sql).toBe(
      `SELECT NVL(SUM(n), 0) FROM (SELECT COUNT(*) n FROM "S"."T" WHERE "A" IS NOT NULL GROUP BY "A" HAVING COUNT(*) > 1)`,
    );
    expect(
      keyCheck(`FOREIGN KEY ("P") REFERENCES "S"."P" ("ID") ON DELETE CASCADE`, `"S"."T"`, exists)
        ?.sql,
    ).toBe(
      `SELECT COUNT(*) FROM "S"."T" c WHERE c."P" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "S"."P" p WHERE p."ID" = c."P")`,
    );
    expect(keyCheck(`FOREIGN KEY ("P") REFERENCES "S"."NEU" ("ID")`, `"S"."T"`, exists)?.sql).toBe(
      `SELECT COUNT(*) FROM "S"."T" c WHERE c."P" IS NOT NULL`,
    );
    expect(
      keyCheck(
        `CHECK (AMOUNT >= 0 AND (X IN (1, 2))) DEFERRABLE INITIALLY DEFERRED`,
        `"S"."T"`,
        exists,
      )?.sql,
    ).toBe(`SELECT COUNT(*) FROM "S"."T" WHERE NOT (AMOUNT >= 0 AND (X IN (1, 2)))`);
    expect(keyCheck(`CHECK (A > 0) DISABLE`, `"S"."T"`, exists)).toBeNull();
    expect(keyCheck(`UNIQUE ("A") ENABLE NOVALIDATE`, `"S"."T"`, exists)).toBeNull();
    expect(keyCheck(`UNIQUE ON "S"."T" (UPPER("A"))`, `"S"."T"`, exists)).toBeNull();
    expect(keyCheck(`ON "S"."T" ("A")`, `"S"."T"`, exists)).toBeNull();
  });

  test("prüft NOT NULL, kürzere Texte und kleinere Zahlen", () => {
    const column = (type: string, nullable: string) =>
      object("column", "C", `"C" ${type}`, "T", { type, nullable });
    const sqls = (from: CatalogObject, to: CatalogObject, typeChanged = true) =>
      columnChecks(to, from, `"S"."T"`, typeChanged).map((check) => check.sql);
    expect(sqls(column("NUMBER", "YES"), column("NUMBER", "NO"), false)).toEqual([
      `SELECT COUNT(*) FROM "S"."T" WHERE "C" IS NULL`,
    ]);
    expect(sqls(column("VARCHAR2(40 CHAR)", "YES"), column("VARCHAR2(20 CHAR)", "YES"))).toEqual([
      `SELECT COUNT(*) FROM "S"."T" WHERE LENGTH("C") > 20`,
    ]);
    expect(sqls(column("VARCHAR2(40 BYTE)", "YES"), column("VARCHAR2(20 BYTE)", "YES"))).toEqual([
      `SELECT COUNT(*) FROM "S"."T" WHERE LENGTHB("C") > 20`,
    ]);
    expect(sqls(column("NUMBER(12,4)", "YES"), column("NUMBER(10,2)", "YES"))).toEqual([
      `SELECT COUNT(*) FROM "S"."T" WHERE "C" IS NOT NULL`,
    ]);
    expect(sqls(column("NUMBER", "YES"), column("NUMBER(10)", "YES"))).toHaveLength(1);
    expect(sqls(column("NUMBER(10)", "YES"), column("NUMBER(12,2)", "YES"))).toEqual([]);
    expect(sqls(column("DATE", "YES"), column("TIMESTAMP(6)", "YES"))).toEqual([]);
    expect(addColumnCheck(column("NUMBER", "NO"), `"S"."T"`)?.sql).toBe(
      `SELECT COUNT(*) FROM "S"."T"`,
    );
    expect(
      addColumnCheck(
        object("column", "C", "", "T", { type: "NUMBER", nullable: "NO", default: "0" }),
        `"S"."T"`,
      ),
    ).toBeNull();
  });

  test("hängt Prüfungen nur bei Oracle an bestehende Tabellen", () => {
    const side = (schema: string, withCheck: boolean) => [
      object("table", "T", `CREATE TABLE "${schema}"."T" ("A" NUMBER)`),
      object("column", "A", `"A" NUMBER`, "T", { type: "NUMBER", nullable: "YES" }),
      ...(withCheck
        ? [
            object(
              "constraint",
              "T_CK",
              `ALTER TABLE "${schema}"."T" ADD CONSTRAINT "T_CK" CHECK (A > 0)`,
              "T",
              {
                kind: "C",
                definition: "CHECK (A > 0)",
              },
            ),
            object("table", "N", `CREATE TABLE "${schema}"."N" ("A" NUMBER)`),
            object(
              "constraint",
              "N_CK",
              `ALTER TABLE "${schema}"."N" ADD CONSTRAINT "N_CK" CHECK (A > 0)`,
              "N",
              {
                kind: "C",
                definition: "CHECK (A > 0)",
              },
            ),
          ]
        : []),
    ];
    const oracle = result("oracle", side("A", true), side("B", false), "A", "B");
    const script = buildSyncScript(oracle, defaultSelection(oracle.items));
    const checked = script.statements.filter((statement) => statement.checks?.length);
    expect(checked.map((statement) => statement.sql)).toEqual([
      `ALTER TABLE "B"."T" ADD CONSTRAINT "T_CK" CHECK (A > 0)`,
    ]);
    const postgres = result("postgres", side("a", true), side("b", false), "a", "b");
    expect(
      buildSyncScript(postgres, defaultSelection(postgres.items)).statements.some(
        (statement) => statement.checks,
      ),
    ).toBe(false);
  });
});
