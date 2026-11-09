import { describe, expect, mock, test } from "bun:test";
import { buildCompareApplyPlan } from "@/lib/compare-apply-plan";
import {
  EMPTY_COMPARE_SIDE,
  loadCompareDefinition,
  loadPortableDefinition,
} from "@/lib/compare-definition";
import type { CompareObjectType } from "@/lib/compare-types";
import type { SavedConnection } from "@/lib/connections";
import { packageOid } from "@/lib/plsql";

const TABLE = "ARTIKEL_REL_EINLAGERN";

function catalog(schema: string, system: number, extra: boolean) {
  const column = (
    name: string,
    data_type: string,
    is_nullable: boolean,
    fallback: string | null,
  ) => ({
    name,
    data_type,
    is_nullable,
    column_default: fallback,
    is_primary_key: name === "ID",
    character_maximum_length: null,
    comment: null,
  });
  const columns = [
    column("ID", "NUMBER", false, `"${schema}"."ISEQ$$_${system}".nextval`),
    column("ARTIKEL", "VARCHAR2(40)", false, null),
    column("LAGERORT_ID", "NUMBER(10,0)", true, null),
    ...(extra ? [column("BEMERKUNG", "VARCHAR2(200)", true, null)] : []),
  ].map((item, index) => ({ ...item, ordinal_position: index + 1 }));
  return {
    list_table_columns_detailed: columns,
    list_constraints: [
      {
        name: "FK_ARE_LAGERORT",
        constraint_type: "FOREIGN KEY",
        columns: ["LAGERORT_ID"],
        definition: "FOREIGN KEY (LAGERORT_ID)",
      },
      {
        name: `SYS_C00${system + 1}`,
        constraint_type: "CHECK",
        columns: ["ID"],
        definition: 'CHECK ("ID" IS NOT NULL)',
      },
      {
        name: `SYS_C00${system + 2}`,
        constraint_type: "CHECK",
        columns: ["ARTIKEL"],
        definition: 'CHECK ("ARTIKEL" IS NOT NULL)',
      },
      {
        name: `SYS_C00${system + 3}`,
        constraint_type: "PRIMARY KEY",
        columns: ["ID"],
        definition: "PRIMARY KEY (ID)",
      },
    ],
    list_indexes: [
      {
        name: "IX_ARE",
        is_unique: false,
        is_primary: false,
        columns: ["LAGERORT_ID"],
        index_type: "normal",
        definition: `CREATE INDEX "IX_ARE" ON "${schema}"."${TABLE}" ("LAGERORT_ID")`,
      },
      {
        name: `SYS_C00${system + 3}`,
        is_unique: true,
        is_primary: true,
        columns: ["ID"],
        index_type: "normal",
        definition: `CREATE UNIQUE INDEX "SYS_C00${system + 3}" ON "${schema}"."${TABLE}" ("ID")`,
      },
    ],
    list_triggers: [
      {
        trigger_name: "TRG_ARE",
        table_schema: schema,
        table_name: TABLE,
        event: "INSERT",
        timing: "BEFORE",
        orientation: "ROW",
        function_schema: "",
        function_name: "",
        enabled: "O",
        definition: `CREATE OR REPLACE TRIGGER "${schema}"."TRG_ARE" BEFORE INSERT ON ${schema}.${TABLE} FOR EACH ROW BEGIN NULL; END;`,
      },
    ],
  };
}

const schemas: Record<string, ReturnType<typeof catalog>> = {
  DEV_ACHTERESCH: catalog("DEV_ACHTERESCH", 8718, true),
  REAL_ENTW: catalog("REAL_ENTW", 8726, false),
};

const sources = new Map<string, string>();
for (const schema of Object.keys(schemas)) {
  sources.set(
    `${schema}:P_BUCHEN`,
    `CREATE OR REPLACE PROCEDURE "${schema}"."P_BUCHEN"(p_id IN NUMBER) IS\nBEGIN\n  NULL;\nEND p_buchen;`,
  );
  sources.set(
    `${schema}:V_LAGER`,
    `CREATE OR REPLACE FORCE VIEW "${schema}"."V_LAGER"\n(\n  "ID"\n)\nAS\nSELECT id FROM lager;`,
  );
  sources.set(
    packageOid(schema, "PKG_LAGER", "spec"),
    `CREATE OR REPLACE PACKAGE "${schema}"."PKG_LAGER" AS\n  PROCEDURE buchen;\nEND pkg_lager;`,
  );
  sources.set(
    packageOid(schema, "PKG_LAGER", "body"),
    `CREATE OR REPLACE PACKAGE BODY "${schema}"."PKG_LAGER" AS\n  PROCEDURE buchen IS BEGIN NULL; END;\nEND pkg_lager;`,
  );
}
const requests: string[] = [];

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: { schema: string; oid: string; view: string }) => {
    requests.push(command);
    if (command === "get_function_definition") return sources.get(args.oid);
    if (command === "get_view_definition") return sources.get(`${args.schema}:${args.view}`);
    if (command === "list_sequences")
      return [
        {
          schema: args.schema,
          name: "SEQ_BELEG",
          data_type: "NUMBER",
          start_value: "1",
          min_value: "1",
          max_value: "9999",
          increment_by: "1",
          cycle: false,
          last_value: null,
        },
      ];
    return schemas[args.schema][command as keyof ReturnType<typeof catalog>];
  },
}));

const connection = {
  id: "ora",
  kind: "oracle",
  connectionString: "oracle://u@h/db",
} as SavedConnection;
const side = (schema: string) => ({
  ...EMPTY_COMPARE_SIDE,
  connectionId: "ora",
  schema,
  objectType: "table" as const,
  objectName: TABLE,
});

