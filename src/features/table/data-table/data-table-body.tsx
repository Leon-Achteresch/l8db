import { useContext, useMemo, useRef } from "react";
import { toast } from "sonner";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { useActiveConnection } from "@/lib/connections";
import { useActiveCapabilities } from "@/lib/db-selection";
import { useTableViewState } from "@/lib/hooks/use-table-view-state";
import { buildDuplicatePrefill } from "@/lib/row-duplicate";
import { rowRuleColor } from "@/lib/row-rules";
import { useSettingsStore } from "@/lib/settings";
import { RowWatchContext } from "@/lib/workbench/row-watch-context";
import { saveRowWatch } from "@/lib/workbench/row-watches";
import { DataTableRow } from "../data-table-row";
import type { DataTableProps } from "../data-table-types";
import { copyCellValue } from "./copy-cell-value";
import { DataTableRowMenu, type MenuRow } from "./data-table-row-menu";
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
  | "matchesByRow"
  | "menuRow"
  | "outgoingFkByColumn"
  | "paddingBottom"
  | "paddingTop"
  | "measureRow"
  | "rows"
  | "scrollRef"
  | "selectedByRow"
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
    | "watchScope"
    | "emptyMessage"
    | "onSaveRow"
    | "canEditCell"
    | "onInsertRow"
    | "onDeleteRow"
    | "rowMenuItems"
    | "columnDetails"
    | "currentSchema"
    | "currentTable"
  > & {
    columnNames: string[];
    stateKey?: string;
    rowOffset: number;
    onInspectRecord?: (row: MenuRow, origin: HTMLElement | null) => boolean;
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
  matchesByRow,
  menuRow,
  outgoingFkByColumn,
  paddingBottom,
  paddingTop,
  measureRow,
  rows,
  scrollRef,
  selectedByRow,
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
  rowOffset,
  onInsertRow,
  onDeleteRow,
  rowMenuItems,
  columnDetails,
  stateKey,
  watchScope,
  currentSchema,
  currentTable,
  onInspectRecord,
}: Props) {
  const connection = useActiveConnection();
  const caps = useActiveCapabilities();
  const monochromeCells = useSettingsStore((state) => state.monochromeCells);
  const [rules] = useTableViewState(stateKey, "rowRules", []);
  const { changedRows } = useContext(RowWatchContext);
  const primaryKeys = useMemo(
    () =>
      (columnDetails ?? []).filter((column) => column.is_primary_key).map((column) => column.name),
    [columnDetails],
  );
  const menuOrigin = useRef<HTMLElement | null>(null);

  return (
    <ContextMenu eager onOpenChange={(open) => !open && setMenuRow(null)}>
      <ContextMenuTrigger asChild highlight={false}>
        <tbody
          ref={tbodyRef}
          role={columnWindow.enabled ? "rowgroup" : undefined}
          onContextMenuCapture={(event) => {
            const tr = (event.target as HTMLElement).closest<HTMLTableRowElement>(
              "tr[data-row-index]",
            );
            const row = tr && rows[Number(tr.dataset.rowIndex)];
            const ctid = tr?.dataset.ctid;
            if (
              !row ||
              (!onInspectRecord && (!ctid || (!hasRowActions && !watchScope && !currentTable)))
            ) {
              event.stopPropagation();
              return;
            }
            const focused = document.activeElement;
            menuOrigin.current =
              focused instanceof HTMLElement && scrollRef.current?.contains(focused)
                ? focused
                : null;
            setMenuRow({ ctid, rowIndex: row.index, original: row.original });
          }}
        >
          {rows.length === 0 ? (
            <tr>
              <td colSpan={colSpan} className="bg-background p-0 text-muted-foreground">
                <div className="sticky left-0 w-[100cqw] px-3 py-16 text-center">
                  {emptyMessage}
                </div>
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
                    monochromeCells={monochromeCells}
                    isMarked={markedRows.has(row.original)}
                    ruleColor={
                      (rules.length ? rowRuleColor(row.original, rules) : undefined) ??
                      (changedRows.has(row.original) ? "var(--primary)" : undefined)
                    }
                    isContextMenuTarget={menuRow?.original === row.original}
                    toggleRowMarker={toggleRowMarker}
                    columnWindow={columnWindow.items}
                    gridLayout={columnWindow.enabled}
                    measureElement={measureRow}
                    editingCell={editingCell?.rowIndex === rowIndex ? editingCell : null}
                    activeCell={activeCell?.rowIndex === rowIndex ? activeCell : null}
                    activeMatch={activeMatch?.rowIndex === rowIndex ? activeMatch : null}
                    selectedColumns={selectedByRow.get(rowIndex)}
                    matchColumns={matchesByRow.get(rowIndex)}
                    isSaving={isSaving}
                    canPickFk={canPickFk}
                    outgoingFkByColumn={outgoingFkByColumn}
                    canSave={!!onSaveRow}
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
                    pageOffset={rowOffset}
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
          selectedRows={
            markedRows.has(menuRow.original)
              ? rows.map((row) => row.original).filter((row) => markedRows.has(row))
              : [menuRow.original]
          }
          insertTarget={
            currentTable && caps.query_language !== "redis" && caps.query_language !== "json"
              ? {
                  schema: currentSchema,
                  table: currentTable,
                  columns: columnNames,
                  kind: connection?.kind,
                }
              : undefined
          }
          rowOffset={rowOffset}
          columns={visibleColumns.map((column) => column.id).filter((id) => id !== "__row_index__")}
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
          onInspectRecord={
            onInspectRecord ? () => onInspectRecord(menuRow, menuOrigin.current) : undefined
          }
          extraItems={menuRow.ctid ? rowMenuItems?.(menuRow.original) : undefined}
          onWatch={
            watchScope && primaryKeys.length
              ? () => {
                  void saveRowWatch(watchScope, menuRow.original, primaryKeys, columnNames)
                    .then(() => toast.success("Datensatz wird beobachtet"))
                    .catch((error) => toast.error(String(error)));
                }
              : undefined
          }
        />
      )}
    </ContextMenu>
  );
}
