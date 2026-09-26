import { describe, expect, test } from "bun:test";

import type { CatalogObject } from "../src/lib/db";
import { nativeScript } from "../src/lib/transfer/native-script";

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
});
