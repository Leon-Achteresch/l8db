import { CsvExportDialog } from "@/features/export/csv-export-dialog";
import { XlsxExportDialog } from "@/features/export/xlsx-export-dialog";
import type { useTableExport } from "./use-table-export";

type TableExport = ReturnType<typeof useTableExport>;

export function TableExportDialogs({
  table,
  csvExportOpen,
  setCsvExportOpen,
  xlsxExportOpen,
  setXlsxExportOpen,
  exportColumns,
  exportRows,
  fullExportSource,
}: Pick<
  TableExport,
  | "csvExportOpen"
  | "setCsvExportOpen"
  | "xlsxExportOpen"
  | "setXlsxExportOpen"
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
