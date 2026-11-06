import { useMemo } from "react";
import { columnProfile } from "@/lib/column-profile";
import type { DetailedColumnInfo } from "@/lib/db";
import { isCategorical, isEnumDataType } from "@/lib/grid-cell-format";
import { useSettingsStore } from "@/lib/settings";
import type { TableStyle } from "@/lib/table-style";
import type { TableRow } from "../data-table-types";
import { type getColumnTypeInfo, kindFromDataType } from "./column-type-info";
import type { GridColumnStyle, GridStyle } from "./grid-style-context";

function isNumericValue(value: unknown): boolean {
  if (typeof value === "number" || typeof value === "bigint") return true;
  return typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value);
}

function hasOnlyNumericValues(data: TableRow[], name: string): boolean {
  let seen = false;
  for (const row of data) {
    const value = row[name];
    if (value === null || value === undefined) continue;
    if (!isNumericValue(value)) return false;
    seen = true;
  }
  return seen;
}

function isNumericColumn(
  kind: GridColumnStyle["kind"],
  dataType: string | undefined,
  data: TableRow[],
  name: string,
): boolean {
  if (kind === "number") return true;
  if (kind !== "key") return false;
  const known = dataType ? kindFromDataType(dataType) : null;
  return known ? known === "number" : hasOnlyNumericValues(data, name);
}

export function buildGridStyle(
  style: TableStyle,
  columnNames: string[],
  data: TableRow[],
  columnDetails: DetailedColumnInfo[] | undefined,
  typeInfoByColumn: Map<string, ReturnType<typeof getColumnTypeInfo>>,
): GridStyle {
  const columns = new Map<string, GridColumnStyle>();
  const now = new Date();
  const primaryKeys = new Set(
    (columnDetails ?? []).filter((column) => column.is_primary_key).map((column) => column.name),
  );
  const dataTypes = new Map((columnDetails ?? []).map((column) => [column.name, column.data_type]));
  for (const name of columnNames) {
    const kind = typeInfoByColumn.get(name)?.kind ?? "text";
    const dataType = dataTypes.get(name);
    const needsValues = style === "profile" || (style !== "classic" && kind === "text");
    const values = needsValues ? data.map((row) => row[name]) : [];
    const categorical =
      style !== "classic" && kind === "text" && isCategorical(values, isEnumDataType(dataType));
    columns.set(name, {
      kind,
      numeric: isNumericColumn(kind, dataType, data, name),
      primaryKey: primaryKeys.has(name),
      categorical,
      profile: style === "profile" ? columnProfile(values, kind, categorical) : null,
    });
  }
  return { style, columns, now };
}

export function useGridStyle(
  columnNames: string[],
  data: TableRow[],
  columnDetails: DetailedColumnInfo[] | undefined,
  typeInfoByColumn: Map<string, ReturnType<typeof getColumnTypeInfo>>,
): GridStyle {
  const style = useSettingsStore((state) => state.tableStyle);
  return useMemo(
    () => buildGridStyle(style, columnNames, data, columnDetails, typeInfoByColumn),
    [style, columnNames, data, columnDetails, typeInfoByColumn],
  );
}
