import { CsvExportDialog } from "@/features/export/csv-export-dialog";
import { DataExportDialog } from "@/features/export/data-export-dialog";
import { XlsxExportDialog } from "@/features/export/xlsx-export-dialog";
import type { useTableExport } from "./use-table-export";

type TableExport = ReturnType<typeof useTableExport>;

export function TableExportDialogs({
  table,
  csvExportOpen,
  setCsvExportOpen,
  xlsxExportOpen,
  dataExportFormat,
  setXlsxExportOpen,
  setDataExportFormat,
  exportColumns,
  exportRows,
  fullExportSource,
}: Pick<
  TableExport,
  | "csvExportOpen"
  | "setCsvExportOpen"
  | "xlsxExportOpen"
  | "dataExportFormat"
  | "setXlsxExportOpen"
  | "setDataExportFormat"
  | "exportColumns"
  | "exportRows"
  | "fullExportSource"
> & { table: string }) {
  return (
    <>
      <CsvExportDialog
        open={csvExportOpen}
        onOpenChange={setCsvExportOpen}
        columns={exportColumns}
        rows={exportRows}
        defaultFileName={`${table}.csv`}
        fullExport={fullExportSource}
      />
      <DataExportDialog
        format={dataExportFormat}
        onClose={() => setDataExportFormat(null)}
        columns={exportColumns}
        rows={exportRows}
        baseFileName={table}
        fullExport={fullExportSource}
      />
      <XlsxExportDialog
        fullExport={fullExportSource}
        open={xlsxExportOpen}
        onOpenChange={setXlsxExportOpen}
        columns={exportColumns}
        rows={exportRows}
        defaultFileName={`${table}.xlsx`}
        defaultSheetName={table}
      />
    </>
  );
}
