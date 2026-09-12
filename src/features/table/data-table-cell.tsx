import { type Column, createCell, flexRender } from "@tanstack/react-table";
import { CopyIcon, LinkIcon, Maximize2Icon } from "lucide-react";
import { memo, useMemo } from "react";
import { isLargeCellValue, valueToUpdateText } from "@/lib/cell-editor";
import { cellPreviewLimit, tableCellPreview } from "@/lib/table-cell-preview";
import { cn } from "@/lib/utils";
import type { DataTableRowProps } from "./data-table-row";
import type { TableRow } from "./data-table-types";

const VALUE_CLASSES = {
  null: "text-red-600 dark:text-red-400",
  true: "text-emerald-600 dark:text-emerald-400",
  false: "text-rose-600 dark:text-rose-400",
  number: "text-emerald-600 dark:text-emerald-400 tabular-nums",
  object: "text-purple-600 dark:text-purple-400",
  date: "text-rose-600 dark:text-rose-400",
  uuid: "text-amber-600 dark:text-amber-400",
  text: "text-foreground/90",
};

const focusEditInput = (el: HTMLInputElement | null) => {
  el?.focus();
  el?.select();
};

type DataTableCellProps = Pick<
  DataTableRowProps,
  | "row"
  | "table"
  | "isMarked"
  | "toggleRowMarker"
  | "pageOffset"
  | "fontSize"
  | "editingCell"
  | "isSaving"
  | "canPickFk"
  | "onSaveRow"
  | "canEditCell"
  | "focusCell"
  | "handleCellEdit"
  | "handleCellCopy"
  | "setEditingCell"
  | "setInspectCell"
  | "setFkPickerCell"
> & {
  column: Column<TableRow>;
  hasCustomContent: boolean;
  cellIndex: number;
  width: number;
  previewWidth: number;
  pinnedOffset: number | null;
  isActive: boolean;
  isSelected: boolean;
  isMatch: boolean;
  isActiveMatch: boolean;
  hasOutgoingFk: boolean;
};

