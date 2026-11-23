import { expect, test } from "bun:test";
import { getColumnTypeInfo } from "../src/features/table/data-table/column-type-info";
import {
  columnFilterCounts,
  getTypeConfig,
  matchesColumnFilter,
} from "../src/features/table/table-columns-list/column-type-config";
import { columnTypeLabel } from "../src/lib/column-type";
import { isDateType } from "../src/lib/dashboards/sql";
import type { DetailedColumnInfo } from "../src/lib/db";
import { filterAiExamples } from "../src/lib/filter-ai/examples";
import { isEnumDataType } from "../src/lib/grid-cell-format";
import { isDateFilterType } from "../src/lib/sql-filter";
import { timestampCellText } from "../src/lib/timestamp-display";
import cases from "./fixtures/mssql-rowversion-types.json";

function column(data_type: string, name = "version"): DetailedColumnInfo {
  return {
    name,
    data_type,
    is_nullable: false,
    column_default: null,
    is_primary_key: false,
    ordinal_position: 1,
    character_maximum_length: data_type === "rowversion" ? 8 : null,
  };
}

test("SQL-Server catalog aliases reach consumers as opaque row versions", () => {
  for (const fixture of cases.filter((item) => item.basic_type === "rowversion")) {
    const detail = column(fixture.detailed_type);
    for (const rows of [
      [],
      [{ version: null }],
      [{ version: "\\x00000000000007d3" }],
      [{ version: [0, 1, 2] }],
    ]) {
      expect(getColumnTypeInfo("version", rows, detail)).toMatchObject({
        kind: "text",
        iconName: "Type",
      });
    }
    expect(getTypeConfig(detail.data_type, false).label).not.toBe("Datum/Zeit");
    expect(matchesColumnFilter(detail, "", "date")).toBe(false);
    expect(isDateFilterType(detail.data_type)).toBe(false);
    expect(isDateType(detail.data_type)).toBe(false);
    expect(isEnumDataType(detail.data_type)).toBe(false);
    expect(columnTypeLabel(detail.data_type, 8)).toBe("rowversion");
    expect(fixture.catalog_type).toBeTruthy();
  }
  expect(columnTypeLabel("ROWVERSION", 8)).toBe("ROWVERSION");
  const version = column("rowversion");
  const created = column("datetime2(7)", "created_at");
  expect(columnFilterCounts([version, created]).find((item) => item.id === "date")?.count).toBe(1);
  expect(filterAiExamples(["version"], [version]).join(" ")).not.toContain("letzten 7 Tage");
  expect(filterAiExamples(["version", "created_at"], [version, created])[0]).toContain(
    "created_at",
  );
});

test("real timestamp/date metadata from PostgreSQL and MySQL keeps temporal controls", () => {
  for (const type of [
    "timestamp",
    "timestamp(6)",
    "timestamp with time zone",
    "timestamp without time zone",
    "timestamptz",
    "datetime2(7)",
    "datetimeoffset(7)",
    "date",
  ]) {
    const detail = column(type, "created_at");
    expect(getColumnTypeInfo("created_at", [], detail).kind).toBe("date");
    expect(getTypeConfig(type, false).label).toBe("Datum/Zeit");
    expect(matchesColumnFilter(detail, "", "date")).toBe(true);
    expect(isDateFilterType(type)).toBe(true);
    expect(isDateType(type)).toBe(true);
  }
});

test("opaque rowversion values and timestamp values are not converted by metadata classification", () => {
  const raw = "\\x00000000000007d3";
  const rows = [{ version: raw }];
  const detail = column("rowversion");
  getColumnTypeInfo("version", rows, detail);
  expect(rows).toEqual([{ version: raw }]);
  expect(detail.data_type).toBe("rowversion");
  expect(timestampCellText(raw, { mode: "utc", precision: "milliseconds" })).toBeNull();
  expect(timestampCellText("2026-11-16 12:00:00Z", { mode: "utc", precision: "seconds" })).toBe(
    "2026-11-16 12:00:00 UTC",
  );
});
