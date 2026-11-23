import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import type { QueryResult } from "@/lib/db";
import type { DataExportFormat } from "@/lib/export-formats";
import { useActiveMasks } from "@/lib/masking-display";
import { resultJsonRows } from "../query-result-masking";
import { MAX_RESULT_ROWS } from "./constants";
import { type FullResultLoader, loadFullResult } from "./load-full-result";

export function useResultExport(result: QueryResult | null, loadAll?: FullResultLoader) {
  const [exporting, setExporting] = useState(false);
  const [csvExportOpen, setCsvExportOpen] = useState(false);
  const [xlsxExportOpen, setXlsxExportOpen] = useState(false);
  const [dataExportFormat, setDataExportFormat] = useState<DataExportFormat | null>(null);
  const [full, setFull] = useState<{ base: QueryResult; result: QueryResult } | null>(null);
  if (full && full.base !== result) setFull(null);
  const source = full && full.base === result ? full.result : result;
  const { active: masks } = useActiveMasks(result?.columns ?? []);

  const exportOpen = csvExportOpen || xlsxExportOpen || dataExportFormat !== null;
  const [exportSource, setExportSource] = useState<QueryResult | null>(null);
  if (exportSource !== source && (exportOpen || exportSource)) {
    setExportSource(exportOpen ? source : null);
  }

  const exportRows = useMemo(() => {
    if (!exportSource) return [] as Record<string, unknown>[];
    return exportSource.rows.map((row) => {
      const obj: Record<string, unknown> = {};
      for (const c of exportSource.columns) obj[c] = row[c] ?? null;
      return obj;
    });
  }, [exportSource]);

  const needsFull = Boolean(result?.autoLimit) && source === result;
  const partial =
    source !== null &&
    ((needsFull && !loadAll) || Boolean(source.truncated && source.rows.length >= MAX_RESULT_ROWS));

  const withFullResult = useCallback(
    async (open: (current: QueryResult) => void | Promise<void>) => {
      if (!result || !source || exporting) return;
      if (!needsFull || !loadAll) return open(source);
      setExporting(true);
      try {
        const loaded = await loadFullResult(loadAll);
        if (!loaded) return;
        setFull({ base: result, result: loaded });
        await open(loaded);
      } finally {
        setExporting(false);
      }
    },
    [result, source, exporting, needsFull, loadAll],
  );

  const openCsvExport = useCallback(
    () => void withFullResult(() => setCsvExportOpen(true)),
    [withFullResult],
  );
  const openXlsxExport = () => void withFullResult(() => setXlsxExportOpen(true));
  const openDataExport = (format: DataExportFormat) =>
    void withFullResult(() => setDataExportFormat(format));

  const writeJson = async (current: QueryResult) => {
    setExporting(true);
    try {
      const filePath = await save({
        defaultPath: "query-result.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!filePath) return;
      await writeTextFile(filePath, JSON.stringify(resultJsonRows(current, masks), null, 2));
    } catch (error) {
      toast.error(`Export fehlgeschlagen: ${String(error)}`);
    } finally {
      setExporting(false);
    }
  };

  const handleExportJson = async () => {
    if (!result || result.columns.length === 0) return;
    await withFullResult(writeJson);
  };

  return {
    exporting,
    partial,
    loadedRows: source?.rows.length ?? 0,
    csvExportOpen,
    setCsvExportOpen,
    openCsvExport,
    xlsxExportOpen,
    setXlsxExportOpen,
    openXlsxExport,
    dataExportFormat,
    setDataExportFormat,
    openDataExport,
    exportRows,
    handleExportJson,
  };
}

export type ResultExportState = ReturnType<typeof useResultExport>;