export const DataTableCell = memo(function DataTableCell({
  row,
  isMarked,
  toggleRowMarker,
  pageOffset,
  fontSize,
  editingCell,
  isSaving,
  canPickFk,
  onSaveRow,
  canEditCell,
  focusCell,
  handleCellEdit,
  handleCellCopy,
  setEditingCell,
  setInspectCell,
  setFkPickerCell,
  table,
  column,
  hasCustomContent,
  cellIndex,
  width,
  previewWidth,
  pinnedOffset,
  isActive,
  isSelected,
  isMatch,
  isActiveMatch,
  hasOutgoingFk,
}: DataTableCellProps) {
  const cell = useMemo(
    () => (hasCustomContent ? createCell(table, row, column, column.id) : null),
    [table, row, column, hasCustomContent],
  );
  const rowIndex = row.index;
  const rowCtid = row.original.__ctid__ as string | undefined;
  const columnId = column.id;
  const editable = !!onSaveRow && (!canEditCell || canEditCell(row.original, columnId));
  const value = cellIndex > 0 ? row.getValue(columnId) : undefined;
  const preview = useMemo(
    () => tableCellPreview(value, cellPreviewLimit(previewWidth, fontSize)),
    [value, previewWidth, fontSize],
  );
  const isCellEditing = !!editingCell;
  if (isCellEditing && editingCell) {
    return (
      <td
        style={{ width }}
        className="px-0 py-0 align-top border-b border-r border-primary/40 relative overflow-visible bg-primary/[0.04]"
      >
        <div className="flex flex-col">
          <input
            type="text"
            ref={focusEditInput}
            value={editingCell.value}
            onChange={(e) =>
              setEditingCell((prev) => (prev ? { ...prev, value: e.target.value } : prev))
            }
            disabled={isSaving}
            placeholder="NULL"
            className="w-full min-w-0 h-8 px-3 bg-transparent font-mono text-[13px] text-foreground outline-none border-0 focus:ring-0 placeholder:text-muted-foreground/35 disabled:opacity-60"
          />
          <div className="flex items-center gap-3 border-t border-border/40 px-3 py-1 text-[11px] text-muted-foreground select-none">
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border bg-muted/80 px-1 py-px font-mono text-[10px] leading-none">
                ↵
              </kbd>
              <span>Speichern</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border bg-muted/80 px-1 py-px font-mono text-[10px] leading-none">
                esc
              </kbd>
              <span>Abbrechen</span>
            </span>
          </div>
        </div>
      </td>
    );
  }

  return (
    <td
      onClick={(event) => {
        if (cellIndex === 0) {
          toggleRowMarker(row.original);
          return;
        }
        const extend = event.shiftKey;
        if (
          isActive &&
          !extend &&
          editable &&
          cellIndex > 0 &&
          (window.getSelection()?.isCollapsed ?? true)
        ) {
          handleCellEdit(row, columnId);
          return;
        }
        setEditingCell(null);
        focusCell({ rowIndex, columnId }, extend);
      }}
      onDoubleClick={
        editable && cellIndex > 0
          ? (e) => {
              e.stopPropagation();
              handleCellEdit(row, columnId);
            }
          : undefined
      }
      data-row-index={rowIndex}
      data-col={cellIndex > 0 ? columnId : undefined}
      style={{
        width,
        left: pinnedOffset ?? undefined,
        lineHeight: "1.25rem",
        whiteSpace: "nowrap",
        textOverflow: "ellipsis",
      }}
      className={cn(
        "px-3 py-[var(--ui-cell-padding)] align-middle border-b border-r border-border/30 select-text relative cursor-default text-left overflow-hidden font-mono text-xs",
        cellIndex > 0 && VALUE_CLASSES[preview.kind],
        cellIndex === 0 &&
          "w-12 border-r border-border sticky left-0 z-10 bg-muted/40 group-hover/row:bg-muted/65 text-center text-muted-foreground/50 select-none font-mono text-xs",
        cellIndex === 0 && isMarked && "bg-primary/15 text-primary group-hover/row:bg-primary/20",
        pinnedOffset !== null &&
          "sticky z-10 bg-inherit border-r border-border shadow-[1px_0_0_0_var(--border)]",
        isSelected && "bg-primary/10",
        isMatch && "bg-amber-400/15",
        isActiveMatch &&
          "bg-amber-400/30 outline outline-2 -outline-offset-2 outline-amber-500 z-20",
        isActive &&
          "bg-primary/[0.03] outline outline-2 outline-inset -outline-offset-2 outline-primary/70 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.1)] z-10",
        !isActive && cellIndex > 0 && "hover:bg-muted/10",
      )}
    >
      {cellIndex === 0 ? (
        <button
          type="button"
          aria-label={`Zeile ${rowIndex + 1 + pageOffset} markieren`}
          aria-pressed={isMarked}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") event.stopPropagation();
          }}
          title="Zeile markieren / Markierung aufheben"
          className="block h-5 w-full cursor-pointer text-center tabular-nums focus-visible:outline-2 focus-visible:outline-ring"
          onClick={(event) => {
            event.stopPropagation();
            toggleRowMarker(row.original);
          }}
        >
          {rowIndex + 1 + pageOffset}
        </button>
      ) : cell ? (
        flexRender(cell.column.columnDef.cell, cell.getContext())
      ) : (
        preview.text
      )}
      {isActive && cellIndex > 0 && (
        <div className="absolute top-1/2 right-1 -translate-y-1/2 flex items-center gap-0.5 bg-background/90 backdrop-blur-xs pl-1 py-0.5 rounded shadow-sm border border-border/80 z-20">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleCellCopy(value);
            }}
            title="Kopieren"
            className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            <CopyIcon className="size-3" />
          </button>
          {(isLargeCellValue(value) || (editable && !!rowCtid)) && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setInspectCell({
                  columnName: columnId,
                  value,
                  ctid: rowCtid,
                  originalValues: { ...row.original },
                });
              }}
              title={editable ? "Anzeigen / bearbeiten" : "Anzeigen"}
              className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
            >
              <Maximize2Icon className="size-3" />
            </button>
          )}
          {canPickFk && !!rowCtid && hasOutgoingFk && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setFkPickerCell({
                  columnName: columnId,
                  ctid: rowCtid,
                  originalValues: { ...row.original },
                  currentValue: valueToUpdateText(value),
                });
              }}
              title="Fremdschlüsselwert wählen"
              className="p-0.5 rounded text-muted-foreground hover:text-blue-500 hover:bg-muted transition-colors cursor-pointer"
            >
              <LinkIcon className="size-3" />
            </button>
          )}
        </div>
      )}
    </td>
  );
});
