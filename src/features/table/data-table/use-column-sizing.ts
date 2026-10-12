import type { ColumnSizingState, Updater } from "@tanstack/react-table";
import { useCallback, useMemo } from "react";
import { contentColumnWidth } from "@/lib/column-content-width";
import { fitHeaderColumnWidth, measureHeaderTitleWidth } from "@/lib/column-header-width";
import type { ForeignKeyInfo } from "@/lib/db";
import { useTableViewState } from "@/lib/hooks/use-table-view-state";
import { useSettingsStore } from "@/lib/settings";
import type { TableRow } from "../data-table-types";
import type { getColumnTypeInfo } from "./column-type-info";
import type { GridStyle } from "./grid-style-context";

const SAMPLE_ROWS = 200;

export function useColumnSizing(
  stateKey: string | undefined,
  order: string[],
  fkByColumn: Map<string, ForeignKeyInfo[]>,
  typeInfoByColumn: Map<string, ReturnType<typeof getColumnTypeInfo>>,
  data: TableRow[],
  gridStyle: GridStyle,
) {
  const contentFit = gridStyle.style !== "classic";
  const [classicSizing, setClassicSizing] = useTableViewState(stateKey, "columnSizing", {});
  const [contentSizing, setContentSizing] = useTableViewState(stateKey, "contentColumnSizing", {});
  const savedColumnSizing = contentFit ? contentSizing : classicSizing;
  const fitColumnsToHeader = useSettingsStore((state) => state.fitColumnsToHeader);
  const uiScale = useSettingsStore((state) => state.uiScale);
  const columnSizing = useMemo(() => {
    if (contentFit) {
      const sample = data.length > SAMPLE_ROWS ? data.slice(0, SAMPLE_ROWS) : data;
      const fitted: ColumnSizingState = {};
      for (const column of order) {
        const saved = contentSizing[column];
        if (saved !== undefined) {
          fitted[column] = saved;
          continue;
        }
        const info = gridStyle.columns.get(column);
        fitted[column] = contentColumnWidth({
          name: column,
          hasFk: fkByColumn.has(column),
          kind: info?.kind ?? "text",
          categorical: info?.categorical ?? false,
          values: sample.map((row) => row[column]),
          style: gridStyle.style,
          uiScale,
          now: gridStyle.now,
        });
      }
      return fitted;
    }
    if (!fitColumnsToHeader) return classicSizing;
    const fitted: Record<string, number> = { ...classicSizing };
    for (const column of order) {
      const minWidth = fitHeaderColumnWidth(
        measureHeaderTitleWidth(column, typeInfoByColumn.get(column)?.label),
        fkByColumn.has(column),
      );
      fitted[column] = Math.max(minWidth, classicSizing[column] ?? 0);
    }
    return fitted;
  }, [
    contentFit,
    data,
    order,
    contentSizing,
    gridStyle,
    typeInfoByColumn,
    fkByColumn,
    uiScale,
    fitColumnsToHeader,
    classicSizing,
  ]);
  const setColumnSizing = useCallback(
    (update: Updater<ColumnSizingState>) => {
      if (!contentFit) {
        setClassicSizing(update);
        return;
      }
      const next = typeof update === "function" ? update(columnSizing) : update;
      setContentSizing((saved) => {
        const changed: ColumnSizingState = { ...saved };
        for (const [column, width] of Object.entries(next)) {
          if (saved[column] !== undefined || columnSizing[column] !== width)
            changed[column] = width;
        }
        for (const column of Object.keys(saved)) if (!(column in next)) delete changed[column];
        return changed;
      });
    },
    [contentFit, columnSizing, setClassicSizing, setContentSizing],
  );
  return { savedColumnSizing, setColumnSizing, columnSizing };
}
