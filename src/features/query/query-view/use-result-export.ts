import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import type { QueryResult } from "@/lib/db";
import type { DataExportFormat } from "@/lib/export-formats";

export function useResultExport(result: QueryResult | null) {
  const [exporting, setExporting] = useState(false);
  const [csvExportOpen, setCsvExportOpen] = useState(false);
  const [xlsxExportOpen, setXlsxExportOpen] = useState(false);
  const [dataExportFormat, setDataExportFormat] = useState<DataExportFormat | null>(null);
  const openCsvExport = useCallback(() => setCsvExportOpen(true), []);

  const exportRows = useMemo(() => {
    if (!result) return [] as Record<string, unknown>[];
    return result.rows.map((row) => {
      const obj: Record<string, unknown> = {};
      for (const c of result.columns) obj[c] = row[c] ?? null;
      return obj;
    });
  }, [result]);

  const handleExportJson = async () => {
    if (!result || result.columns.length === 0) return;
    setExporting(true);
    try {
      const filePath = await save({
        defaultPath: "query-result.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!filePath) return;
      await writeTextFile(filePath, JSON.stringify(exportRows, null, 2));
    } catch (error) {
      toast.error(`Export fehlgeschlagen: ${String(error)}`);
    } finally {
      setExporting(false);
    }
  };

  return {
    exporting,
    csvExportOpen,
    setCsvExportOpen,
    openCsvExport,
    xlsxExportOpen,
    setXlsxExportOpen,
    dataExportFormat,
    setDataExportFormat,
    exportRows,
    handleExportJson,
  };
}

export type ResultExportState = ReturnType<typeof useResultExport>;
