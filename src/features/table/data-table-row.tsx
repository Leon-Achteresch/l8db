import type {
  Column,
  ColumnDef,
  ColumnPinningState,
  ColumnSizingState,
  Row,
  Table,
  VisibilityState,
} from "@tanstack/react-table";
import { type Dispatch, memo, type SetStateAction } from "react";
import type { ForeignKeyInfo } from "@/lib/db";
import { gridMatchKey } from "@/lib/grid-search";
import { type GridCellRef, isCellInSelection, type selectionRange } from "@/lib/grid-selection";
import type { ColumnWindowItem } from "@/lib/hooks/use-column-window";
import { cn } from "@/lib/utils";
import { DataTableCell } from "./data-table-cell";
import type {
  DataTableProps,
  EditingCell,
  FkPickerCell,
  InspectCell,
  TableRow,
} from "./data-table-types";

export type DataTableRowProps = {
  row: Row<TableRow>;
  table: Table<TableRow>;
  visibleColumns: Column<TableRow>[];
  customCellColumns: Set<string>;
  isMarked: boolean;
  toggleRowMarker: (row: TableRow) => void;
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
  canEditCell: DataTableProps["canEditCell"];
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
  fontSize: number;
  columnScale: number;
};

export const DataTableRow = memo(function DataTableRow({
  row,
  table,
  visibleColumns,
  customCellColumns,
  isMarked,
  toggleRowMarker,
  pageOffset,
  fontSize,
  columnScale,
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
  canEditCell,
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
  return (
    <tr
      ref={measureElement}
      data-index={rowIndex}
      data-row-index={rowIndex}
      data-ctid={rowCtid}
      data-marked={isMarked || undefined}
      className={cn(
        "group/row",
        isMarked
          ? "bg-primary/10"
          : isRowEditing
            ? "bg-primary/[0.03]"
            : "bg-background hover:bg-muted/15",
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
        const column = visibleColumns[cellIndex];
        const columnId = column.id;
        const isCellEditing = isRowEditing && editingCell?.columnId === columnId;
        const isActive =
          !isRowEditing && activeCell?.rowIndex === rowIndex && activeCell.columnId === columnId;
        const pinnedOffset =
          cellIndex > 0 && column.getIsPinned() === "left" ? column.getStart("left") : null;
        const isSelected =
          selectedCount > 1 && isCellInSelection(selectedRange, rowIndex, columnId);
        const isMatch = matchKeys.has(gridMatchKey(rowIndex, columnId));
        const isActiveMatch =
          activeMatch?.rowIndex === rowIndex && activeMatch.columnId === columnId;

        return (
          <DataTableCell
            key={columnId}
            row={row}
            isMarked={isMarked}
            toggleRowMarker={toggleRowMarker}
            pageOffset={pageOffset}
            fontSize={fontSize}
            isSaving={isSaving}
            canPickFk={canPickFk}
            onSaveRow={onSaveRow}
            canEditCell={canEditCell}
            focusCell={focusCell}
            handleCellEdit={handleCellEdit}
            handleCellCopy={handleCellCopy}
            setEditingCell={setEditingCell}
            setInspectCell={setInspectCell}
            setFkPickerCell={setFkPickerCell}
            editingCell={isCellEditing ? editingCell : null}
            table={table}
            column={column}
            hasCustomContent={customCellColumns.has(columnId)}
            cellIndex={cellIndex}
            width={column.getSize()}
            previewWidth={column.getSize() * columnScale}
            pinnedOffset={pinnedOffset}
            isActive={isActive}
            isSelected={isSelected}
            isMatch={isMatch}
            isActiveMatch={isActiveMatch}
            hasOutgoingFk={outgoingFkByColumn.has(columnId)}
          />
        );
      })}
    </tr>
  );
});
