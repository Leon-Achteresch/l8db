import { useMemo } from "react";
import { columnProfile } from "@/lib/column-profile";
import type { DetailedColumnInfo } from "@/lib/db";
import { isCategorical, isEnumDataType } from "@/lib/grid-cell-format";
import { useSettingsStore } from "@/lib/settings";
import type { TableRow } from "../data-table-types";
import type { getColumnTypeInfo } from "./column-type-info";
import type { GridColumnStyle, GridStyle } from "./grid-style-context";

function isNumericValue(value: unknown): boolean {
  if (typeof value === "number" || typeof value === "bigint") return true;
  return typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value);
}

export function useGridStyle(
  columnNames: string[],
  data: TableRow[],
  columnDetails: DetailedColumnInfo[] | undefined,
  typeInfoByColumn: Map<string, ReturnType<typeof getColumnTypeInfo>>,
): GridStyle {
  const style = useSettingsStore((state) => state.tableStyle);
  return useMemo(() => {
    const columns = new Map<string, GridColumnStyle>();
    const now = new Date();
    if (style === "classic") return { style, columns, now };
    const primaryKeys = new Set(
      (columnDetails ?? []).filter((column) => column.is_primary_key).map((column) => column.name),
    );
    const dataTypes = new Map(
      (columnDetails ?? []).map((column) => [column.name, column.data_type]),
    );
    for (const name of columnNames) {
      const kind = typeInfoByColumn.get(name)?.kind ?? "text";
      const values = data.map((row) => row[name]);
      const present = values.filter((value) => value !== null && value !== undefined);
      const categorical =
        kind === "text" && isCategorical(values, isEnumDataType(dataTypes.get(name)));
      columns.set(name, {
        kind,
        numeric:
          kind === "number" ||
          (kind === "key" && present.length > 0 && present.every(isNumericValue)),
        primaryKey: primaryKeys.has(name),
        categorical,
        profile: style === "profile" ? columnProfile(values, kind, categorical) : null,
      });
    }
    return { style, columns, now };
  }, [style, columnNames, data, columnDetails, typeInfoByColumn]);
}
