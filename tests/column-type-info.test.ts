import { expect, test } from "bun:test";
import { getColumnTypeInfo } from "../src/features/table/data-table/column-type-info";

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
