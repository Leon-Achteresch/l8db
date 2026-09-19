import type { ColumnPinningState, ColumnSizingState, Table } from "@tanstack/react-table";
import { type RefObject, useMemo } from "react";
import { useColumnWindow } from "@/lib/hooks/use-column-window";
import type { TableRow } from "../data-table-types";
import { INDEX_COLUMN } from "./constants";

export function useVisibleColumns(
  table: Table<TableRow>,
  columnSizing: ColumnSizingState,
  columnPinning: ColumnPinningState,
  scrollRef: RefObject<HTMLDivElement | null>,
) {
  const leftColumns = table.getLeftVisibleLeafColumns();
  const centerColumns = table.getCenterVisibleLeafColumns();
  const rightColumns = table.getRightVisibleLeafColumns();
  const visibleColumns = useMemo(
    () => [...leftColumns, ...centerColumns, ...rightColumns],
    [leftColumns, centerColumns, rightColumns],
  );
  const visibleDataColumns = useMemo(
    () => visibleColumns.map((column) => column.id).filter((id) => id !== INDEX_COLUMN),
    [visibleColumns],
  );
  const columnWidths = useMemo(
    () => visibleColumns.map((column) => column.getSize()),
    [visibleColumns, columnSizing],
  );
  const pinnedIndices = useMemo(
    () => visibleColumns.flatMap((column, index) => (column.getIsPinned() ? [index] : [])),
    [visibleColumns, columnPinning],
  );
  const columnWindow = useColumnWindow(scrollRef, columnWidths, pinnedIndices);
  return { visibleColumns, visibleDataColumns, columnWidths, pinnedIndices, columnWindow };
}
