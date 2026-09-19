import { useContext, useEffect, useState } from "react";
import type { GridCellRef } from "@/lib/grid-selection";
import { MasterSelectionContext, useMasterDetail } from "@/lib/master-detail";
import type { TableRow } from "../data-table-types";

export function useGridActiveCell(
  data: TableRow[],
  columnNames: string[],
  autoSelectFirstCell: boolean,
) {
  const selectionKey = useContext(MasterSelectionContext);
  const [activeCell, setActiveCell] = useState<GridCellRef | null>(() => {
    const saved = selectionKey ? useMasterDetail.getState().selections[selectionKey] : undefined;
    return saved ? { rowIndex: saved.rowIndex, columnId: saved.column } : null;
  });
  useEffect(() => {
    if (!autoSelectFirstCell || activeCell || data.length === 0) return;
    const column = columnNames.find((name) => name !== "__ctid__");
    if (column) setActiveCell({ rowIndex: 0, columnId: column });
  }, [autoSelectFirstCell, activeCell, data, columnNames]);
  useEffect(() => {
    if (!selectionKey) return;
    const row = activeCell ? data[activeCell.rowIndex] : undefined;
    useMasterDetail.getState().selectCell(
      selectionKey,
      activeCell && row && Object.hasOwn(row, activeCell.columnId)
        ? {
            column: activeCell.columnId,
            rowIndex: activeCell.rowIndex,
            value: row[activeCell.columnId],
            row,
          }
        : null,
    );
  }, [selectionKey, activeCell, data]);
  return [activeCell, setActiveCell] as const;
}
