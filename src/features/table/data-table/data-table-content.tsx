import { DragDropProvider } from "@dnd-kit/react";
import { type CSSProperties, memo, useId, useMemo, useState } from "react";
import { gridColumnTemplate } from "@/lib/column-window";
import { useScrollingFlag } from "@/lib/hooks/use-scrolling-flag";
import { useSpiderVisit } from "@/lib/hooks/use-spider-visit";
import { markNewFeatureSeen } from "@/lib/new-features";
import { reorderVisibleColumns } from "@/lib/table-column-prefs";
import { cn } from "@/lib/utils";
import { DataTableDraftRow } from "../data-table-draft-row";
import type { DataTableProps, TableRow } from "../data-table-types";
import { PageWave } from "../page-wave";
import { headerSensors, INDEX_COLUMN } from "./constants";
import { DataTableBody } from "./data-table-body";
import { DataTableCellDialogs } from "./data-table-cell-dialogs";
import { DataTableDraftControls } from "./data-table-draft-controls";
import { DataTableFooter } from "./data-table-footer";
import { DataTableRecordDialog } from "./data-table-record-dialog";
import { DataTableSearchBar } from "./data-table-search-bar";
import { EditTargetContext } from "./edit-target-context";
import { GridStyleContext } from "./grid-style-context";
import { useColumnDragPreview } from "./use-column-drag-preview";
import { useDataTable } from "./use-data-table";

type LoadedRecord = {
  original: TableRow;
  rowIndex: number;
  rowOffset: number;
  scope: string;
  origin: HTMLElement | null;
};

