import { useReactTable } from "@tanstack/react-table";
import { useMemo, useRef, useState } from "react";
import { useActiveConnection } from "@/lib/connections";
import { useActiveCapabilities, useActiveDatabase } from "@/lib/db-selection";
import { useRowMarkers } from "@/lib/hooks/use-row-markers";
import { useTableColumnLayout } from "@/lib/table-column-prefs";
import { getVirtualRowModel } from "@/lib/virtual-row-model";
import type { DataTableProps, FkPickerCell, InspectCell } from "../data-table-types";
import type { MenuRow } from "./data-table-row-menu";
import { useColumnFilter } from "./use-column-filter";
import { useColumnLayoutState } from "./use-column-layout-state";
import { useColumnSizing } from "./use-column-sizing";
import { useDataTableColumns } from "./use-data-table-columns";
import { useDraftRow } from "./use-draft-row";
import { useForeignKeyMaps } from "./use-foreign-key-maps";
import { useGridActiveCell } from "./use-grid-active-cell";
import { useGridSearch } from "./use-grid-search";
import { useRowVirtualizer } from "./use-row-virtualizer";
import { useVisibleColumns } from "./use-visible-columns";
export function useDataTableModel({
  stateKey,
  layoutKey,
  scrollIdentity = "",
  columns: columnNames,
  data,
  sorting,
  sortableColumns,
  onSortingChange,
  isFetching = false,
  onSaveRow,
  onApplyFilter,
  compileColumnFilter,
  page = 0,
  pageSize = 100,
  foreignKeys,
  currentSchema,
  currentTable,
  onNavigateToTable,
  onInsertRow,
  onDeleteRow,
  columnDetails,
  autoSelectFirstCell = false,
}: DataTableProps) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const capabilities = useActiveCapabilities();
  const layout = useTableColumnLayout(
    connection?.id,
    currentSchema,
    currentTable,
    columnNames,
    database,
    layoutKey,
  );
  const { order, hidden, pinned, setOrder } = layout;
  const markerKeys = useMemo(
    () =>
      (columnDetails ?? []).filter((column) => column.is_primary_key).map((column) => column.name),
    [columnDetails],
  );
  const { markedRows, toggleRowMarker, hasEphemeralMarkers } = useRowMarkers(
    data,
    stateKey ?? JSON.stringify([connection?.id, database, currentSchema, currentTable]),
    markerKeys,
  );
  const [activeCell, setActiveCell] = useGridActiveCell(data, columnNames, autoSelectFirstCell);
  const [inspectCell, setInspectCell] = useState<InspectCell | null>(null);
  const [fkPickerCell, setFkPickerCell] = useState<FkPickerCell | null>(null);
  const drafts = useDraftRow(onInsertRow);
  const { draft, setDraft, setInsertError, isInserting, draftRef, draftHeight, hasDraft } = drafts;
  const filter = useColumnFilter(onApplyFilter, compileColumnFilter, connection, columnDetails);
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const { fkByColumn, outgoingFkByColumn, customCellColumns } = useForeignKeyMaps(
    foreignKeys,
    currentSchema,
    currentTable,
    onNavigateToTable,
  );
  const canPickFk = !!onSaveRow && capabilities.foreign_keys && !!currentSchema && !!currentTable;
  const { columns, typeInfoByColumn } = useDataTableColumns({
    columnNames,
    data,
    columnDetails,
    isFetching,
    page,
    pageSize,
    fkByColumn,
    onNavigateToTable,
    currentSchema,
    currentTable,
    sortableColumns,
  });
  const { columnOrder, columnVisibility, searchColumns, columnPinning, pinnedSet } =
    useColumnLayoutState(order, hidden, pinned);
  const search = useGridSearch(data, searchColumns);
  const { matchKeys, activeMatch, activeColumnMatch } = search;
  const { savedColumnSizing, setColumnSizing, columnSizing } = useColumnSizing(
    stateKey,
    order,
    fkByColumn,
    typeInfoByColumn,
  );
  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnOrder,
      columnVisibility,
      columnPinning,
      columnSizing,
    },
    onColumnSizingChange: setColumnSizing,
    onSortingChange,
    manualSorting: true,
    columnResizeMode: "onChange",
    getRowId: (row, index) => {
      const ctid = row.__ctid__ as string | undefined;
      return ctid ?? `row-${index}`;
    },
    getCoreRowModel: getVirtualRowModel(),
  });

  const rows = table.getRowModel().rows;
  const { uiScale, rowVirtualizer, virtualRows, paddingTop, paddingBottom } = useRowVirtualizer(
    rows,
    draftHeight,
    scrollRef,
    stateKey,
    scrollIdentity,
  );
  const tableWidth = table.getTotalSize();
  const columnScale = Math.max(1, (rowVirtualizer.scrollRect?.width ?? 0) / tableWidth);
  const hasRowActions = !!onInsertRow || !!onDeleteRow;
  const [menuRow, setMenuRow] = useState<MenuRow | null>(null);
  const colSpan = table.getVisibleLeafColumns().length || 1;
  const activeSort = sorting[0];
  const { visibleColumns, visibleDataColumns, columnWidths, pinnedIndices, columnWindow } =
    useVisibleColumns(table, columnSizing, columnPinning, scrollRef);
  return {
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
  };
}
