import { type Dispatch, type SetStateAction, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { copyText } from "@/lib/clipboard";
import {
  cellKey,
  cellsToTsv,
  type GridCellRef,
  mergeSelectionCells,
  selectionRange,
  summarizeCells,
} from "@/lib/grid-selection";
import type { TableRow } from "../data-table-types";
import { INDEX_COLUMN } from "./constants";

export function useGridSelection(
  activeCell: GridCellRef | null,
  setActiveCell: Dispatch<SetStateAction<GridCellRef | null>>,
  visibleColumnIds: string[],
  data: TableRow[],
) {
  const [selectionAnchor, setSelectionAnchor] = useState<GridCellRef | null>(null);
  const [extraCells, setExtraCells] = useState<GridCellRef[]>([]);

  const selection = useMemo(
    () =>
      activeCell &&
      selectionAnchor &&
      activeCell.columnId !== INDEX_COLUMN &&
      selectionAnchor.columnId !== INDEX_COLUMN
        ? { anchor: selectionAnchor, focus: activeCell }
        : null,
    [activeCell, selectionAnchor],
  );
  const selectedRange = useMemo(
    () => selectionRange(selection, visibleColumnIds),
    [selection, visibleColumnIds],
  );
  const selectedCells = useMemo(
    () => mergeSelectionCells(selectedRange, extraCells),
    [selectedRange, extraCells],
  );
  const selectedCount = selectedCells.length;
  const selectedKeys = useMemo(
    () => new Set(selectedCells.map((cell) => cellKey(cell.rowIndex, cell.columnId))),
    [selectedCells],
  );
  const selectionStats = useMemo(
    () => (selectedCount > 1 ? summarizeCells(data, selectedCells) : null),
    [selectedCount, data, selectedCells],
  );

  const focusCell = useCallback(
    (cell: GridCellRef | null, extend = false, additive = false) => {
      if (additive && cell && cell.columnId !== INDEX_COLUMN) {
        const key = cellKey(cell.rowIndex, cell.columnId);
        const committed = mergeSelectionCells(selectedRange, extraCells);
        const wasSelected = committed.some(
          (entry) => cellKey(entry.rowIndex, entry.columnId) === key,
        );
        const next = wasSelected
          ? committed.filter((entry) => cellKey(entry.rowIndex, entry.columnId) !== key)
          : [...committed, cell];
        setExtraCells(next);
        const nextActive = wasSelected ? (next[0] ?? null) : cell;
        setActiveCell(nextActive);
        setSelectionAnchor(nextActive);
        return;
      }
      setExtraCells([]);
      setActiveCell(cell);
      if (!extend) setSelectionAnchor(cell);
    },
    [selectedRange, extraCells],
  );

  const copySelection = useCallback(() => {
    if (selectedCount <= 1) return false;
    const tsv = cellsToTsv(data, selectedCells, visibleColumnIds);
    if (tsv === "") return false;
    void copyText(tsv);
    toast.success(`${selectedCount} Zellen als TSV kopiert.`);
    return true;
  }, [selectedCells, selectedCount, data, visibleColumnIds]);

  return {
    setSelectionAnchor,
    setExtraCells,
    selectedCount,
    selectedKeys,
    selectionStats,
    focusCell,
    copySelection,
  };
}
