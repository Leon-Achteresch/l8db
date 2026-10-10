import { type Dispatch, type SetStateAction, useCallback, useMemo, useRef, useState } from "react";
import { copyText } from "@/lib/clipboard";
import {
  cellKey,
  cellsByRow,
  cellsToTsv,
  type GridCellRef,
  mergeSelectionCells,
  selectionRange,
  summarizeCells,
} from "@/lib/grid-selection";
import type { TableRow } from "../data-table-types";
import { INDEX_COLUMN } from "./constants";

const NO_CELLS = new Map<number, Set<string>>();

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
  const selectedByRow = useMemo(
    () => (selectedCount > 1 ? cellsByRow(selectedCells) : NO_CELLS),
    [selectedCount, selectedCells],
  );
  const selectionStats = useMemo(
    () => (selectedCount > 1 ? summarizeCells(data, selectedCells) : null),
    [selectedCount, data, selectedCells],
  );

  const committedRef = useRef({ selectedRange, extraCells });
  committedRef.current = { selectedRange, extraCells };
  const focusCell = useCallback(
    (cell: GridCellRef | null, extend = false, additive = false) => {
      if (additive && cell && cell.columnId !== INDEX_COLUMN) {
        const { selectedRange, extraCells } = committedRef.current;
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
    [setActiveCell],
  );

  const copySelection = useCallback(() => {
    if (selectedCount <= 1) return false;
    const tsv = cellsToTsv(data, selectedCells, visibleColumnIds);
    if (tsv === "") return false;
    void copyText(tsv, `${selectedCount} Zellen als TSV kopiert.`);

    return true;
  }, [selectedCells, selectedCount, data, visibleColumnIds]);

  return {
    setSelectionAnchor,
    setExtraCells,
    selectedCount,
    selectedByRow,
    selectionStats,
    focusCell,
    copySelection,
  };
}
