import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { LoaderIcon, TrashIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useActiveConnection } from "@/lib/connections";
import {
  type TableExportProgress,
  cancelTableExport,
  exportTableCsv,
} from "@/lib/db";
import { useActiveCapabilities, useActiveDatabase } from "@/lib/db-selection";
import {
  CSV_DELIMITERS,
  CSV_QUOTES,
  type ColumnMask,
  type CsvLineEnding,
  type CsvOptions,
  DEFAULT_CSV_OPTIONS,
  DEFAULT_MASK_TEXT,
  type MaskMode,
  applyMasks,
  csvOptionsError,
  csvPreview,
  serializeCsv,
} from "@/lib/export";
import { useExportTemplatesStore } from "@/lib/export-templates";
import { effectiveConnectionString } from "@/lib/ssh";

const PREVIEW_ROWS = 5;
const DEFAULT_MAX_ROWS = 1_000_000;
const CONFIRM_ROWS = 100_000;

export type FullTableExportSource = {
  schema: string;
  table: string;
  filter: string;
  filterRaw: boolean;
  orderBy: string | null;
  orderDesc: boolean;
  isView: boolean;
  totalRows?: number | null;
};

type CsvExportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: string[];
  rows: Record<string, unknown>[];
  defaultFileName: string;
  fullExport?: FullTableExportSource;
};

export function CsvExportDialog({
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
  const needsConfirm = fullMode && totalRows !== null && totalRows > CONFIRM_ROWS;

  const maskedRows = useMemo(
    () => applyMasks(columns, rows, masks),
    [columns, rows, masks],
  );

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
        isView: fullExport.isView,
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>CSV exportieren</DialogTitle>
          <DialogDescription>
            {rows.length} geladene Zeile{rows.length === 1 ? "" : "n"} mit {columns.length} Spalten.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <div className="grid gap-1.5">
            <Label htmlFor="csv-template">Vorlage</Label>
            <div className="flex gap-2">
              <Select value={templateId} onValueChange={applyTemplate}>
                <SelectTrigger id="csv-template" size="sm" className="flex-1">
                  <SelectValue placeholder="Keine Vorlage" />
                </SelectTrigger>
                <SelectContent>
                  {templates.length === 0 ? (
                    <SelectItem value="__none__" disabled>
                      Keine Vorlagen gespeichert
                    </SelectItem>
                  ) : (
                    templates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDeleteTemplate}
                disabled={!templateId}
                aria-label="Vorlage löschen"
              >
                <TrashIcon className="size-3.5" />
              </Button>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="csv-template-name">Als Vorlage speichern</Label>
            <div className="flex gap-2">
              <Input
                id="csv-template-name"
                value={templateName}
                placeholder="Name"
                onChange={(event) => setTemplateName(event.target.value)}
              />
              <Button variant="outline" size="sm" onClick={handleSaveTemplate}>
                Speichern
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="csv-delimiter">Trennzeichen</Label>
            <Select
              value={options.delimiter}
              onValueChange={(value) => update("delimiter", value)}
            >
              <SelectTrigger id="csv-delimiter" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CSV_DELIMITERS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="csv-quote">Quote-Zeichen</Label>
            <Select value={options.quote} onValueChange={(value) => update("quote", value)}>
              <SelectTrigger id="csv-quote" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CSV_QUOTES.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="csv-line-ending">Zeilenende</Label>
            <Select
              value={options.lineEnding}
              onValueChange={(value) => update("lineEnding", value as CsvLineEnding)}
            >
              <SelectTrigger id="csv-line-ending" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={"\n"}>LF (Unix)</SelectItem>
                <SelectItem value={"\r\n"}>CRLF (Windows)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="csv-null">NULL-Darstellung</Label>
            <Input
              id="csv-null"
              value={options.nullText}
              placeholder="leer"
              onChange={(event) => update("nullText", event.target.value)}
            />
          </div>

          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <Label htmlFor="csv-header">Kopfzeile</Label>
            <Switch
              id="csv-header"
              checked={options.header}
              onCheckedChange={(checked) => update("header", checked)}
              aria-label="Kopfzeile"
            />
          </div>

          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <Label htmlFor="csv-bom">UTF-8-BOM</Label>
            <Switch
              id="csv-bom"
              checked={options.bom}
              onCheckedChange={(checked) => update("bom", checked)}
              aria-label="UTF-8-BOM"
            />
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label>Spaltenmaskierung</Label>
          <div className="max-h-40 space-y-1.5 overflow-auto rounded-md border p-2">
            {columns.map((column) => {
              const mask = maskFor(column);
              return (
                <div key={column} className="flex items-center gap-2">
                  <span className="flex-1 truncate font-mono text-xs">{column}</span>
                  <Select
                    value={mask?.mode ?? "none"}
                    onValueChange={(value) => setMaskMode(column, value as "none" | MaskMode)}
                  >
                    <SelectTrigger size="sm" className="w-32" aria-label={`Maskierung ${column}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Original</SelectItem>
                      <SelectItem value="text">Fester Text</SelectItem>
                      <SelectItem value="null">NULL</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    className="w-28"
                    value={mask?.mode === "text" ? (mask.text ?? "") : ""}
                    disabled={mask?.mode !== "text"}
                    placeholder={DEFAULT_MASK_TEXT}
                    aria-label={`Maskentext ${column}`}
                    onChange={(event) => setMaskText(column, event.target.value)}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {fullSupported && (
          <div className="grid gap-2 rounded-md border p-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="csv-full">Alle gefilterten Zeilen exportieren</Label>
              <Switch
                id="csv-full"
                checked={fullMode}
                onCheckedChange={(checked) => {
                  setFullMode(checked);
                  setConfirmed(false);
                }}
                aria-label="Alle gefilterten Zeilen exportieren"
              />
            </div>
            {fullMode && (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor="csv-max-rows">Zeilenlimit</Label>
                  <Input
                    id="csv-max-rows"
                    value={maxRows}
                    inputMode="numeric"
                    onChange={(event) => setMaxRows(event.target.value)}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {totalRows === null
                    ? "Der Export streamt direkt aus der Datenbank in die Datei."
                    : `${totalRows} Zeilen entsprechen dem aktuellen Filter.`}
                </p>
                {needsConfirm && (
                  <div className="flex items-center justify-between">
                    <Label htmlFor="csv-confirm" className="text-xs">
                      Großen Export bestätigen
                    </Label>
                    <Switch
                      id="csv-confirm"
                      checked={confirmed}
                      onCheckedChange={setConfirmed}
                      aria-label="Großen Export bestätigen"
                    />
                  </div>
                )}
                {busy && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {progressRows} Zeilen geschrieben
                    </span>
                    <Button variant="outline" size="sm" onClick={handleCancelExport}>
                      Abbrechen
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <div className="grid gap-1.5">
          <Label>Vorschau (erste {PREVIEW_ROWS} Zeilen)</Label>
          {optionError ? (
            <p className="text-xs text-destructive">{optionError}</p>
          ) : (
            <pre className="max-h-40 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-xs whitespace-pre">
              {preview || "(keine Zeilen)"}
            </pre>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Schließen
          </Button>
          <Button
            onClick={() => void handleExport()}
            disabled={
              busy ||
              Boolean(optionError) ||
              (fullMode && !limitValid) ||
              (needsConfirm && !confirmed)
            }
          >
            {busy && <LoaderIcon className="size-3.5 animate-spin" />}
            Exportieren
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
