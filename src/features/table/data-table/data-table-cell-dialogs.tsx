import { useCallback } from "react";
import { CellValueDialog } from "@/features/table/cell-value-dialog";
import { FkValuePickerDialog } from "@/features/table/fk-value-picker-dialog";
import type { DetailedColumnInfo, ForeignKeyInfo } from "@/lib/db";
import { isNullableColumn, outgoingForeignKey, resolveFkTarget } from "@/lib/fk-lookup";
import type { DataTableProps, FkPickerCell, InspectCell, TableRow } from "../data-table-types";

type Props = {
  inspectCell: InspectCell | null;
  setInspectCell: (cell: InspectCell | null) => void;
  fkPickerCell: FkPickerCell | null;
  setFkPickerCell: (cell: FkPickerCell | null) => void;
  columnTypeByName: Map<string, string>;
  cellEditorKind: DataTableProps["cellEditorKind"];
  onSaveRow: DataTableProps["onSaveRow"];
  canEditCell: DataTableProps["canEditCell"];
  isSaving: boolean;
  saveCellValue: (
    ctid: string,
    columnId: string,
    originalValues: Record<string, unknown>,
    next: string | null,
  ) => Promise<boolean>;
  foreignKeys: ForeignKeyInfo[] | undefined;
  currentSchema: string | undefined;
  currentTable: string | undefined;
  columnDetails: DetailedColumnInfo[] | undefined;
  data: TableRow[];
};

export function DataTableCellDialogs({
  inspectCell,
  setInspectCell,
  fkPickerCell,
  setFkPickerCell,
  columnTypeByName,
  cellEditorKind,
  onSaveRow,
  canEditCell,
  isSaving,
  saveCellValue,
  foreignKeys,
  currentSchema,
  currentTable,
  columnDetails,
  data,
}: Props) {
  const inspectColumn = inspectCell?.columnName;
  const getColumnValues = useCallback(
    () => (inspectColumn ? data.map((row) => row[inspectColumn]) : []),
    [data, inspectColumn],
  );
  return (
    <>
      {inspectCell && (
        <CellValueDialog
          columnName={inspectCell.columnName}
          value={inspectCell.value}
          dataType={columnTypeByName.get(inspectCell.columnName) ?? null}
          editorKind={cellEditorKind}
          getColumnValues={getColumnValues}
          canEdit={
            !!onSaveRow &&
            !!inspectCell.ctid &&
            !!inspectCell.originalValues &&
            (!canEditCell || canEditCell(inspectCell.originalValues, inspectCell.columnName))
          }
          isSaving={isSaving}
          onClose={() => setInspectCell(null)}
          onSave={async (next) => {
            if (!inspectCell.ctid || !inspectCell.originalValues) return;
            const ok = await saveCellValue(
              inspectCell.ctid,
              inspectCell.columnName,
              inspectCell.originalValues,
              next,
            );
            if (ok) setInspectCell(null);
          }}
        />
      )}

      {fkPickerCell &&
        (() => {
          const fk = outgoingForeignKey(
            foreignKeys,
            currentSchema ?? "",
            currentTable ?? "",
            fkPickerCell.columnName,
          );
          const target = fk ? resolveFkTarget(fk, currentSchema ?? "", currentTable ?? "") : null;
          if (!target) return null;
          return (
            <FkValuePickerDialog
              columnName={fkPickerCell.columnName}
              target={target}
              currentValue={fkPickerCell.currentValue}
              allowNull={isNullableColumn(columnDetails, fkPickerCell.columnName)}
              isSaving={isSaving}
              onClose={() => setFkPickerCell(null)}
              onSelect={async (next) => {
                const ok = await saveCellValue(
                  fkPickerCell.ctid,
                  fkPickerCell.columnName,
                  fkPickerCell.originalValues,
                  next,
                );
                if (ok) setFkPickerCell(null);
              }}
            />
          );
        })()}
    </>
  );
}
