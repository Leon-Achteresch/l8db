import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useActiveConnection } from "@/lib/connections";
import { cancelTableExport, exportTableCsv, type TableExportProgress } from "@/lib/db";
import { useActiveCapabilities, useActiveDatabase } from "@/lib/db-selection";
import {
  applyMasks,
  type ColumnMask,
  type CsvOptions,
  csvOptionsError,
  csvPreview,
  DEFAULT_CSV_OPTIONS,
  DEFAULT_MASK_TEXT,
  type MaskMode,
  serializeCsv,
} from "@/lib/export";
import { useExportTemplatesStore } from "@/lib/export-templates";
import { effectiveConnectionString } from "@/lib/ssh";
import { CONFIRM_ROWS, type CsvExportDialogProps, DEFAULT_MAX_ROWS, PREVIEW_ROWS } from "./types";

export function useCsvExport({
  open,
  onOpenChange,
  columns,
  rows,
  defaultFileName,
  fullExport,
}: CsvExportDialogProps) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const caps = useActiveCapabilities();
  const templates = useExportTemplatesStore((s) => s.templates);
  const saveTemplate = useExportTemplatesStore((s) => s.saveTemplate);
  const deleteTemplate = useExportTemplatesStore((s) => s.deleteTemplate);

  const [options, setOptions] = useState<CsvOptions>(DEFAULT_CSV_OPTIONS);
  const [masks, setMasks] = useState<ColumnMask[]>([]);
  const [templateId, setTemplateId] = useState<string>("");
  const [templateName, setTemplateName] = useState("");
  const [busy, setBusy] = useState(false);
  const [fullMode, setFullMode] = useState(false);
  const [maxRows, setMaxRows] = useState(String(DEFAULT_MAX_ROWS));
  const [confirmed, setConfirmed] = useState(false);
  const [progressRows, setProgressRows] = useState(0);
  const jobIdRef = useRef<string | null>(null);

  const fullSupported = Boolean(fullExport) && caps.full_table_export && Boolean(connection);
  const optionError = csvOptionsError(options);
  const limit = Number.parseInt(maxRows, 10);
  const limitValid = Number.isFinite(limit) && limit > 0;
  const totalRows = fullExport?.totalRows ?? null;
  const needsConfirm = fullMode && (totalRows === null || totalRows > CONFIRM_ROWS);

  const maskedRows = useMemo(() => applyMasks(columns, rows, masks), [columns, rows, masks]);

  const preview = useMemo(() => {
    if (optionError) return "";
    return csvPreview(columns, maskedRows, options, PREVIEW_ROWS);
  }, [columns, maskedRows, options, optionError]);

  useEffect(() => {
    if (!open) return;
    setMasks((prev) => prev.filter((m) => columns.includes(m.column)));
  }, [open, columns]);

  useEffect(() => {
    if (!busy || !fullMode) return;
    let active = true;
    const unlistenPromise = listen<TableExportProgress>("table-export-progress", (event) => {
      if (!active) return;
      if (event.payload.jobId !== jobIdRef.current) return;
      setProgressRows(event.payload.rows);
    });
    return () => {
      active = false;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [busy, fullMode]);

  const update = <K extends keyof CsvOptions>(key: K, value: CsvOptions[K]) => {
    setOptions((prev) => ({ ...prev, [key]: value }));
    setTemplateId("");
  };

  const maskFor = (column: string) => masks.find((m) => m.column === column) ?? null;

  const setMaskMode = (column: string, mode: "none" | MaskMode) => {
    setMasks((prev) => {
      const rest = prev.filter((m) => m.column !== column);
      if (mode === "none") return rest;
      const current = prev.find((m) => m.column === column);
      return [
        ...rest,
        { column, mode, text: mode === "text" ? (current?.text ?? DEFAULT_MASK_TEXT) : null },
      ];
    });
  };

  const setMaskText = (column: string, text: string) => {
    setMasks((prev) => prev.map((m) => (m.column === column ? { ...m, text } : m)));
  };

  const applyTemplate = (id: string) => {
    const template = templates.find((t) => t.id === id);
    if (!template) return;
    setTemplateId(id);
    setOptions(template.options);
  };

  const handleSaveTemplate = () => {
    const name = templateName.trim();
    if (!name) {
      toast.error("Name für die Vorlage fehlt.");
      return;
    }
    const template = saveTemplate(name, options);
    setTemplateId(template.id);
    setTemplateName("");
    toast.success(`Vorlage "${template.name}" gespeichert.`);
  };

  const handleDeleteTemplate = () => {
    if (!templateId) return;
    deleteTemplate(templateId);
    setTemplateId("");
    toast.success("Vorlage gelöscht.");
  };

  const handleCancelExport = () => {
    const jobId = jobIdRef.current;
    if (!jobId) return;
    void cancelTableExport(jobId);
  };

  const handleFullExport = async (filePath: string) => {
    if (!fullExport || !connection) return;
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
        path: filePath,
        options: {
          delimiter: options.delimiter,
          quote: options.quote,
          header: options.header,
          nullText: options.nullText,
          lineEnding: options.lineEnding,
          bom: options.bom,
        },
        masks: masks.map((m) => ({ column: m.column, mode: m.mode, text: m.text ?? null })),
        maxRows: limitValid ? limit : null,
      },
      database ?? undefined,
    );
    jobIdRef.current = null;
    toast.success(`${outcome.rows} Zeilen exportiert nach ${filePath.split("/").pop()}`);
    if (outcome.truncated) {
      toast.warning(`Export beim Zeilenlimit von ${limit} abgeschnitten.`);
    }
  };

  const handleExport = async () => {
    if (optionError) return;
    if (fullMode && needsConfirm && !confirmed) return;
    setBusy(true);
    try {
      const filePath = await save({
        defaultPath: defaultFileName,
        filters: [{ name: "CSV", extensions: ["csv", "txt"] }],
      });
      if (!filePath) return;
      if (fullMode && fullSupported) {
        await handleFullExport(filePath);
      } else {
        await writeTextFile(filePath, serializeCsv(columns, maskedRows, options));
        toast.success(`Exportiert nach ${filePath.split("/").pop()}`);
      }
      onOpenChange(false);
    } catch (err) {
      jobIdRef.current = null;
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setProgressRows(0);
    }
  };

  return {
    applyTemplate,
    busy,
    confirmed,
    fullMode,
    fullSupported,
    handleCancelExport,
    handleDeleteTemplate,
    handleExport,
    handleSaveTemplate,
    limitValid,
    maskFor,
    maxRows,
    needsConfirm,
    optionError,
    options,
    preview,
    progressRows,
    setConfirmed,
    setFullMode,
    setMaskMode,
    setMaskText,
    setMaxRows,
    setTemplateName,
    templateId,
    templateName,
    templates,
    totalRows,
    update,
  };
}
