import type { Row } from "@tanstack/react-table";
import type { Virtualizer } from "@tanstack/react-virtual";
import { type Dispatch, type RefObject, type SetStateAction, useEffect, useRef } from "react";
import type { GridCellRef } from "@/lib/grid-selection";
import { IS_MAC } from "@/lib/platform";
import type { DataTableProps, EditingCell, TableRow } from "../data-table-types";
import { INDEX_COLUMN } from "./constants";

type Options = {
  rootRef: RefObject<HTMLDivElement | null>;
  activeCell: GridCellRef | null;
  setActiveCell: Dispatch<SetStateAction<GridCellRef | null>>;
  setSelectionAnchor: Dispatch<SetStateAction<GridCellRef | null>>;
  setExtraCells: Dispatch<SetStateAction<GridCellRef[]>>;
  visibleDataColumns: string[];
  rows: Row<TableRow>[];
  editingCell: EditingCell | null;
  setEditingCell: Dispatch<SetStateAction<EditingCell | null>>;
  handleSaveCell: () => Promise<boolean>;
  onSaveRow: DataTableProps["onSaveRow"];
  handleCellEdit: (row: Row<TableRow>, columnId: string, initial?: string) => void;
  focusCell: (cell: GridCellRef | null, extend?: boolean, additive?: boolean) => void;
  selectedCount: number;
  rowVirtualizer: Virtualizer<HTMLDivElement, Element>;
  scrollRef: RefObject<HTMLDivElement | null>;
};

let lastGrid: HTMLElement | null = null;

const BLOCKING_TARGET =
  'input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"], [role="menu"], [role="listbox"], [role="dialog"], [data-draft-row], [data-draft-controls]';

