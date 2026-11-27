import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { QueryResult } from "@/lib/db";
import type { DataExportFormat } from "@/lib/export-formats";
import { useActiveMasks } from "@/lib/masking-display";
import { resultJsonRows } from "../query-result-masking";
import { MAX_RESULT_ROWS } from "./constants";
import { type FullResultLoader, loadFullResult } from "./load-full-result";

export function useResultExport(result: QueryResult | null, loadAll?: FullResultLoader) {
  const [exporting, setExporting] = useState(false);
  const exportPending = useRef(false);
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

  const startExport = useCallback(
    async (format: "json" | "csv" | "xlsx" | DataExportFormat) => {
      if (!result || !source || exportPending.current) return;
      if (format === "json" && !result.columns.length) return;
      exportPending.current = true;
      setExporting(true);
      const readResult = async () => {
        if (!needsFull || !loadAll) return source;
        const loaded = await loadFullResult(loadAll);
        if (loaded) setFull({ base: result, result: loaded });
        return loaded;
      };
      try {
        if (format === "json") {
          const path = await save({
            defaultPath: "query-result.json",
            filters: [{ name: "JSON", extensions: ["json"] }],
          });
          if (!path) return;
          const current = await readResult();
          if (current)
            await writeTextFile(path, JSON.stringify(resultJsonRows(current, masks), null, 2));
          return;
        }
        if (!(await readResult())) return;
        if (format === "csv") setCsvExportOpen(true);
        else if (format === "xlsx") setXlsxExportOpen(true);
        else setDataExportFormat(format);
      } catch (error) {
        toast.error(`Export fehlgeschlagen: ${String(error)}`);
      } finally {
        exportPending.current = false;
        setExporting(false);
      }
    },
    [result, source, needsFull, loadAll, masks],
  );

  const openCsvExport = useCallback(() => void startExport("csv"), [startExport]);
  const openXlsxExport = () => void startExport("xlsx");
  const openDataExport = (format: DataExportFormat) => void startExport(format);
  const handleExportJson = () => startExport("json");

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
