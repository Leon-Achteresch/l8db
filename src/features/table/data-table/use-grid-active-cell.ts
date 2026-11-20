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
  return [activeCell, setActiveCell] as const;
}
