import {
  type ColumnDef,
  type ColumnPinningState,
  type ColumnSizingState,
  flexRender,
  type Row,
  type VisibilityState,
} from "@tanstack/react-table";
import { CopyIcon, LinkIcon, Maximize2Icon } from "lucide-react";
import { type Dispatch, memo, type SetStateAction } from "react";
import { isLargeCellValue, valueToUpdateText } from "@/lib/cell-editor";
import type { ForeignKeyInfo } from "@/lib/db";
import { gridMatchKey } from "@/lib/grid-search";
import { type GridCellRef, isCellInSelection, type selectionRange } from "@/lib/grid-selection";
import type { ColumnWindowItem } from "@/lib/hooks/use-column-window";
import { cn } from "@/lib/utils";
import type {
  DataTableProps,
  EditingCell,
  FkPickerCell,
  InspectCell,
  TableRow,
} from "./data-table-types";

type DataTableRowProps = {
  row: Row<TableRow>;
  columnWindow: ColumnWindowItem[];
  measureElement: (element: HTMLTableRowElement | null) => void;
  editingCell: EditingCell | null;
  activeCell: GridCellRef | null;
  activeMatch: GridCellRef | null;
  selectedRange: ReturnType<typeof selectionRange>;
  selectedCount: number;
  matchKeys: Set<string>;
  isSaving: boolean;
  canPickFk: boolean;
  outgoingFkByColumn: Map<string, ForeignKeyInfo>;
  onSaveRow: DataTableProps["onSaveRow"];
  focusCell: (cell: GridCellRef | null, extend?: boolean) => void;
  handleCellEdit: (row: Row<TableRow>, columnId: string) => void;
  handleCellCopy: (value: unknown) => void;
  setEditingCell: Dispatch<SetStateAction<EditingCell | null>>;
  setInspectCell: Dispatch<SetStateAction<InspectCell | null>>;
  setFkPickerCell: Dispatch<SetStateAction<FkPickerCell | null>>;
  columnSizing: ColumnSizingState;
  columnOrder: string[];
  columnVisibility: VisibilityState;
  columnPinning: ColumnPinningState;
  columns: ColumnDef<TableRow>[];
  pageOffset: number;
};

export const DataTableRow = memo(function DataTableRow({
  row,
  columnWindow,
  measureElement,
  editingCell,
  activeCell,
  activeMatch,
  selectedRange,
  selectedCount,
  matchKeys,
  isSaving,
  canPickFk,
  outgoingFkByColumn,
  onSaveRow,
  focusCell,
  handleCellEdit,
  handleCellCopy,
  setEditingCell,
  setInspectCell,
  setFkPickerCell,
}: DataTableRowProps) {
  const rowIndex = row.index;
  const rowCtid = row.original.__ctid__ as string | undefined;
  const isRowEditing = !!rowCtid && editingCell?.ctid === rowCtid;
  const cells = row.getVisibleCells();
  return (
    <tr
      ref={measureElement}
      data-index={rowIndex}
      data-row-index={rowIndex}
      data-ctid={rowCtid}
      className={cn(
        "group/row",
        isRowEditing ? "bg-primary/[0.03]" : "bg-background hover:bg-muted/15",
      )}
    >
      {columnWindow.map((item) => {
        if (item.spacer)
          return (
            <td
              key={`gap-${item.index}`}
              aria-hidden
              colSpan={item.span}
              style={{ width: item.width, padding: 0 }}
            />
          );
        const cellIndex = item.index;
        const cell = cells[cellIndex];
        const columnId = cell.column.id;
        const value = cellIndex > 0 ? row.getValue(columnId) : undefined;
        const isCellEditing = isRowEditing && editingCell?.columnId === columnId;
        const isActive =
          !isRowEditing && activeCell?.rowIndex === rowIndex && activeCell.columnId === columnId;
        const pinnedOffset =
          cellIndex > 0 && cell.column.getIsPinned() === "left"
            ? cell.column.getStart("left")
            : null;
        const isSelected =
          selectedCount > 1 && isCellInSelection(selectedRange, rowIndex, columnId);
        const isMatch = matchKeys.has(gridMatchKey(rowIndex, columnId));
        const isActiveMatch =
          activeMatch?.rowIndex === rowIndex && activeMatch.columnId === columnId;

        if (isCellEditing && editingCell) {
          return (
            <td
              key={cell.id}
              style={{ width: cell.column.getSize() }}
              className="px-0 py-0 align-top border-b border-r border-primary/40 relative overflow-visible bg-primary/[0.04]"
            >
              <div className="flex flex-col">
                <input
                  type="text"
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
            key={cell.id}
            onClick={(event) => {
              setEditingCell(null);
              focusCell({ rowIndex, columnId }, event.shiftKey && columnId !== "__row_index__");
            }}
            onDoubleClick={
              onSaveRow && cellIndex > 0
                ? (e) => {
                    e.stopPropagation();
                    handleCellEdit(row, columnId);
                  }
                : undefined
            }
            data-row-index={rowIndex}
            data-col={cellIndex > 0 ? columnId : undefined}
            style={{
              width: cell.column.getSize(),
              left: pinnedOffset ?? undefined,
            }}
            className={cn(
              "px-3 py-1.5 align-middle border-b border-r border-border/30 select-text relative cursor-default text-left overflow-hidden",
              cellIndex === 0 &&
                "w-12 border-r border-border sticky left-0 z-10 bg-muted/40 group-hover/row:bg-muted/65 text-center text-muted-foreground/50 select-none font-mono text-xs",
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
            <div className="relative flex items-center justify-between gap-2 w-full h-5 text-left">
              <div className="min-w-0 flex-1 truncate text-left">
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </div>
              {isActive && cellIndex > 0 && (
                <div className="absolute right-0 flex items-center gap-0.5 bg-background/90 backdrop-blur-xs pl-1 py-0.5 rounded shadow-sm border border-border/80 z-20">
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
                  {(isLargeCellValue(value) || (!!onSaveRow && !!rowCtid)) && (
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
                      title={onSaveRow ? "Anzeigen / bearbeiten" : "Anzeigen"}
                      className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                    >
                      <Maximize2Icon className="size-3" />
                    </button>
                  )}
                  {canPickFk && !!rowCtid && outgoingFkByColumn.has(columnId) && (
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
            </div>
          </td>
        );
      })}
    </tr>
  );
});
