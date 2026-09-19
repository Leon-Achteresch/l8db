import type { Row } from "@tanstack/react-table";
import { type Dispatch, type SetStateAction, useEffect } from "react";
import type { GridCellRef } from "@/lib/grid-selection";
import type { DataTableProps, EditingCell, TableRow } from "../data-table-types";
import { INDEX_COLUMN } from "./constants";

type Options = {
  activeCell: GridCellRef | null;
  setActiveCell: Dispatch<SetStateAction<GridCellRef | null>>;
  setSelectionAnchor: Dispatch<SetStateAction<GridCellRef | null>>;
  setExtraCells: Dispatch<SetStateAction<GridCellRef[]>>;
  visibleDataColumns: string[];
  rows: Row<TableRow>[];
  editingCell: EditingCell | null;
  setEditingCell: Dispatch<SetStateAction<EditingCell | null>>;
  handleSaveCell: () => Promise<void>;
  onSaveRow: DataTableProps["onSaveRow"];
  handleCellEdit: (row: Row<TableRow>, columnId: string) => void;
  focusCell: (cell: GridCellRef | null, extend?: boolean, additive?: boolean) => void;
  copySelection: () => boolean;
  selectedCount: number;
};

export function useGridKeyboard({
  activeCell,
  setActiveCell,
  setSelectionAnchor,
  setExtraCells,
  visibleDataColumns,
  rows,
  editingCell,
  setEditingCell,
  handleSaveCell,
  onSaveRow,
  handleCellEdit,
  focusCell,
  copySelection,
  selectedCount,
}: Options) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-draft-row], [data-draft-controls]")) return;
      if (editingCell) {
        if (e.key === "Escape") {
          setEditingCell(null);
          return;
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          void handleSaveCell();
          return;
        }
        return;
      }

      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

      if (!activeCell) return;
      const { rowIndex, columnId } = activeCell;
      const colIndex = visibleDataColumns.indexOf(columnId);

      if (e.key === "Escape") {
        if (selectedCount > 1) {
          setExtraCells([]);
          setSelectionAnchor(activeCell);
          return;
        }
        setActiveCell(null);
        setSelectionAnchor(null);
        return;
      }

      if (e.key === "Enter" && !e.shiftKey && onSaveRow && columnId !== INDEX_COLUMN) {
        e.preventDefault();
        const row = rows[rowIndex];
        if (row) handleCellEdit(row, columnId);
        return;
      }

      let nextRowIndex = rowIndex;
      let nextColIndex = colIndex;

      if (e.key === "ArrowUp") {
        nextRowIndex = Math.max(0, rowIndex - 1);
        e.preventDefault();
      } else if (e.key === "ArrowDown") {
        nextRowIndex = Math.min(rows.length - 1, rowIndex + 1);
        e.preventDefault();
      } else if (e.key === "ArrowLeft") {
        nextColIndex = Math.max(e.shiftKey ? 0 : -1, colIndex - 1);
        e.preventDefault();
      } else if (e.key === "ArrowRight") {
        nextColIndex = Math.min(visibleDataColumns.length - 1, colIndex + 1);
        e.preventDefault();
      }

      const nextColumnId = nextColIndex === -1 ? INDEX_COLUMN : visibleDataColumns[nextColIndex];
      if (nextRowIndex !== rowIndex || nextColumnId !== columnId) {
        focusCell({ rowIndex: nextRowIndex, columnId: nextColumnId }, e.shiftKey);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeCell,
    visibleDataColumns,
    rows,
    editingCell,
    handleSaveCell,
    onSaveRow,
    handleCellEdit,
    focusCell,
    copySelection,
    selectedCount,
  ]);
}
