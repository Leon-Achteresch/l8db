import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { FullTableExportSource } from "@/features/export/csv-export-dialog";
import { useActiveConnection } from "@/lib/connections";
import {
  cancelTableExport,
  exportRowsFile,
  exportTableCsv,
  type TableExportProgress,
} from "@/lib/db";
import { useActiveCapabilities, useActiveDatabase } from "@/lib/db-selection";
import {
  type ColumnMask,
  DEFAULT_CSV_OPTIONS,
  DEFAULT_MASK_TEXT,
  type MaskMode,
} from "@/lib/export";
import { type DataExportFormat, dataExportFormatInfo } from "@/lib/export-formats";
import { effectiveConnectionString } from "@/lib/ssh";

export const DEFAULT_MAX_ROWS = 1_000_000;

export function useDataExport({
  format,
  onClose,
  columns,
  rows,
  baseFileName,
  fullExport,
}: {
  format: DataExportFormat | null;
  onClose: () => void;
  columns: string[];
  rows: Record<string, unknown>[];
  baseFileName: string;
  fullExport?: FullTableExportSource;
}) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const caps = useActiveCapabilities();
  const [masks, setMasks] = useState<ColumnMask[]>([]);
  const [busy, setBusy] = useState(false);
  const [fullMode, setFullMode] = useState(false);
  const [maxRows, setMaxRows] = useState(String(DEFAULT_MAX_ROWS));
  const [progressRows, setProgressRows] = useState(0);
  const jobIdRef = useRef<string | null>(null);

  const fullSupported = Boolean(fullExport) && caps.full_table_export && Boolean(connection);
  const limit = Number.parseInt(maxRows, 10);
  const limitValid = Number.isFinite(limit) && limit > 0;
  const info = dataExportFormatInfo(format ?? "parquet");

  useEffect(() => {
    if (!format) return;
    setMasks((previous) => previous.filter((mask) => columns.includes(mask.column)));
  }, [format, columns]);

  useEffect(() => {
    if (!busy || !fullMode) return;
    let active = true;
    const unlistenPromise = listen<TableExportProgress>("table-export-progress", (event) => {
      if (active && event.payload.jobId === jobIdRef.current) setProgressRows(event.payload.rows);
    });
    return () => {
      active = false;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [busy, fullMode]);

  const maskFor = (column: string) => masks.find((mask) => mask.column === column) ?? null;

  const setMaskMode = (column: string, mode: "none" | MaskMode) => {
    setMasks((previous) => {
      const rest = previous.filter((mask) => mask.column !== column);
      if (mode === "none") return rest;
      const current = previous.find((mask) => mask.column === column);
      return [
        ...rest,
        { column, mode, text: mode === "text" ? (current?.text ?? DEFAULT_MASK_TEXT) : null },
      ];
    });
  };

  const setMaskText = (column: string, text: string) => {
    setMasks((previous) =>
      previous.map((mask) => (mask.column === column ? { ...mask, text } : mask)),
    );
  };

  const handleCancel = () => {
    if (jobIdRef.current) void cancelTableExport(jobIdRef.current);
  };

  const handleExport = async () => {
    if (!format || busy) return;
    setBusy(true);
    try {
      const path = await save({
        defaultPath: `${baseFileName}.${info.extension}`,
        filters: [{ name: info.label, extensions: [info.extension] }],
      });
      if (!path) return;
      const wireMasks = masks.map((mask) => ({
        column: mask.column,
        mode: mask.mode,
        text: mask.text ?? null,
      }));
      if (fullMode && fullSupported && fullExport && connection) {
        const jobId = crypto.randomUUID();
        jobIdRef.current = jobId;
        setProgressRows(0);
        const outcome = await exportTableCsv(
          connection.kind,
          effectiveConnectionString(connection),
          {
            jobId,
            schema: fullExport.schema,
            table: fullExport.table,
            filter: fullExport.filter.trim() === "" ? null : fullExport.filter,
            allowRawFilter: fullExport.filterRaw,
            orderBy: fullExport.orderBy,
            orderDesc: fullExport.orderDesc,
            path,
            options: { ...DEFAULT_CSV_OPTIONS },
            masks: wireMasks,
            maxRows: limitValid ? limit : null,
            format,
          },
          database ?? undefined,
        );
        toast.success(`${outcome.rows} Zeilen als ${info.label} exportiert.`);
        if (outcome.truncated) toast.warning(`Export beim Zeilenlimit von ${limit} abgeschnitten.`);
      } else {
        const written = await exportRowsFile({
          path,
          format,
          columns,
          rows,
          masks: wireMasks,
          title: baseFileName,
        });
        toast.success(`${written} Zeilen als ${info.label} exportiert.`);
      }
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      jobIdRef.current = null;
      setBusy(false);
      setProgressRows(0);
    }
  };

  return {
    info,
    busy,
    fullMode,
    setFullMode,
    fullSupported,
    maxRows,
    setMaxRows,
    limitValid,
    progressRows,
    maskFor,
    setMaskMode,
    setMaskText,
    handleCancel,
    handleExport,
  };
}
