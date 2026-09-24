import { describe, expect, mock, test } from "bun:test";
import { buildCompareApplyPlan } from "@/lib/compare-apply-plan";
import { EMPTY_COMPARE_SIDE, loadCompareDefinition } from "@/lib/compare-definition";
import type { SavedConnection } from "@/lib/connections";

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

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: { schema: string }) =>
    schemas[args.schema][command as keyof ReturnType<typeof catalog>],
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
