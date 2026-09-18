import type { Row } from "@tanstack/react-table";
import { type Dispatch, type SetStateAction, useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { buildRowUpdates } from "@/lib/cell-editor";
import type { GridCellRef } from "@/lib/grid-selection";
import type { DataTableProps, EditingCell, TableRow } from "../data-table-types";

type Options = {
  onSaveRow: DataTableProps["onSaveRow"];
  columnNames: string[];
  emptyEditValue: string | undefined;
  canEditCell: DataTableProps["canEditCell"];
  setActiveCell: Dispatch<SetStateAction<GridCellRef | null>>;
};

export function useCellEditing({
  onSaveRow,
  columnNames,
  emptyEditValue,
  canEditCell,
  setActiveCell,
}: Options) {
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const saveCellValue = useCallback(
    async (
      ctid: string,
      columnId: string,
      originalValues: Record<string, unknown>,
      next: string | null,
    ) => {
      if (!onSaveRow) return false;
      setIsSaving(true);
      try {
        const updates = buildRowUpdates(columnNames, originalValues, columnId, next);
        await onSaveRow(ctid, updates, originalValues);
        toast.success("Zeile gespeichert.");
        return true;
      } catch (err) {
        toast.error(typeof err === "string" ? err : String(err));
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [onSaveRow, columnNames],
  );

  const handleSaveCell = useCallback(async () => {
    if (!editingCell || !onSaveRow || isSaving) return;
    const ok = await saveCellValue(
      editingCell.ctid,
      editingCell.columnId,
      editingCell.originalValues,
      editingCell.value === "" ? (emptyEditValue ?? null) : editingCell.value,
    );
    if (ok) setEditingCell(null);
  }, [editingCell, onSaveRow, isSaving, saveCellValue, emptyEditValue]);
  const handleSaveCellRef = useRef(handleSaveCell);
  handleSaveCellRef.current = handleSaveCell;
  const commitEditingCell = useCallback(() => void handleSaveCellRef.current(), []);

  const handleCellEdit = useCallback(
    (row: Row<TableRow>, columnId: string) => {
      const ctid = row.original.__ctid__ as string | undefined;
      if (!ctid || (canEditCell && !canEditCell(row.original, columnId))) return;
      const val = row.original[columnId];
      let value: string;
      if (val === null || val === undefined) {
        value = "";
      } else if (typeof val === "object") {
        value = JSON.stringify(val);
      } else {
        value = String(val);
      }
      setEditingCell({
        ctid,
        rowIndex: row.index,
        columnId,
        value,
        originalValues: { ...row.original },
      });
      setActiveCell(null);
    },
    [canEditCell],
  );

  return {
    editingCell,
    setEditingCell,
    isSaving,
    saveCellValue,
    handleSaveCell,
    commitEditingCell,
    handleCellEdit,
  };
}
