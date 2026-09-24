import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { buildDuplicatePrefill } from "@/lib/row-duplicate";
import { DataTableRow } from "../data-table-row";
import type { DataTableProps } from "../data-table-types";
import { copyCellValue } from "./copy-cell-value";
import { DataTableRowMenu } from "./data-table-row-menu";
import type { useDataTable } from "./use-data-table";

type Props = Pick<
  ReturnType<typeof useDataTable>,
  | "activeCell"
  | "activeMatch"
  | "canPickFk"
  | "colSpan"
  | "columnOrder"
  | "columnPinning"
  | "columnScale"
  | "columnVisibility"
  | "columnWindow"
  | "columns"
  | "commitEditingCell"
  | "customCellColumns"
  | "editingCell"
  | "focusCell"
  | "handleCellEdit"
  | "hasDraft"
  | "hasRowActions"
  | "isSaving"
  | "markedRows"
  | "matchKeys"
  | "menuRow"
  | "outgoingFkByColumn"
  | "paddingBottom"
  | "paddingTop"
  | "rowVirtualizer"
  | "rows"
  | "scrollRef"
  | "selectedCount"
  | "selectedKeys"
  | "setActiveCell"
  | "setDraft"
  | "setEditingCell"
  | "setFkPickerCell"
  | "setInsertError"
  | "setInspectCell"
  | "setMenuRow"
  | "setSelectionAnchor"
  | "table"
  | "tbodyRef"
  | "toggleRowMarker"
  | "uiScale"
  | "virtualRows"
  | "visibleColumns"
> &
  Pick<
    DataTableProps,
    "emptyMessage" | "onSaveRow" | "canEditCell" | "onInsertRow" | "onDeleteRow" | "columnDetails"
  > & {
    columnNames: string[];
    page: number;
    pageSize: number;
  };

export function DataTableBody({
  activeCell,
  activeMatch,
  canPickFk,
  colSpan,
  columnOrder,
  columnPinning,
  columnScale,
  columnVisibility,
  columnWindow,
  columns,
  commitEditingCell,
  customCellColumns,
  editingCell,
  focusCell,
  handleCellEdit,
  hasDraft,
  hasRowActions,
  isSaving,
  markedRows,
  matchKeys,
  menuRow,
  outgoingFkByColumn,
  paddingBottom,
  paddingTop,
  rowVirtualizer,
  rows,
  scrollRef,
  selectedCount,
  selectedKeys,
  setActiveCell,
  setDraft,
  setEditingCell,
  setFkPickerCell,
  setInsertError,
  setInspectCell,
  setMenuRow,
  setSelectionAnchor,
  table,
  tbodyRef,
  toggleRowMarker,
  uiScale,
  virtualRows,
  visibleColumns,
  columnNames,
  emptyMessage,
  onSaveRow,
  canEditCell,
  page,
  pageSize,
  onInsertRow,
  onDeleteRow,
  columnDetails,
}: Props) {
  return (
    <ContextMenu onOpenChange={(open) => !open && setMenuRow(null)}>
      <ContextMenuTrigger asChild highlight={false}>
        <tbody
          ref={tbodyRef}
          onContextMenuCapture={(event) => {
            const tr = (event.target as HTMLElement).closest<HTMLTableRowElement>("tr[data-ctid]");
            const ctid = tr?.dataset.ctid;
            const row = ctid ? rows[Number(tr?.dataset.rowIndex)] : undefined;
            if (!ctid || !row || !hasRowActions) {
              event.stopPropagation();
              return;
            }
            setMenuRow({ ctid, rowIndex: row.index, original: row.original });
          }}
        >
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={colSpan}
                className="px-3 py-16 text-center text-muted-foreground bg-background"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            <>
              {paddingTop > 0 && (
                <tr aria-hidden style={{ height: paddingTop }}>
                  <td colSpan={colSpan} className="p-0" />
                </tr>
              )}
              {virtualRows.map((virtualRow) => {
                const row = rows[virtualRow.index];
                const rowIndex = row.index;
                const rowCtid = row.original.__ctid__ as string | undefined;
                return (
                  <DataTableRow
                    key={rowCtid ?? row.id}
                    row={row}
                    table={table}
                    visibleColumns={visibleColumns}
                    customCellColumns={customCellColumns}
                    isMarked={markedRows.has(row.original)}
                    isContextMenuTarget={!!menuRow && menuRow.ctid === rowCtid}
                    toggleRowMarker={toggleRowMarker}
                    columnWindow={columnWindow.items}
                    measureElement={rowVirtualizer.measureElement}
                    editingCell={editingCell?.rowIndex === rowIndex ? editingCell : null}
                    activeCell={activeCell?.rowIndex === rowIndex ? activeCell : null}
                    activeMatch={activeMatch?.rowIndex === rowIndex ? activeMatch : null}
                    selectedKeys={selectedKeys}
                    selectedCount={selectedCount}
                    matchKeys={matchKeys}
                    isSaving={isSaving}
                    canPickFk={canPickFk}
                    outgoingFkByColumn={outgoingFkByColumn}
                    onSaveRow={onSaveRow}
                    canEditCell={canEditCell}
                    focusCell={focusCell}
                    handleCellEdit={handleCellEdit}
                    handleCellCopy={copyCellValue}
                    setEditingCell={setEditingCell}
                    commitEditingCell={commitEditingCell}
                    setInspectCell={setInspectCell}
                    setFkPickerCell={setFkPickerCell}
                    columnSizing={table.getState().columnSizing}
                    columnOrder={columnOrder}
                    columnVisibility={columnVisibility}
                    columnPinning={columnPinning}
                    columns={columns}
                    pageOffset={page * pageSize}
                    fontSize={(12 * uiScale) / 100}
                    columnScale={columnScale}
                  />
                );
              })}
              {paddingBottom > 0 && (
                <tr aria-hidden style={{ height: paddingBottom }}>
                  <td colSpan={colSpan} className="p-0" />
                </tr>
              )}
            </>
          )}
        </tbody>
      </ContextMenuTrigger>
      {menuRow && (
        <DataTableRowMenu
          menuRow={menuRow}
          rowOffset={page * pageSize}
          columns={visibleColumns
            .map((column) => column.id)
            .filter((id) => id !== "__row_index__")}
          canDuplicate={!!onInsertRow}
          duplicateDisabled={hasDraft || isSaving}
          onDuplicate={() => {
            setEditingCell(null);
            setActiveCell(null);
            setSelectionAnchor(null);
            setInsertError(null);
            setDraft(buildDuplicatePrefill(columnNames, menuRow.original, columnDetails));
            scrollRef.current?.scrollTo({ top: 0, left: 0 });
          }}
          onDeleteRow={onDeleteRow}
        />
      )}
    </ContextMenu>
  );
}
