import { describe, expect, test } from "bun:test";
import { buildCompareApplyPlan } from "../src/lib/compare-apply-plan";
import { EMPTY_COMPARE_SIDE } from "../src/lib/compare-types";

const side = {
  ...EMPTY_COMPARE_SIDE,
  connectionId: "target",
  schema: "destination",
  objectName: "users",
};
const base =
  "TABLE destination.users\nCOLUMNS\n  id integer NOT NULL PRIMARY KEY\n  name text NULL";

describe("Vergleich: geprüfte Änderungsskripte", () => {
  test("erzeugt nur die übernommenen Spaltenänderungen am ausgewählten Ziel", () => {
    expect(
      buildCompareApplyPlan(
        "postgres",
        side,
        base,
        base.replace("name text NULL", "name varchar(80) NOT NULL") +
          "\n  active boolean NULL DEFAULT true",
      ),
    ).toEqual([
      'ALTER TABLE "destination"."users" ALTER COLUMN "name" TYPE varchar(80);',
      'ALTER TABLE "destination"."users" ALTER COLUMN "name" SET NOT NULL;',
      'ALTER TABLE "destination"."users" ADD COLUMN "active" boolean DEFAULT true;',
    ]);
  });
  test("kopierte Quellnamen ändern niemals das SQL-Ziel", () => {
    expect(
      buildCompareApplyPlan(
        "postgres",
        side,
        base,
        base.replace("destination.users", "source.other") + "\n  email text NULL",
      )[0],
    ).toStartWith('ALTER TABLE "destination"."users"');
  });
  test("blockiert zusätzliche SQL-Befehle und nicht abbildbare Strukturänderungen", () => {
    expect(() =>
      buildCompareApplyPlan("postgres", side, base, base + "\n  bad text NULL DEFAULT 1; COMMIT;"),
    ).toThrow();
    expect(() =>
      buildCompareApplyPlan(
        "postgres",
        side,
        base,
        base + "\nINDEXES\n  CREATE INDEX test ON users(id)",
      ),
    ).toThrow("Indizes");
    expect(() =>
      buildCompareApplyPlan("postgres", side, base, base.replace(" PRIMARY KEY", "")),
    ).toThrow("Primärschlüssel");
    expect(() => buildCompareApplyPlan("mysql", side, base, base + "\n  email text NULL")).toThrow(
      "Prüfung",
    );
  });
  test("Views werden im Ziel angelegt und erlauben keine zweite Anweisung", () => {
    const view = { ...side, objectType: "view" as const };
    expect(buildCompareApplyPlan("postgres", view, "SELECT 1", "SELECT 2;")).toEqual([
      'CREATE OR REPLACE VIEW "destination"."users" AS SELECT 2',
    ]);
    expect(() =>
      buildCompareApplyPlan("postgres", view, "SELECT 1", "SELECT 2; COMMIT;"),
    ).toThrow();
  });
  test("Funktionen werden auf den Zielnamen gebunden und behalten ihre Signatur", () => {
    const routine = {
      ...side,
      objectType: "routine" as const,
      objectName: "target_fn(integer)",
      objectOid: "42",
    };
    const before =
      "CREATE OR REPLACE FUNCTION destination.target_fn(value integer) RETURNS integer LANGUAGE sql AS $$ SELECT value $$;";
    const draft =
      "CREATE OR REPLACE FUNCTION source.source_fn(value integer) RETURNS integer LANGUAGE sql AS $$ SELECT value + 1 $$;";
    expect(buildCompareApplyPlan("postgres", routine, before, draft)[0]).toStartWith(
      'CREATE OR REPLACE FUNCTION "destination".target_fn',
    );
    expect(() =>
      buildCompareApplyPlan(
        "postgres",
        routine,
        before,
        draft.replace("value integer", "value text"),
      ),
    ).toThrow("Signatur");
    expect(() => buildCompareApplyPlan("postgres", routine, before, draft + " COMMIT;")).toThrow();
  });
  test("Oracle-Prozeduren und Package-Teile werden vollständig erkannt", () => {
    const procedure = {
      ...side,
      objectType: "procedure" as const,
      objectName: "RUN()",
      objectOid: "RUN",
    };
    const before = "CREATE OR REPLACE PROCEDURE RUN AS BEGIN NULL; END;";
    expect(
      buildCompareApplyPlan("oracle", procedure, before, before.replace("NULL;", "NULL; NULL;"))[0],
    ).toStartWith('CREATE OR REPLACE PROCEDURE "destination".RUN');
    const pkg = { ...side, objectType: "package" as const, objectName: "DEMO" };
    const spec = "CREATE OR REPLACE PACKAGE DEMO AS PROCEDURE RUN; END DEMO;";
    const body =
      "CREATE OR REPLACE PACKAGE BODY DEMO AS PROCEDURE RUN IS BEGIN NULL; END RUN; END DEMO;";
    const definition = `PACKAGE SPEC destination.DEMO\n\n${spec}\n\nPACKAGE BODY destination.DEMO\n\n${body}`;
    expect(buildCompareApplyPlan("oracle", pkg, definition, definition)).toHaveLength(2);
  });
});
