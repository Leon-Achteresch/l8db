import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { MasterSelectionContext, useMasterDetail } from "@/lib/master-detail";
import type { TableRow } from "../data-table-types";
import { INDEX_COLUMN } from "./constants";

const NO_CELLS = new Map<number, Set<string>>();

export function useGridSelection(
  activeCell: GridCellRef | null,
  setActiveCell: Dispatch<SetStateAction<GridCellRef | null>>,
  visibleColumnIds: string[],
  data: TableRow[],
  totalCount?: number | null,
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

  const selectionKey = useContext(MasterSelectionContext);
  const masterRows = useMemo(() => {
    if (selectedByRow.size < 2) return undefined;
    return [...selectedByRow.keys()]
      .sort((a, b) => a - b)
      .flatMap((index) => (data[index] ? [data[index]] : []));
  }, [selectedByRow, data]);
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
            rows: masterRows,
          }
        : null,
    );
  }, [selectionKey, activeCell, data, masterRows]);

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
    const rows = new Set(selectedCells.map((cell) => cell.rowIndex)).size;
    const loaded =
      totalCount != null && totalCount > data.length && rows === data.length
        ? ` (${data.length.toLocaleString("de-DE")} von ${totalCount.toLocaleString("de-DE")} Zeilen)`
        : "";
    void copyText(tsv, `${selectedCount} Zellen als TSV kopiert${loaded}.`);
    return true;
  }, [selectedCells, selectedCount, data, visibleColumnIds, totalCount]);

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
