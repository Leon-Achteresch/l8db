import { useCallback, useState } from "react";
import { copyText } from "@/lib/clipboard";
import {
  autosizeColumnWidth,
  fitHeaderColumnWidth,
  measureHeaderTitleWidth,
} from "@/lib/column-header-width";
import type { ForeignKeyInfo } from "@/lib/db";
import { serializeSelectionCell } from "@/lib/grid-selection";
import { formatVisibleColumnNames, toggleHiddenColumn } from "@/lib/table-column-prefs";
import type { getColumnTypeInfo } from "./column-type-info";

type Options = {
  order: string[];
  hidden: string[];
  setHidden: (hidden: string[]) => void;
  savedColumnSizing: Record<string, number>;
  setColumnSizing: (sizing: Record<string, number>) => void;
  fkByColumn: Map<string, ForeignKeyInfo[]>;
  typeInfoByColumn: Map<string, ReturnType<typeof getColumnTypeInfo>>;
  data: Record<string, unknown>[];
  totalCount?: number | null;
};

export function copiedValuesLabel(count: number, total: number | null | undefined): string {
  const loaded = count.toLocaleString("de-DE");
  if (total == null) return `${loaded} geladene Werte`;
  if (total > count) return `${loaded} von ${total.toLocaleString("de-DE")} Werten`;
  return `${loaded} Werte`;
}

export function useColumnActions({
  order,
  hidden,
  setHidden,
  savedColumnSizing,
  setColumnSizing,
  fkByColumn,
  typeInfoByColumn,
  data,
  totalCount,
}: Options) {
  const [togglingColumn, setTogglingColumn] = useState<string | null>(null);

  const copyColumnNames = useCallback(() => {
    const names = formatVisibleColumnNames(order, hidden);
    if (names === "") return;
    void copyText(names, "Spaltennamen kopiert.");
  }, [order, hidden]);

  const copyColumnValues = useCallback(
    (columnId: string) => {
      const text = data.map((row) => serializeSelectionCell(row[columnId])).join("\n");
      void copyText(
        text,
        `Spalte ${columnId} kopiert (${copiedValuesLabel(data.length, totalCount)}).`,
      );
    },
    [data, totalCount],
  );

  const headerWidth = useCallback(
    (column: string) =>
      fitHeaderColumnWidth(
        measureHeaderTitleWidth(column, typeInfoByColumn.get(column)?.label),
        fkByColumn.has(column),
      ),
    [fkByColumn, typeInfoByColumn],
  );

  const autosizeColumn = useCallback(
    (columnId: string) =>
      setColumnSizing({
        ...savedColumnSizing,
        [columnId]: autosizeColumnWidth(
          data,
          columnId,
          headerWidth(columnId),
          serializeSelectionCell,
        ),
      }),
    [data, headerWidth, savedColumnSizing, setColumnSizing],
  );

  const fitHeaderWidths = useCallback(() => {
    const hiddenSet = new Set(hidden);
    const next = { ...savedColumnSizing };
    for (const column of order) {
      if (hiddenSet.has(column)) continue;
      next[column] = headerWidth(column);
    }
    setColumnSizing(next);
  }, [headerWidth, hidden, order, savedColumnSizing, setColumnSizing]);

  const handleColumnToggle = useCallback(
    (column: string) => {
      if (togglingColumn) return;
      setTogglingColumn(column);
      setHidden(toggleHiddenColumn(order, hidden, column));
      requestAnimationFrame(() => setTogglingColumn(null));
    },
    [hidden, order, setHidden, togglingColumn],
  );

  return {
    togglingColumn,
    copyColumnNames,
    copyColumnValues,
    fitHeaderWidths,
    autosizeColumn,
    handleColumnToggle,
  };
}
