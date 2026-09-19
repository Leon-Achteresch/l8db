import { useHotkey } from "@tanstack/react-hotkeys";
import type { Row } from "@tanstack/react-table";
import { type RefObject, useCallback } from "react";
import { toast } from "sonner";
import { copyText } from "@/lib/clipboard";
import type { GridCellRef } from "@/lib/grid-selection";
import { useResolvedHotkey } from "@/lib/hotkeys";
import { useWorkspacePane } from "@/lib/workspace-pane";
import type { EditingCell, TableRow } from "../data-table-types";
import { INDEX_COLUMN } from "./constants";

type Options = {
  rootRef: RefObject<HTMLDivElement | null>;
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchRequiresFocus: boolean;
  activeCell: GridCellRef | null;
  setSearchOpen: (open: boolean) => void;
  copySelection: () => boolean;
  rows: Row<TableRow>[];
  selectedCount: number;
  editingCell: EditingCell | null;
  onPageChange: ((page: number) => void) | undefined;
  totalCount: number | undefined;
  pageSize: number;
  page: number;
};

export function useGridHotkeys({
  rootRef,
  searchInputRef,
  searchRequiresFocus,
  activeCell,
  setSearchOpen,
  copySelection,
  rows,
  selectedCount,
  editingCell,
  onPageChange,
  totalCount,
  pageSize,
  page,
}: Options) {
  const pane = useWorkspacePane();
  const gridSearchHotkey = useResolvedHotkey("grid.search");
  const gridCopyHotkey = useResolvedHotkey("grid.copy");
  const gridNextPageHotkey = useResolvedHotkey("grid.nextPage");
  const gridPrevPageHotkey = useResolvedHotkey("grid.prevPage");

  useHotkey(
    gridSearchHotkey,
    (event) => {
      const root = rootRef.current;
      const focusInside = root?.contains(document.activeElement) ?? false;
      const paneOpen = !searchRequiresFocus && (pane === null || pane.focused);
      if (!focusInside && activeCell === null && !paneOpen) return;
      event.preventDefault();
      setSearchOpen(true);
      requestAnimationFrame(() => searchInputRef.current?.select());
    },
    { ignoreInputs: false },
  );

  const copyActiveCell = useCallback(() => {
    if (!activeCell) return;
    const { rowIndex, columnId } = activeCell;
    if (copySelection()) return;
    if (columnId === INDEX_COLUMN) return;
    const row = rows[rowIndex];
    const val = row?.getValue(columnId);
    if (val !== undefined) {
      const stringVal = typeof val === "object" ? JSON.stringify(val, null, 2) : String(val);
      void copyText(stringVal);
      toast.success("Wert in die Zwischenablage kopiert!");
    }
  }, [activeCell, copySelection, rows]);

  useHotkey(
    gridCopyHotkey,
    (event) => {
      const root = rootRef.current;
      const focusInside = root?.contains(document.activeElement) ?? false;
      if (!focusInside && activeCell === null) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (target && target !== document.body && !root?.contains(target)) return;
      if (selectedCount <= 1 && window.getSelection()?.toString()) return;
      if (editingCell) return;
      event.preventDefault();
      copyActiveCell();
    },
    { ignoreInputs: false, preventDefault: false, stopPropagation: false },
  );

  useHotkey(
    gridNextPageHotkey,
    (event) => {
      if (!onPageChange || totalCount == null) return;
      const root = rootRef.current;
      if (!(root?.contains(document.activeElement) ?? false)) return;
      const totalPages = Math.ceil(totalCount / pageSize);
      if (page >= totalPages - 1) return;
      event.preventDefault();
      onPageChange(page + 1);
    },
    { ignoreInputs: false },
  );

  useHotkey(
    gridPrevPageHotkey,
    (event) => {
      if (!onPageChange) return;
      const root = rootRef.current;
      if (!(root?.contains(document.activeElement) ?? false)) return;
      if (page <= 0) return;
      event.preventDefault();
      onPageChange(page - 1);
    },
    { ignoreInputs: false },
  );
}