describe("Oracle-Tabellen im Vergleich", () => {
  test("zeigen Schema, Systemnamen und Identitätssequenzen nicht als Abweichung", async () => {
    const source = await loadCompareDefinition(connection, side("DEV_ACHTERESCH"));
    const target = await loadCompareDefinition(connection, side("REAL_ENTW"));
    expect(source.replace("\n  BEMERKUNG VARCHAR2(200) NULL", "")).toBe(target);
    expect(target).not.toMatch(/REAL_ENTW|SYS_C\d|IS NOT NULL/);
    expect(buildCompareApplyPlan("oracle", side("REAL_ENTW"), target, source)).toEqual([
      `ALTER TABLE "REAL_ENTW"."${TABLE}" ADD ("BEMERKUNG" VARCHAR2(200))`,
    ]);
    expect(() =>
      buildCompareApplyPlan(
        "oracle",
        side("REAL_ENTW"),
        target,
        `${target}\n`.replace(`TABLE ${TABLE}`, "TABLE X"),
      ),
    ).toThrow("nichts zu speichern");
    expect(() =>
      buildCompareApplyPlan(
        "oracle",
        side("REAL_ENTW"),
        target,
        target.replace(" DEFAULT IDENTITY", ""),
      ),
    ).toThrow("Identitätsspalten");
  });
});

describe("Oracle-Quelltexte im Vergleich", () => {
  const object = (schema: string, objectType: CompareObjectType, objectName: string) => ({
    ...EMPTY_COMPARE_SIDE,
    connectionId: "ora",
    schema,
    objectType,
    objectName,
    objectOid: objectType === "procedure" ? `${schema}:P_BUCHEN` : null,
  });
  const objects: [CompareObjectType, string][] = [
    ["procedure", "P_BUCHEN()"],
    ["view", "V_LAGER"],
    ["package", "PKG_LAGER"],
  ];

  test("zeigen das Schema in Prozedur, View und Package nicht als Abweichung", async () => {
    for (const [type, name] of objects) {
      requests.length = 0;
      const source = await loadPortableDefinition(connection, object("DEV_ACHTERESCH", type, name));
      const target = await loadPortableDefinition(connection, object("REAL_ENTW", type, name));
      expect(source).toBe(target);
      expect(source).not.toMatch(/DEV_ACHTERESCH|REAL_ENTW/);
      expect(requests).toHaveLength(type === "package" ? 4 : 2);
    }
    expect(
      await loadPortableDefinition(connection, object("REAL_ENTW", "package", "PKG_LAGER")),
    ).toStartWith('PACKAGE SPEC PKG_LAGER\n\nCREATE OR REPLACE PACKAGE "PKG_LAGER" AS');
  });

  test("zeigen das Schema einer Sequenz nicht als Abweichung", async () => {
    const source = await loadPortableDefinition(
      connection,
      object("DEV_ACHTERESCH", "sequence", "SEQ_BELEG"),
    );
    expect(source).toBe(
      await loadPortableDefinition(connection, object("REAL_ENTW", "sequence", "SEQ_BELEG")),
    );
    expect(source).toStartWith("SEQUENCE SEQ_BELEG\n");
    expect(
      await loadCompareDefinition(connection, object("REAL_ENTW", "sequence", "SEQ_BELEG")),
    ).toStartWith("SEQUENCE REAL_ENTW.SEQ_BELEG\n");
  });

  test("bleiben für die Versionierung mit Schema erhalten", async () => {
    expect(
      await loadCompareDefinition(connection, object("REAL_ENTW", "procedure", "P_BUCHEN()")),
    ).toStartWith('CREATE OR REPLACE PROCEDURE "REAL_ENTW"."P_BUCHEN"(p_id IN NUMBER) IS');
    expect(
      await loadCompareDefinition(connection, object("REAL_ENTW", "package", "PKG_LAGER")),
    ).toStartWith('PACKAGE SPEC REAL_ENTW.PKG_LAGER\n\nCREATE OR REPLACE PACKAGE "REAL_ENTW".');
  });

  test("werden beim Übernehmen wieder im Zielschema angelegt", async () => {
    const plan = async (type: CompareObjectType, name: string, from: string, to: string) => {
      const side = object("REAL_ENTW", type, name);
      const target = await loadPortableDefinition(connection, side);
      return buildCompareApplyPlan("oracle", side, target, target.replace(from, to));
    };
    expect(await plan("procedure", "P_BUCHEN()", "NULL;", "COMMIT;")).toEqual([
      'CREATE OR REPLACE PROCEDURE "REAL_ENTW"."P_BUCHEN"(p_id IN NUMBER) IS\nBEGIN\n  COMMIT;\nEND p_buchen;',
    ]);
    expect(await plan("view", "V_LAGER", "FROM lager", "FROM lager WHERE id > 0")).toEqual([
      'CREATE OR REPLACE FORCE VIEW "REAL_ENTW"."V_LAGER"\n(\n  "ID"\n)\nAS\nSELECT id FROM lager WHERE id > 0',
    ]);
    expect(await plan("package", "PKG_LAGER", "BEGIN NULL;", "BEGIN COMMIT;")).toEqual([
      'CREATE OR REPLACE PACKAGE "REAL_ENTW"."PKG_LAGER" AS\n  PROCEDURE buchen;\nEND pkg_lager;',
      'CREATE OR REPLACE PACKAGE BODY "REAL_ENTW"."PKG_LAGER" AS\n  PROCEDURE buchen IS BEGIN COMMIT; END;\nEND pkg_lager;',
    ]);
  });
});
