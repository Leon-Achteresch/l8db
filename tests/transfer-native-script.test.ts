import { describe, expect, test } from "bun:test";

import type { CatalogObject } from "../src/lib/db";
import { nativeScript, selectTables } from "../src/lib/transfer/native-script";

function object(
  object_type: CatalogObject["object_type"],
  name: string,
  ddl: string,
  parent: string | null = null,
  attributes: Record<string, string> = {},
): CatalogObject {
  return { object_type, name, parent, ddl, attributes };
}

describe("nativeScript", () => {
  test("splits postgres structure into pre-data and post-data around the load", () => {
    const script = nativeScript("postgres", "app", "copy", [
      object("sequence", "kunde_seq", "CREATE SEQUENCE app.kunde_seq START WITH 1"),
      object("table", "kunde", `CREATE TABLE app.kunde (\n  id integer NOT NULL\n)`),
      object("column", "id", "id integer NOT NULL", "kunde", { type: "integer", nullable: "NO" }),
      object("table", "auftrag", `CREATE TABLE app.auftrag (\n  id integer, kunde_id integer\n)`),
      object(
        "constraint",
        "kunde_pkey",
        "ALTER TABLE app.kunde ADD CONSTRAINT kunde_pkey PRIMARY KEY (id)",
        "kunde",
        { definition: "PRIMARY KEY (id)" },
      ),
      object(
        "constraint",
        "auftrag_kunde_fk",
        "ALTER TABLE app.auftrag ADD CONSTRAINT auftrag_kunde_fk FOREIGN KEY (kunde_id) REFERENCES app.kunde(id)",
        "auftrag",
        { definition: "FOREIGN KEY (kunde_id) REFERENCES app.kunde(id)", references: "kunde" },
      ),
      object(
        "index",
        "auftrag_kunde_ix",
        "CREATE INDEX auftrag_kunde_ix ON app.auftrag (kunde_id)",
        "auftrag",
      ),
      object("view", "offen", "CREATE OR REPLACE VIEW app.offen AS\nSELECT * FROM app.auftrag"),
    ]);
    const pre = script.preData.map((statement) => statement.sql);
    const post = script.postData.map((statement) => statement.sql);
    expect(pre.some((sql) => sql.startsWith("CREATE SEQUENCE copy.kunde_seq"))).toBe(true);
    expect(pre.some((sql) => sql.startsWith("CREATE TABLE copy.kunde"))).toBe(true);
    expect(pre.some((sql) => /PRIMARY KEY|FOREIGN KEY|CREATE INDEX|VIEW/.test(sql))).toBe(false);
    expect(post.some((sql) => sql.includes("PRIMARY KEY"))).toBe(true);
    expect(post.some((sql) => sql.includes("FOREIGN KEY") && sql.includes("copy.kunde"))).toBe(
      true,
    );
    expect(post.some((sql) => sql.startsWith("CREATE INDEX"))).toBe(true);
    expect(post.some((sql) => sql.includes("VIEW copy.offen"))).toBe(true);
    const table = script.preData.find((statement) =>
      statement.sql.startsWith("CREATE TABLE copy.kunde"),
    );
    expect(table).toMatchObject({ objectType: "table", schema: "copy", name: "kunde" });
    const primary = script.postData.find((statement) => statement.sql.includes("PRIMARY KEY"));
    expect(primary?.objectType).toBeUndefined();
  });

  test("keeps oracle packages after tables and marks spec for compensation only", () => {
    const script = nativeScript("oracle", "APP", "APP2", [
      object("table", "T", `CREATE TABLE "APP"."T"\n(\n  "ID" NUMBER\n)`),
      object("package", "PKG", `CREATE OR REPLACE PACKAGE "APP"."PKG" AS\n  PROCEDURE p;\nEND;`),
      object(
        "package_body",
        "PKG",
        `CREATE OR REPLACE PACKAGE BODY "APP"."PKG" AS\n  PROCEDURE p IS BEGIN NULL; END;\nEND;`,
      ),
    ]);
    const post = script.postData;
    const spec = post.findIndex((statement) => /PACKAGE "APP2"\."PKG"/.test(statement.sql));
    const body = post.findIndex((statement) => /PACKAGE BODY "APP2"\."PKG"/.test(statement.sql));
    expect(spec).toBeGreaterThanOrEqual(0);
    expect(body).toBeGreaterThan(spec);
    expect(post[spec]).toMatchObject({ objectType: "package", name: "PKG", schema: "APP2" });
    expect(post[body].objectType).toBeUndefined();
    expect(script.preData[0]).toMatchObject({ objectType: "table", name: "T" });
  });

  test("keeps only chosen tables with their parts and drops foreign keys to the rest", () => {
    const catalog = [
      object("table", "KUNDE", `CREATE TABLE "APP"."KUNDE" ("ID" NUMBER)`),
      object("table", "AUFTRAG", `CREATE TABLE "APP"."AUFTRAG" ("ID" NUMBER, "KUNDE_ID" NUMBER)`),
      object("table", "LOG", `CREATE TABLE "APP"."LOG" ("ID" NUMBER)`),
      object("column", "ID", "", "KUNDE"),
      object(
        "index",
        "AUFTRAG_IX",
        `CREATE INDEX "APP"."AUFTRAG_IX" ON "APP"."AUFTRAG" ("ID")`,
        "AUFTRAG",
      ),
      object("constraint", "AUFTRAG_FK", "ALTER TABLE ...", "AUFTRAG", { references: "KUNDE" }),
      object("constraint", "LOG_FK", "ALTER TABLE ...", "AUFTRAG", { references: "LOG" }),
      object("constraint", "EXT_FK", "ALTER TABLE ...", "AUFTRAG"),
      object("trigger", "AUFTRAG_TRG", "CREATE TRIGGER ...", "AUFTRAG"),
      object("comment", "LOG", "COMMENT ON TABLE ...", "LOG"),
      object("grant", "SELECT TO X", "GRANT SELECT ...", "KUNDE"),
      object("grant", "SELECT TO Y", "GRANT SELECT ...", "OFFEN"),
      object("view", "OFFEN", "CREATE VIEW ..."),
      object("sequence", "SEQ", "CREATE SEQUENCE ..."),
    ];
    expect(selectTables(catalog, undefined).objects).toBe(catalog);
    const { objects, warnings } = selectTables(catalog, ["AUFTRAG", "KUNDE"]);
    expect(objects.map((entry) => `${entry.object_type}:${entry.name}`)).toEqual([
      "table:KUNDE",
      "table:AUFTRAG",
      "column:ID",
      "index:AUFTRAG_IX",
      "constraint:AUFTRAG_FK",
      "constraint:EXT_FK",
      "trigger:AUFTRAG_TRG",
      "grant:SELECT TO X",
    ]);
    expect(warnings).toEqual([
      "Fremdschlüssel AUFTRAG.LOG_FK entfällt, weil LOG nicht ausgewählt ist.",
    ]);
  });

  test("keeps sequences and object types the chosen tables use", () => {
    const catalog = [
      object("type", "T_ADRESSE", "CREATE TYPE ...", null),
      object("type_body", "T_ADRESSE", "CREATE TYPE BODY ..."),
      object("type", "T_ORT", "CREATE TYPE ..."),
      object("type", "T_UNGENUTZT", "CREATE TYPE ..."),
      object("sequence", "BELEG_SEQ", "CREATE SEQUENCE ..."),
      object("sequence", "LOG_SEQ", "CREATE SEQUENCE ..."),
      object("sequence", "kunde_id_seq", "CREATE SEQUENCE ..."),
      object(
        "table",
        "AUFTRAG",
        `CREATE TABLE "APP"."AUFTRAG" ("ID" NUMBER DEFAULT tr_src.beleg_seq.NEXTVAL)`,
      ),
      object("column", "ADRESSE", `"ADRESSE" "APP"."T_ADRESSE"`, "AUFTRAG", {
        type: `"APP"."T_ADRESSE"`,
      }),
      object(
        "table",
        "kunde",
        "CREATE TABLE app.kunde (id integer DEFAULT nextval('app.kunde_id_seq'::regclass))",
      ),
      object(
        "table",
        "LOG",
        `CREATE TABLE "APP"."LOG" ("ID" NUMBER DEFAULT "APP"."LOG_SEQ"."NEXTVAL")`,
      ),
    ];
    catalog[0].depends_on = ["type:T_ORT"];
    const names = selectTables(catalog, ["AUFTRAG", "kunde"]).objects.map(
      (entry) => `${entry.object_type}:${entry.name}`,
    );
    expect(names).toEqual([
      "type:T_ADRESSE",
      "type_body:T_ADRESSE",
      "type:T_ORT",
      "sequence:BELEG_SEQ",
      "sequence:kunde_id_seq",
      "table:AUFTRAG",
      "column:ADRESSE",
      "table:kunde",
    ]);
  });

  test("keeps routines, packages and sequences the chosen tables call, transitively", () => {
    const catalog = [
      object(
        "function",
        "stempel",
        "CREATE FUNCTION app.stempel() RETURNS trigger AS $$ BEGIN NEW.zeit := app.jetzt(); RETURN NEW; END $$",
      ),
      object(
        "function",
        "jetzt",
        "CREATE FUNCTION app.jetzt() RETURNS timestamptz AS $$ SELECT now() $$",
      ),
      object("function", "fremd", "CREATE FUNCTION app.fremd() RETURNS int AS $$ SELECT 1 $$"),
      object("sequence", "BelegNr", "CREATE SEQUENCE [dbo].[BelegNr]"),
      object("package", "PROTOKOLL", "CREATE PACKAGE PROTOKOLL AS ..."),
      object("package_body", "PROTOKOLL", "CREATE PACKAGE BODY PROTOKOLL AS ..."),
      object("view", "offen", "CREATE VIEW app.offen AS SELECT * FROM app.kunde"),
      object("table", "kunde", "CREATE TABLE app.kunde (id int, zeit timestamptz)"),
      object(
        "trigger",
        "kunde_stempel",
        "CREATE TRIGGER kunde_stempel BEFORE INSERT ON app.kunde FOR EACH ROW EXECUTE FUNCTION stempel()",
        "kunde",
      ),
      object(
        "table",
        "beleg",
        "CREATE TABLE [dbo].[beleg] ([nr] int DEFAULT (NEXT VALUE FOR [dbo].[BelegNr]))",
      ),
      object(
        "trigger",
        "BELEG_LOG",
        "CREATE TRIGGER BELEG_LOG AFTER INSERT ON BELEG BEGIN PROTOKOLL.SCHREIBE; END;",
        "beleg",
      ),
    ];
    const names = selectTables(catalog, ["kunde", "beleg"]).objects.map(
      (entry) => `${entry.object_type}:${entry.name}`,
    );
    expect(names).toEqual([
      "function:stempel",
      "function:jetzt",
      "sequence:BelegNr",
      "package:PROTOKOLL",
      "package_body:PROTOKOLL",
      "table:kunde",
      "trigger:kunde_stempel",
      "table:beleg",
      "trigger:BELEG_LOG",
    ]);
  });
});
