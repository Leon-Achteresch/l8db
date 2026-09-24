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
  test("Oracle-Views mit vollständigem CREATE-Skript behalten Spaltenliste und Optionen", () => {
    const view = {
      ...side,
      schema: "DEV_ACHTERESCH",
      objectName: "V_PCD",
      objectType: "view" as const,
    };
    const script = (schema: string, divisor: number) =>
      `CREATE OR REPLACE FORCE VIEW "${schema}"."V_PCD"\n(\n  "LAGER",\n  "MANDANT",\n  "SUM_GEWICHT"\n)\nBEQUEATH DEFINER\nAS\nSELECT l.name,\n         m.name,\n         a.sum_gewicht / ${divisor}\n    FROM auftrag a, lager l, mandant m;`;
    expect(
      buildCompareApplyPlan(
        "oracle",
        view,
        script("DEV_ACHTERESCH", 1000),
        script("DEV_QUELLE", 100),
      ),
    ).toEqual([
      `CREATE OR REPLACE FORCE VIEW "DEV_ACHTERESCH"."V_PCD"\n(\n  "LAGER",\n  "MANDANT",\n  "SUM_GEWICHT"\n)\nBEQUEATH DEFINER\nAS\nSELECT l.name,\n         m.name,\n         a.sum_gewicht / 100\n    FROM auftrag a, lager l, mandant m`,
    ]);
    expect(
      buildCompareApplyPlan("oracle", view, "", "create view other.x as select 1 from dual"),
    ).toEqual(['CREATE OR REPLACE VIEW "DEV_ACHTERESCH"."V_PCD" as select 1 from dual']);
    expect(() =>
      buildCompareApplyPlan(
        "oracle",
        view,
        "",
        `${script("DEV_QUELLE", 100)}\nDROP TABLE auftrag;`,
      ),
    ).toThrow();
  });
  test("Oracle-Tabellen: MODIFY vor ADD vor DROP, System-Constraints werden ignoriert", () => {
    const table = { ...side, schema: "DEV", objectName: "ABRECHNUNG_LOCK" };
    const definition = (schema: string, pk: string, columns: string[], checks: string[]) =>
      [
        `TABLE ${schema}.ABRECHNUNG_LOCK`,
        "COLUMNS",
        ...columns,
        "CONSTRAINTS",
        ...checks,
        `${pk} PRIMARY KEY (REF) PRIMARY KEY (REF)`,
        "INDEXES",
        `  CREATE UNIQUE INDEX "${pk}" ON "${schema}"."ABRECHNUNG_LOCK" ("REF")`,
      ].join("\n");
    const before = definition(
      "DEV",
      "SYS_C0013",
      ["  REF NUMBER(10,0) NOT NULL PRIMARY KEY", "  NAME VARCHAR2(40) NULL", "  ALT DATE NULL"],
      ['SYS_C0012 CHECK (REF) CHECK ("REF" IS NOT NULL)'],
    );
    const after = definition(
      "DEV_QUELLE",
      "SYS_C0097",
      [
        "  REF NUMBER(10,0) NOT NULL PRIMARY KEY",
        "  NAME VARCHAR2(80) NOT NULL DEFAULT 'x'",
        "  NEU NUMBER NOT NULL DEFAULT 0",
      ],
      [
        'SYS_C0099 CHECK (NAME) CHECK ("NAME" IS NOT NULL)',
        'SYS_C0098 CHECK (REF) CHECK ("REF" IS NOT NULL)',
      ],
    );
    expect(buildCompareApplyPlan("oracle", table, before, after)).toEqual([
      `ALTER TABLE "DEV"."ABRECHNUNG_LOCK" MODIFY ("NAME" VARCHAR2(80) DEFAULT 'x' NOT NULL)`,
      'ALTER TABLE "DEV"."ABRECHNUNG_LOCK" ADD ("NEU" NUMBER DEFAULT 0 NOT NULL)',
      'ALTER TABLE "DEV"."ABRECHNUNG_LOCK" DROP ("ALT")',
    ]);
    expect(() =>
      buildCompareApplyPlan(
        "oracle",
        table,
        before,
        before.replace("SYS_C0013 PRIMARY KEY", "UQ_LOCK UNIQUE"),
      ),
    ).toThrow("Constraints");
  });
});