export const DataTableContent = memo(function DataTableContent(props: DataTableProps) {
  const {
    columns: columnNames,
    data,
    emptyMessage,
    className,
    isFetching = false,
    onSaveRow,
    canEditCell,
    cellEditorKind,
    totalCount,
    countLabel,
    onExactCount,
    pageSize = 100,
    rowExtent,
    foreignKeys,
    currentSchema,
    currentTable,
    onInsertRow,
    onDeleteRow,
    onRefresh,
    columnDetails,
  } = props;
  const {
    infinite,
    rowOffset,
    navPage,
    changePage,
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
    gridStyle,
    handleCellEdit,
    hasDraft,
    hasEphemeralMarkers,
    hasRowActions,
    hidden,
    inspectCell,
    isInserting,
    isSaving,
    keepColumn,
    markedRows,
    matchesByRow,
    menuRow,
    order,
    outgoingFkByColumn,
    paddingBottom,
    paddingTop,
    rootRef,
    measureRow,
    rows,
    saveCellValue,
    scrollRef,
    search,
    searchColumns,
    selectedByRow,
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
  const [record, setRecord] = useState<LoadedRecord | null>(null);
  const recordScope = props.stateKey ?? JSON.stringify([currentSchema, currentTable]);
  const recordColumns = useMemo(
    () => columnNames.filter((name) => name !== INDEX_COLUMN && name !== "__ctid__"),
    [columnNames],
  );
  const canInspectRecord = !!props.recordView && recordColumns.length > 0;
  if (
    record &&
    (!canInspectRecord ||
      record.scope !== recordScope ||
      record.rowOffset !== rowOffset ||
      rows[record.rowIndex]?.original !== record.original)
  ) {
    setRecord(null);
  }
  const openRecord = (
    { rowIndex, original }: Pick<LoadedRecord, "rowIndex" | "original">,
    origin: HTMLElement | null,
  ) => {
    if (rows[rowIndex]?.original !== original) return false;
    setRecord({ rowIndex, original, rowOffset, scope: recordScope, origin });
    return true;
  };
  useSpiderVisit(scrollRef, columnNames, data);
  useScrollingFlag(scrollRef);
  const columnScope = useId();
  const gridColumns = useMemo(() => gridColumnTemplate(columnWidths), [columnWidths]);
  const dragPreview = useColumnDragPreview({
    scope: columnScope,
    scrollRef,
    visibleColumns,
    columnWidths,
    onMove: (from, to) => setOrder(reorderVisibleColumns(order, hidden, from, to)),
  });
  const editTarget = useMemo(
    () =>
      currentSchema !== undefined && currentTable
        ? { schema: currentSchema, table: currentTable }
        : null,
    [currentSchema, currentTable],
  );
  return (
    <EditTargetContext.Provider value={editTarget}>
      <GridStyleContext.Provider value={gridStyle}>
        <div
          ref={rootRef}
          data-tour="data-grid"
          className={cn("flex min-h-0 flex-1 flex-col relative", className)}
        >
          {isFetching && (
            <div className="absolute top-0 left-0 right-0 z-50 h-0.5 w-full bg-primary/20 overflow-hidden">
              <div className="h-full w-1/3 bg-primary animate-pulse rounded-full" />
            </div>
          )}
          {hasEphemeralMarkers && (
            <p role="status" className="border-b px-3 py-1 text-xs text-muted-foreground">
              Ohne stabilen Zeilenschlüssel bleiben Markierungen nur bis zum nächsten Laden
              erhalten.
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
              data-grid-scroll
              tabIndex={0}
              role="grid"
              aria-label="Daten"
              onKeyDown={(event) => {
                if (!canInspectRecord || !activeCell || editingCell) return;
                if (
                  event.target !== event.currentTarget ||
                  event.defaultPrevented ||
                  event.repeat ||
                  event.nativeEvent.isComposing ||
                  event.key !== "Enter" ||
                  !event.altKey ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey
                )
                  return;
                const row = rows[activeCell.rowIndex];
                if (!row) return;
                event.preventDefault();
                markNewFeatureSeen("table.rows.record-view");
                openRecord({ rowIndex: row.index, original: row.original }, event.currentTarget);
              }}
              style={{ contain: "strict" }}
              className={cn(
                "@container relative min-h-0 flex-1 basis-0 overflow-auto overscroll-none outline-none bg-background [scrollbar-gutter:stable] transition-opacity",
                isFetching && "opacity-85",
                table.getState().columnSizingInfo.isResizingColumn &&
                  "cursor-col-resize select-none",
              )}
            >
              <div className="w-max min-w-full bg-background pb-3">
                <DragDropProvider
                  sensors={headerSensors}
                  onDragStart={(event) => {
                    const id = event.operation.source?.id;
                    if (id === undefined) return;
                    keepColumn(String(id));
                    dragPreview.start(String(id));
                  }}
                  onDragMove={(event) =>
                    dragPreview.update(
                      event.to
                        ? event.to.x - event.operation.position.initial.x
                        : event.operation.transform.x,
                    )
                  }
                  onDragEnd={(event) => {
                    dragPreview.end(event.canceled);
                    keepColumn(null);
                  }}
                >
                  <style ref={dragPreview.styleRef} />
                  <table
                    data-column-scope={columnScope}
                    data-grid-layout={columnWindow.enabled || undefined}
                    role={columnWindow.enabled ? "table" : undefined}
                    aria-colcount={columnWindow.enabled ? columnWidths.length : undefined}
                    className="min-w-full border-separate border-spacing-0 text-sm table-fixed"
                    style={
                      columnWindow.enabled
                        ? ({ width: tableWidth, "--grid-columns": gridColumns } as CSSProperties)
                        : { width: tableWidth }
                    }
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
                      matchesByRow={matchesByRow}
                      menuRow={menuRow}
                      outgoingFkByColumn={outgoingFkByColumn}
                      paddingBottom={paddingBottom}
                      paddingTop={paddingTop}
                      measureRow={measureRow}
                      rows={rows}
                      scrollRef={scrollRef}
                      selectedByRow={selectedByRow}
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
                      stateKey={props.stateKey}
                      watchScope={props.watchScope}
                      emptyMessage={emptyMessage}
                      onSaveRow={onSaveRow}
                      canEditCell={canEditCell}
                      rowOffset={rowOffset}
                      onInsertRow={onInsertRow}
                      onDeleteRow={onDeleteRow}
                      rowMenuItems={props.rowMenuItems}
                      columnDetails={columnDetails}
                      currentSchema={props.currentSchema}
                      currentTable={props.currentTable}
                      onInspectRecord={canInspectRecord ? openRecord : undefined}
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
              infinite={infinite}
              rowCount={
                infinite
                  ? Math.max(0, Math.min(pageSize, (rowExtent ?? 0) - navPage * pageSize))
                  : rows.length
              }
              page={navPage}
              rowOffset={rowOffset}
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
              onPageChange={changePage}
            />
          )}
          {record && (
            <DataTableRecordDialog
              original={record.original}
              columns={recordColumns}
              columnTypeByName={columnTypeByName}
              rowNumber={record.rowOffset + record.rowIndex + 1}
              onClose={() => setRecord(null)}
              returnFocus={() => {
                const grid = scrollRef.current;
                if (!grid?.isConnected) return;
                const target = record.origin && grid.contains(record.origin) ? record.origin : grid;
                target.focus({ preventScroll: true });
              }}
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
            data={data}
          />
        </div>
      </GridStyleContext.Provider>
    </EditTargetContext.Provider>
  );
});
