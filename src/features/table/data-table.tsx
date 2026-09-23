import { DragDropProvider } from "@dnd-kit/react";
import { isSortable } from "@dnd-kit/react/sortable";
import { reorderVisibleColumns } from "@/lib/table-column-prefs";
import { cn } from "@/lib/utils";
import { headerSensors } from "./data-table/constants";
import { DataTableBody } from "./data-table/data-table-body";
import { DataTableCellDialogs } from "./data-table/data-table-cell-dialogs";
import { DataTableDraftControls } from "./data-table/data-table-draft-controls";
import { DataTableFooter } from "./data-table/data-table-footer";
import { DataTableSearchBar } from "./data-table/data-table-search-bar";
import { useDataTable } from "./data-table/use-data-table";
import { DataTableDraftRow } from "./data-table-draft-row";
import type { DataTableProps } from "./data-table-types";
import { PageWave } from "./page-wave";

export function DataTable(props: DataTableProps) {
  const {
    columns: columnNames,
    data,
    emptyMessage,
    className,
    isFetching = false,
    onSaveRow,
    canEditCell,
    cellEditorKind,
    page = 0,
    totalCount,
    countLabel,
    onExactCount,
    pageSize = 100,
    onPageChange,
    foreignKeys,
    currentSchema,
    currentTable,
    onInsertRow,
    onDeleteRow,
    onRefresh,
    columnDetails,
  } = props;
  const {
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
  } = useDataTable(props);
  return (
    <div ref={rootRef} className={cn("flex min-h-0 flex-1 flex-col relative", className)}>
      {isFetching && (
        <div className="absolute top-0 left-0 right-0 z-50 h-0.5 w-full bg-primary/20 overflow-hidden">
          <div className="h-full w-1/3 bg-primary animate-pulse rounded-full" />
        </div>
      )}
      {hasEphemeralMarkers && (
        <p role="status" className="border-b px-3 py-1 text-xs text-muted-foreground">
          Ohne stabilen Zeilenschlüssel bleiben Markierungen nur bis zum nächsten Laden erhalten.
        </p>
      )}
      {search.searchOpen && (
        <DataTableSearchBar
          search={search}
          loadedRowCount={data.length}
          visibleColumnCount={searchColumns.length}
        />
      )}
      {draft && (
        <DataTableDraftControls
          isInserting={isInserting}
          insertError={drafts.insertError}
          onDiscard={() => {
            setDraft(null);
            setInsertError(null);
          }}
          onSave={() => void drafts.saveDraft()}
        />
      )}
      <div className="relative flex min-h-0 flex-1 basis-0 flex-col">
        <div
          ref={scrollRef}
          style={{ contain: "strict" }}
          className={cn(
            "relative min-h-0 flex-1 basis-0 overflow-auto overscroll-none [scrollbar-gutter:stable] transition-opacity",
            isFetching && "opacity-85",
            table.getState().columnSizingInfo.isResizingColumn && "cursor-col-resize select-none",
          )}
        >
          <div className="pb-3">
            <DragDropProvider
              sensors={headerSensors}
              onDragEnd={(event) => {
                const { operation, canceled } = event;
                if (canceled || !isSortable(operation.source)) return;
                const source = operation.source;
                if (source.initialIndex === source.index) return;
                setOrder(reorderVisibleColumns(order, hidden, source.initialIndex, source.index));
              }}
            >
              <table
                className="min-w-full border-separate border-spacing-0 text-sm table-fixed"
                style={{ width: tableWidth }}
              >
                <colgroup>
                  {visibleColumns.map((column, index) => (
                    <col key={column.id} style={{ width: columnWidths[index] }} />
                  ))}
                </colgroup>
                {tableHeader}
                {draft && (
                  <tbody ref={draftRef}>
                    <DataTableDraftRow
                      columns={visibleColumns}
                      fields={draft}
                      disabled={isInserting}
                      onChange={setDraft}
                    />
                  </tbody>
                )}
                <DataTableBody
                  activeCell={activeCell}
                  activeMatch={activeMatch}
                  canPickFk={canPickFk}
                  colSpan={colSpan}
                  columnOrder={columnOrder}
                  columnPinning={columnPinning}
                  columnScale={columnScale}
                  columnVisibility={columnVisibility}
                  columnWindow={columnWindow}
                  columns={columns}
                  commitEditingCell={commitEditingCell}
                  customCellColumns={customCellColumns}
                  editingCell={editingCell}
                  focusCell={focusCell}
                  handleCellEdit={handleCellEdit}
                  hasDraft={hasDraft}
                  hasRowActions={hasRowActions}
                  isSaving={isSaving}
                  markedRows={markedRows}
                  matchKeys={matchKeys}
                  menuRow={menuRow}
                  outgoingFkByColumn={outgoingFkByColumn}
                  paddingBottom={paddingBottom}
                  paddingTop={paddingTop}
                  rowVirtualizer={rowVirtualizer}
                  rows={rows}
                  scrollRef={scrollRef}
                  selectedCount={selectedCount}
                  selectedKeys={selectedKeys}
                  setActiveCell={setActiveCell}
                  setDraft={setDraft}
                  setEditingCell={setEditingCell}
                  setFkPickerCell={setFkPickerCell}
                  setInsertError={setInsertError}
                  setInspectCell={setInspectCell}
                  setMenuRow={setMenuRow}
                  setSelectionAnchor={setSelectionAnchor}
                  table={table}
                  tbodyRef={tbodyRef}
                  toggleRowMarker={toggleRowMarker}
                  uiScale={uiScale}
                  virtualRows={virtualRows}
                  visibleColumns={visibleColumns}
                  columnNames={columnNames}
                  emptyMessage={emptyMessage}
                  onSaveRow={onSaveRow}
                  canEditCell={canEditCell}
                  page={page}
                  pageSize={pageSize}
                  onInsertRow={onInsertRow}
                  onDeleteRow={onDeleteRow}
                  columnDetails={columnDetails}
                />
              </table>
            </DragDropProvider>
          </div>
        </div>
        <PageWave
          direction="up"
          ref={waveRefs.up}
          className="pointer-events-none absolute inset-x-0 top-9 z-50 opacity-0"
        />
        <PageWave
          direction="down"
          ref={waveRefs.down}
          className="pointer-events-none absolute inset-x-0 bottom-0 z-50 opacity-0"
        />
      </div>
      {rows.length > 0 && (
        <DataTableFooter
          rowCount={rows.length}
          page={page}
          pageSize={pageSize}
          totalCount={totalCount}
          countLabel={countLabel}
          onExactCount={onExactCount}
          hasNextPage={hasNextPage}
          selectionStats={selectionStats}
          isFetching={isFetching}
          activeSort={activeSort}
          canEdit={!!onSaveRow}
          onRefresh={onRefresh}
          autoRefreshMs={autoRefreshMs}
          autoRefreshPause={autoRefreshPause}
          onAutoRefreshChange={setAutoRefreshMs}
          onPageChange={onPageChange}
        />
      )}
      <DataTableCellDialogs
        inspectCell={inspectCell}
        setInspectCell={setInspectCell}
        fkPickerCell={fkPickerCell}
        setFkPickerCell={setFkPickerCell}
        columnTypeByName={columnTypeByName}
        cellEditorKind={cellEditorKind}
        onSaveRow={onSaveRow}
        canEditCell={canEditCell}
        isSaving={isSaving}
        saveCellValue={saveCellValue}
        foreignKeys={foreignKeys}
        currentSchema={currentSchema}
        currentTable={currentTable}
        columnDetails={columnDetails}
      />
    </div>
  );
}
