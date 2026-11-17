import { expect, test } from "bun:test";
import {
  compactTypeName,
  getColumnTypeInfo,
} from "../src/features/table/data-table/column-type-info";

const detail = (data_type: string) =>
  ({ name: "erstellt", data_type, is_nullable: false, is_primary_key: false }) as never;

test("Zeitspalten nennen im Kopf die Art des Zeittyps", () => {
  expect(getColumnTypeInfo("erstellt", [], detail("timestamp with time zone")).label).toBe(
    "timestamp",
  );
  expect(getColumnTypeInfo("erstellt", [], detail("datetime2")).label).toBe("timestamp");
  expect(getColumnTypeInfo("erstellt", [], detail("time without time zone")).label).toBe("time");
  expect(getColumnTypeInfo("erstellt", [], detail("interval")).label).toBe("interval");
  expect(getColumnTypeInfo("erstellt", [], detail("date")).label).toBe("date");
  expect(getColumnTypeInfo("erstellt", [], detail("timestamp with time zone")).kind).toBe("date");
});

test("Kopf zeigt den Datenbanktyp kurz wie im Spalten-Tab", () => {
  expect(compactTypeName("timestamp with time zone")).toBe("timestamptz");
  expect(compactTypeName("character varying(255)")).toBe("varchar");
  expect(compactTypeName("VARCHAR2(80)")).toBe("varchar2");
  expect(compactTypeName("NUMBER(12,2)")).toBe("number");
  expect(compactTypeName("TIMESTAMP(6) WITH TIME ZONE")).toBe("timestamptz");
  expect(compactTypeName("Nullable(DateTime64(3, 'UTC'))")).toBe("datetime64");
  expect(compactTypeName("TIMESTAMP(6) WITH LOCAL TIME ZONE")).toBe(null);
  expect(compactTypeName(undefined)).toBe(null);
});