export function useGridKeyboard({
  rootRef,
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
  selectedCount,
  rowVirtualizer,
  scrollRef,
}: Options) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const mark = () => {
      lastGrid = root;
    };
    root.addEventListener("focusin", mark);
    root.addEventListener("pointerdown", mark);
    return () => {
      root.removeEventListener("focusin", mark);
      root.removeEventListener("pointerdown", mark);
      if (lastGrid === root) lastGrid = null;
    };
  }, [rootRef]);

  const activeRef = useRef(activeCell);
  activeRef.current = activeCell;
  const firstCellRef = useRef<() => GridCellRef | null>(() => null);
  firstCellRef.current = () => {
    const columnId = visibleDataColumns[0];
    if (!columnId || rows.length === 0) return null;
    const top = scrollRef.current?.scrollTop ?? 0;
    const item = rowVirtualizer.getVirtualItems().find((entry) => entry.end > top + 1);
    return { rowIndex: Math.min(rows.length - 1, item?.index ?? 0), columnId };
  };
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const onFocus = (event: FocusEvent) => {
      if (event.target !== scroller || activeRef.current || !scroller.matches(":focus-visible"))
        return;
      const cell = firstCellRef.current();
      if (cell) focusCell(cell);
    };
    scroller.addEventListener("focus", onFocus);
    return () => scroller.removeEventListener("focus", onFocus);
  }, [scrollRef, focusCell]);

  const wasEditing = useRef(false);
  useEffect(() => {
    const editing = editingCell !== null;
    if (wasEditing.current && !editing) {
      const focused = document.activeElement;
      if (!focused || focused === document.body || !focused.isConnected)
        scrollRef.current?.focus({ preventScroll: true });
    }
    wasEditing.current = editing;
  }, [editingCell, scrollRef]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey) return;
      const root = rootRef.current;
      const target = e.target instanceof HTMLElement ? e.target : null;
      const owned = target
        ? root?.contains(target) || (target === document.body && lastGrid === root)
        : false;
      if (!root || !owned) return;
      if (target?.closest("[data-draft-row], [data-draft-controls]")) return;
      const mod = IS_MAC ? e.metaKey : e.ctrlKey;
      if (IS_MAC ? e.ctrlKey : e.metaKey) return;

      const lastRow = rows.length - 1;
      const lastCol = visibleDataColumns.length - 1;

      if (editingCell) {
        if (mod) return;
        if (e.key === "Escape") {
          setEditingCell(null);
          return;
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          void handleSaveCell();
          return;
        }
        if (e.key === "Tab") {
          e.preventDefault();
          const colIndex = visibleDataColumns.indexOf(editingCell.columnId);
          const flat = Math.min(
            rows.length * (lastCol + 1) - 1,
            Math.max(0, editingCell.rowIndex * (lastCol + 1) + colIndex + (e.shiftKey ? -1 : 1)),
          );
          const cell = {
            rowIndex: Math.floor(flat / (lastCol + 1)),
            columnId: visibleDataColumns[flat % (lastCol + 1)],
          };
          void handleSaveCell().then((ok) => {
            if (ok && cell.columnId) focusCell(cell);
          });
        }
        return;
      }

      if (target?.closest(BLOCKING_TARGET) || target?.isContentEditable) return;
      if (!activeCell || lastRow < 0 || lastCol < 0) return;
      const { rowIndex, columnId } = activeCell;
      const colIndex = visibleDataColumns.indexOf(columnId);
      const move = (row: number, col: number, extend = e.shiftKey) => {
        e.preventDefault();
        const nextRow = Math.min(lastRow, Math.max(0, row));
        const nextColumnId = visibleDataColumns[Math.min(lastCol, Math.max(0, col))];
        if (nextRow !== rowIndex || nextColumnId !== columnId)
          focusCell({ rowIndex: nextRow, columnId: nextColumnId }, extend);
      };

      if (mod) {
        if (e.key === "a" || e.key === "A") {
          e.preventDefault();
          setExtraCells([]);
          setSelectionAnchor({ rowIndex: lastRow, columnId: visibleDataColumns[lastCol] });
          setActiveCell({ rowIndex: 0, columnId: visibleDataColumns[0] });
        } else if (e.key === "ArrowUp") move(0, colIndex);
        else if (e.key === "ArrowDown") move(lastRow, colIndex);
        else if (e.key === "ArrowLeft") move(rowIndex, 0);
        else if (e.key === "ArrowRight") move(rowIndex, lastCol);
        else if (e.key === "Home") move(0, 0);
        else if (e.key === "End") move(lastRow, lastCol);
        return;
      }

      if (e.key === "Escape") {
        if (selectedCount > 1) {
          setExtraCells([]);
          setSelectionAnchor(activeCell);
          return;
        }
        if (target === document.body || target === scrollRef.current) {
          setActiveCell(null);
          setSelectionAnchor(null);
        } else scrollRef.current?.focus({ preventScroll: true });
        return;
      }

      const editable = onSaveRow && columnId !== INDEX_COLUMN;
      const row = rows[rowIndex];
      if ((e.key === "Enter" || e.key === "F2") && !e.shiftKey && editable) {
        e.preventDefault();
        if (row) handleCellEdit(row, columnId);
        return;
      }
      if (editable && row && e.key.length === 1 && e.key !== " " && target?.tagName !== "BUTTON") {
        e.preventDefault();
        handleCellEdit(row, columnId, e.key);
        return;
      }

      if (e.key === "ArrowUp") move(rowIndex - 1, colIndex);
      else if (e.key === "ArrowDown") move(rowIndex + 1, colIndex);
      else if (e.key === "ArrowLeft") move(rowIndex, colIndex - 1);
      else if (e.key === "ArrowRight") move(rowIndex, colIndex + 1);
      else if (e.key === "Home") move(rowIndex, 0);
      else if (e.key === "End") move(rowIndex, lastCol);
      else if (e.key === "Tab") {
        const flat = rowIndex * (lastCol + 1) + Math.max(0, colIndex) + (e.shiftKey ? -1 : 1);
        const bounded = Math.min(rows.length * (lastCol + 1) - 1, Math.max(0, flat));
        if (bounded !== flat) return;
        move(Math.floor(bounded / (lastCol + 1)), bounded % (lastCol + 1), false);
      } else if (e.key === "PageUp" || e.key === "PageDown") {
        const scroller = scrollRef.current;
        const rowHeight = rowVirtualizer.options.estimateSize(0) || 24;
        const pageRows = scroller ? Math.max(1, Math.floor(scroller.clientHeight / rowHeight)) : 10;
        move(rowIndex + (e.key === "PageDown" ? pageRows : -pageRows), colIndex);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    rootRef,
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
    selectedCount,
    rowVirtualizer,
    scrollRef,
  ]);
}
