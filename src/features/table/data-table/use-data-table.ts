import { useEffect, useMemo, useRef } from "react";
import { buildEmptyPrefill } from "@/lib/row-duplicate";
import type { DataTableProps } from "../data-table-types";
import { useAutoRefresh } from "./use-auto-refresh";
import { useCellEditing } from "./use-cell-editing";
import { useColumnActions } from "./use-column-actions";
import { useDataTableModel } from "./use-data-table-model";
import { useGridHotkeys } from "./use-grid-hotkeys";
import { useGridKeyboard } from "./use-grid-keyboard";
import { useGridScrolling } from "./use-grid-scrolling";
import { useGridSelection } from "./use-grid-selection";
import { usePageFlip } from "./use-page-flip";
import { useTableHeader } from "./use-table-header";

export function useDataTable(props: DataTableProps) {
  const {
    columns: columnNames,
    data,
    sorting,
    onSortingChange,
    isFetching = false,
    onSaveRow,
    onApplyFilter,
    canEditCell,
    filterableColumns,
    filterOperators,
    filterPrefix,
    emptyEditValue,
    page = 0,
    totalCount,
    countLabel,
    pageSize = 100,
    onPageChange,
    onRefresh,
    columnDetails,
    revealColumn,
    searchRequiresFocus = false,
    addRowSignal,
  } = props;
  const {
    connection,
    layout,
    drafts,
    filter,
    tbodyRef,
    scrollRef,
    rootRef,
    canPickFk,
    search,
    table,
    rows,
    tableWidth,
    columnScale,
    hasRowActions,
    colSpan,
    activeSort,
    order,
    hidden,
    setOrder,
    markedRows,
    toggleRowMarker,
    hasEphemeralMarkers,
    draft,
    setDraft,
    setInsertError,
    isInserting,
    draftRef,
    hasDraft,
    fkByColumn,
    outgoingFkByColumn,
    customCellColumns,
    columns,
    typeInfoByColumn,
    columnOrder,
    columnVisibility,
    searchColumns,
    columnPinning,
    pinnedSet,
    matchKeys,
    activeMatch,
    activeColumnMatch,
    savedColumnSizing,
    setColumnSizing,
    columnSizing,
    uiScale,
    rowVirtualizer,
    virtualRows,
    paddingTop,
    paddingBottom,
    visibleColumns,
    visibleDataColumns,
    columnWidths,
    pinnedIndices,
    columnWindow,
    activeCell,
    setActiveCell,
    inspectCell,
    setInspectCell,
    fkPickerCell,
    setFkPickerCell,
    menuRow,
    setMenuRow,
  } = useDataTableModel(props);
  const {
    setSelectionAnchor,
    setExtraCells,
    selectedCount,
    selectedKeys,
    selectionStats,
    focusCell,
    copySelection,
  } = useGridSelection(activeCell, setActiveCell, visibleDataColumns, data);
  const {
    editingCell,
    setEditingCell,
    isSaving,
    saveCellValue,
    handleSaveCell,
    commitEditingCell,
    handleCellEdit,
  } = useCellEditing({ onSaveRow, columnNames, emptyEditValue, canEditCell, setActiveCell });
  const openDraftRef = useRef<() => void>(() => {});
  openDraftRef.current = () => {
    setEditingCell(null);
    setActiveCell(null);
    setSelectionAnchor(null);
    setInsertError(null);
    setDraft(buildEmptyPrefill(columnNames, columnDetails));
    scrollRef.current?.scrollTo({ top: 0, left: 0 });
  };
  useEffect(() => {
    if (addRowSignal) openDraftRef.current();
  }, [addRowSignal]);
  useGridScrolling({
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
  });
  const columnTypeByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const col of columnDetails ?? []) map.set(col.name, col.data_type);
    return map;
  }, [columnDetails]);

  const { autoRefreshMs, setAutoRefreshMs, autoRefreshPause } = useAutoRefresh({
    connection,
    onRefresh,
    hasDraft,
    editingCell,
    inspectCell,
    fkPickerCell,
    isSaving,
    isFetching,
  });
  const columnActions = useColumnActions({
    order,
    hidden,
    setHidden: layout.setHidden,
    savedColumnSizing,
    setColumnSizing,
    fkByColumn,
    typeInfoByColumn,
  });
  const hasNextPage =
    totalCount != null
      ? page < Math.ceil(totalCount / pageSize) - 1
      : countLabel !== undefined && data.length >= pageSize;
  useGridHotkeys({
    rootRef,
    searchInputRef: search.searchInputRef,
    searchRequiresFocus,
    activeCell,
    setSearchOpen: search.setSearchOpen,
    copySelection,
    rows,
    selectedCount,
    editingCell,
    onPageChange,
    hasNextPage,
    page,
  });
  const waveRefs = usePageFlip(scrollRef, page, hasNextPage, onPageChange);
  useGridKeyboard({
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
  });

  const tableHeader = useTableHeader({
    headerGroups: table.getHeaderGroups(),
    columnWindow,
    columnSizing,
    resizingColumn: table.getState().columnSizingInfo.isResizingColumn,
    columnPinning,
    typeInfoByColumn,
    layout,
    columnActions,
    filter,
    visibleDataColumns,
    isFetching,
    sorting,
    onSortingChange,
    onApplyFilter,
    filterableColumns,
    filterOperators,
    filterPrefix,
    pinnedSet,
  });

  return {
    hasNextPage,
    activeCell,
    activeMatch,
    activeSort,
    autoRefreshMs,
    autoRefreshPause,
    canPickFk,
    colSpan,
    columnOrder,
    columnPinning,
    columnScale,
    columnSizing,
    columnTypeByName,
    columnVisibility,
    columnWidths,
    columnWindow,
    columns,
    commitEditingCell,
    customCellColumns,
    draft,
    draftRef,
    drafts,
    editingCell,
    fkPickerCell,
    focusCell,
    handleCellEdit,
    hasDraft,
    hasEphemeralMarkers,
    hasRowActions,
    hidden,
    inspectCell,
    isInserting,
    isSaving,
    markedRows,
    matchKeys,
    menuRow,
    order,
    outgoingFkByColumn,
    paddingBottom,
    paddingTop,
    rootRef,
    rowVirtualizer,
    rows,
    saveCellValue,
    scrollRef,
    search,
    searchColumns,
    selectedCount,
    selectedKeys,
    selectionStats,
    setActiveCell,
    setAutoRefreshMs,
    setDraft,
    setEditingCell,
    setFkPickerCell,
    setInsertError,
    setInspectCell,
    setMenuRow,
    setOrder,
    setSelectionAnchor,
    table,
    tableHeader,
    tableWidth,
    tbodyRef,
    toggleRowMarker,
    uiScale,
    virtualRows,
    visibleColumns,
    waveRefs,
  };
}
