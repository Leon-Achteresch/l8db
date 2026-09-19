import type { Column } from "@tanstack/react-table";
import type { Virtualizer } from "@tanstack/react-virtual";
import { animate } from "motion/react";
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
} from "react";
import type { GridCellRef } from "@/lib/grid-selection";
import type { EditingCell, TableRow } from "../data-table-types";

type Options = {
  activeCell: GridCellRef | null;
  setActiveCell: Dispatch<SetStateAction<GridCellRef | null>>;
  setSelectionAnchor: Dispatch<SetStateAction<GridCellRef | null>>;
  editingCell: EditingCell | null;
  rowVirtualizer: Virtualizer<HTMLDivElement, Element>;
  columnWindow: { enabled: boolean; virtualizer: Virtualizer<HTMLDivElement, Element> };
  visibleColumns: Column<TableRow, unknown>[];
  columnWidths: number[];
  pinnedIndices: number[];
  scrollRef: RefObject<HTMLDivElement | null>;
  tbodyRef: RefObject<HTMLTableSectionElement | null>;
  revealColumn: { name: string; nonce: number } | null | undefined;
  activeColumnMatch: string | null;
  activeMatch: { rowIndex: number; columnId: string } | null;
};

export function useGridScrolling({
  activeCell,
  setActiveCell,
  setSelectionAnchor,
  editingCell,
  rowVirtualizer,
  columnWindow,
  visibleColumns,
  columnWidths,
  pinnedIndices,
  scrollRef,
  tbodyRef,
  revealColumn,
  activeColumnMatch,
  activeMatch,
}: Options) {
  const previousActiveCell = useRef(activeCell);
  useEffect(() => {
    if (previousActiveCell.current === activeCell) return;
    previousActiveCell.current = activeCell;
    if (!activeCell) return;
    rowVirtualizer.scrollToIndex(activeCell.rowIndex, { align: "auto" });
    const columnIndex = visibleColumns.findIndex((column) => column.id === activeCell.columnId);
    if (columnWindow.enabled && columnIndex >= 0 && !pinnedIndices.includes(columnIndex)) {
      columnWindow.virtualizer.scrollToIndex(columnIndex, { align: "auto" });
    }
  }, [
    activeCell,
    rowVirtualizer,
    columnWindow.enabled,
    columnWindow.virtualizer,
    visibleColumns,
    pinnedIndices,
  ]);

  const layoutRef = useRef({ visibleColumns, columnWidths, pinnedIndices });
  layoutRef.current = { visibleColumns, columnWidths, pinnedIndices };

  useEffect(() => {
    if (!editingCell || !tbodyRef.current) return;
    rowVirtualizer.scrollToIndex(editingCell.rowIndex, { align: "auto" });
    requestAnimationFrame(() => {
      const tbody = tbodyRef.current;
      if (!tbody) return;
      const tr = Array.from(tbody.children).find(
        (child) => child instanceof HTMLTableRowElement && child.dataset.ctid === editingCell.ctid,
      );
      if (tr instanceof HTMLTableRowElement) {
        tr.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    });
  }, [editingCell]);

  const scrollToColumnHeader = useCallback((name: string) => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const { visibleColumns, columnWidths, pinnedIndices } = layoutRef.current;
    const index = visibleColumns.findIndex((column) => column.id === name);
    if (index < 0) return;
    const pinnedWidth = pinnedIndices.reduce((sum, i) => sum + columnWidths[i], 0);
    const left = columnWidths.slice(0, index).reduce((sum, width) => sum + width, 0);
    const viewport = scroller.clientWidth - pinnedWidth;
    const target = Math.max(0, left - pinnedWidth - (viewport - columnWidths[index]) / 2);
    const controls = animate(scroller.scrollLeft, target, {
      duration: 0.45,
      ease: "easeInOut",
      onUpdate: (value) => {
        scroller.scrollLeft = value;
      },
      onComplete: () => {
        const id = CSS.escape(name);
        const flash = "inset 0 0 0 999px color-mix(in srgb, var(--primary) 30%, transparent)";
        for (const cell of scroller.querySelectorAll(
          `th[data-column-id="${id}"], td[data-col="${id}"]`,
        )) {
          cell.animate([{ boxShadow: flash }, { boxShadow: "inset 0 0 0 999px transparent" }], {
            duration: 400,
            iterations: 3,
            easing: "ease-out",
          });
        }
      },
    });
    return () => controls.stop();
  }, []);

  useEffect(() => {
    if (!revealColumn) return;
    return scrollToColumnHeader(revealColumn.name);
  }, [revealColumn, scrollToColumnHeader]);

  useEffect(() => {
    if (!activeColumnMatch) return;
    return scrollToColumnHeader(activeColumnMatch);
  }, [activeColumnMatch, scrollToColumnHeader]);

  useEffect(() => {
    if (!activeMatch) return;
    const matchCell = { rowIndex: activeMatch.rowIndex, columnId: activeMatch.columnId };
    setActiveCell(matchCell);
    setSelectionAnchor(matchCell);
    const tbody = tbodyRef.current;
    if (!tbody) return;
    const cell = Array.from(tbody.querySelectorAll<HTMLTableCellElement>("td[data-col]")).find(
      (element) =>
        element.dataset.rowIndex === String(activeMatch.rowIndex) &&
        element.dataset.col === activeMatch.columnId,
    );
    cell?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeMatch]);
}
