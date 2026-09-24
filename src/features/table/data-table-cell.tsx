import { type Column, createCell, flexRender } from "@tanstack/react-table";
import { CopyIcon, LinkIcon, Maximize2Icon } from "lucide-react";
import { memo, useMemo } from "react";
import { isLargeCellValue, valueToUpdateText } from "@/lib/cell-editor";
import { useSettingsStore } from "@/lib/settings";
import { cellPreviewLimit, tableCellPreview } from "@/lib/table-cell-preview";
import { cn } from "@/lib/utils";
import { DataTableEditingCell } from "./data-table-cell/data-table-editing-cell";
import { VALUE_CLASSES } from "./data-table-cell/value-classes";
import type { DataTableRowProps } from "./data-table-row";
import type { TableRow } from "./data-table-types";

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
  | "commitEditingCell"
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
  commitEditingCell,
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
  const monochromeCells = useSettingsStore((state) => state.monochromeCells);
  const preview = useMemo(
    () => tableCellPreview(value, cellPreviewLimit(previewWidth, fontSize)),
    [value, previewWidth, fontSize],
  );
  const isCellEditing = !!editingCell;
  if (isCellEditing && editingCell) {
    return (
      <DataTableEditingCell
        editingCell={editingCell}
        isSaving={isSaving}
        setEditingCell={setEditingCell}
        commitEditingCell={commitEditingCell}
        width={width}
      />
    );
  }

  const isSticky = cellIndex === 0 || pinnedOffset !== null;
  const stickyTint = isActiveMatch
    ? "rgb(251 191 36 / 0.3)"
    : isMatch
      ? "rgb(251 191 36 / 0.15)"
      : isSelected
        ? "color-mix(in oklab, var(--primary) 10%, transparent)"
        : isActive
          ? "color-mix(in oklab, var(--primary) 3%, transparent)"
          : cellIndex === 0
            ? isMarked
              ? "color-mix(in oklab, var(--primary) 15%, transparent)"
              : "color-mix(in oklab, var(--muted) 40%, transparent)"
            : "transparent";

  return (
    <td
      onMouseDown={(event) => {
        if (event.shiftKey || event.ctrlKey || event.metaKey) event.preventDefault();
      }}
      onClick={(event) => {
        if (cellIndex === 0) {
          toggleRowMarker(row.original);
          return;
        }
        const extend = event.shiftKey;
        const additive = !extend && (event.ctrlKey || event.metaKey);
        if (
          isActive &&
          !extend &&
          !additive &&
          editable &&
          cellIndex > 0 &&
          (window.getSelection()?.isCollapsed ?? true)
        ) {
          handleCellEdit(row, columnId);
          return;
        }
        setEditingCell(null);
        if (extend || additive) window.getSelection()?.removeAllRanges();
        focusCell({ rowIndex, columnId }, extend, additive);
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
        ...(isSticky ? { "--cell-tint": stickyTint } : null),
      }}
      className={cn(
        "px-3 py-[var(--ui-cell-padding)] align-middle border-b border-r border-border/30 select-text relative cursor-default text-left overflow-hidden font-mono text-xs",
        cellIndex > 0 &&
          (monochromeCells
            ? cn("text-foreground", preview.kind === "number" && "tabular-nums")
            : VALUE_CLASSES[preview.kind]),
        cellIndex === 0 &&
          "w-12 border-r border-border sticky left-0 z-10 text-center text-muted-foreground/50 select-none font-mono text-xs",
        cellIndex === 0 && isMarked && "text-primary",
        pinnedOffset !== null &&
          "sticky z-10 border-r border-border shadow-[1px_0_0_0_var(--border)]",
        isSticky &&
          cn(
            "after:pointer-events-none after:absolute after:inset-0 after:-z-10 after:bg-[var(--cell-tint)]",
            isMarked
              ? "bg-[color-mix(in_oklab,var(--primary)_10%,var(--background))]"
              : "bg-background row-hover:bg-[color-mix(in_oklab,var(--muted)_15%,var(--background))]",
          ),
        !isSticky && isSelected && "bg-primary/10",
        !isSticky && isMatch && "bg-amber-400/15",
        isActiveMatch &&
          cn(
            "outline outline-2 -outline-offset-2 outline-amber-500",
            !isSticky && "z-2 bg-amber-400/30",
          ),
        isActive &&
          cn(
            "outline outline-2 outline-inset -outline-offset-2 outline-primary/70 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.1)]",
            !isSticky && "z-1 bg-primary/[0.03]",
          ),
        !isActive && cellIndex > 0 && !isSticky && "hover:bg-muted/10",
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
