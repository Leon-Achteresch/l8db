import type { ColumnPinningState } from "@tanstack/react-table";
import { useMemo } from "react";
import { INDEX_COLUMN } from "./constants";

export function useColumnLayoutState(order: string[], hidden: string[], pinned: string[]) {
  const columnOrder = useMemo(() => [INDEX_COLUMN, ...order], [order]);
  const columnVisibility = useMemo(
    () => Object.fromEntries(hidden.map((column) => [column, false])),
    [hidden],
  );
  const searchColumns = useMemo(() => {
    const hiddenSet = new Set(hidden);
    return order.filter((column) => !hiddenSet.has(column));
  }, [order, hidden]);
  const columnPinning = useMemo<ColumnPinningState>(() => {
    const hiddenSet = new Set(hidden);
    return {
      left: [INDEX_COLUMN, ...pinned.filter((column) => !hiddenSet.has(column))],
      right: [],
    };
  }, [pinned, hidden]);
  const pinnedSet = useMemo(() => new Set(pinned), [pinned]);
  return { columnOrder, columnVisibility, searchColumns, columnPinning, pinnedSet };
}
