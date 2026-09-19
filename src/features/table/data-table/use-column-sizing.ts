import { useMemo } from "react";
import { fitHeaderColumnWidth, measureHeaderTitleWidth } from "@/lib/column-header-width";
import type { ForeignKeyInfo } from "@/lib/db";
import { useTableViewState } from "@/lib/hooks/use-table-view-state";
import { useSettingsStore } from "@/lib/settings";
import type { getColumnTypeInfo } from "./column-type-info";

export function useColumnSizing(
  stateKey: string | undefined,
  order: string[],
  fkByColumn: Map<string, ForeignKeyInfo[]>,
  typeInfoByColumn: Map<string, ReturnType<typeof getColumnTypeInfo>>,
) {
  const [savedColumnSizing, setColumnSizing] = useTableViewState(stateKey, "columnSizing", {});
  const fitColumnsToHeader = useSettingsStore((state) => state.fitColumnsToHeader);
  const columnSizing = useMemo(() => {
    if (!fitColumnsToHeader) return savedColumnSizing;
    const fitted: Record<string, number> = {};
    for (const column of order) {
      fitted[column] = fitHeaderColumnWidth(
        measureHeaderTitleWidth(column, typeInfoByColumn.get(column)?.label),
        fkByColumn.has(column),
      );
    }
    return { ...fitted, ...savedColumnSizing };
  }, [fitColumnsToHeader, order, fkByColumn, typeInfoByColumn, savedColumnSizing]);
  return { savedColumnSizing, setColumnSizing, columnSizing };
}
