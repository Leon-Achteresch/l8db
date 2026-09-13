import { save } from "@tauri-apps/plugin-dialog";
import { LoaderIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import type { FullTableExportSource } from "@/features/export/csv-export-dialog";
import { useActiveConnection } from "@/lib/connections";
import { useActiveDatabase } from "@/lib/db-selection";
import { applyMasks, type ColumnMask, DEFAULT_MASK_TEXT, type MaskMode } from "@/lib/export";
import { cancelTask } from "@/lib/tasks";
import { DEFAULT_SHEET_NAME, xlsxInputError } from "@/lib/xlsx";
import { runXlsxExport } from "@/lib/xlsx-export-runner";

type XlsxExportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: string[];
  rows: Record<string, unknown>[];
  defaultFileName: string;
  defaultSheetName?: string;
  fullExport?: FullTableExportSource;
};

export function XlsxExportDialog({
  open,
  onOpenChange,
  columns,
  rows,
  defaultFileName,
  defaultSheetName,
  fullExport,
}: XlsxExportDialogProps) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const [fullMode, setFullMode] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [sheetName, setSheetName] = useState(defaultSheetName ?? DEFAULT_SHEET_NAME);
  const [header, setHeader] = useState(true);
  const [nullText, setNullText] = useState("");
  const [selected, setSelected] = useState<string[]>(columns);
  const [masks, setMasks] = useState<ColumnMask[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected(columns);
    setMasks((prev) => prev.filter((m) => columns.includes(m.column)));
    setSheetName(defaultSheetName ?? DEFAULT_SHEET_NAME);
  }, [open, columns, defaultSheetName]);

  const exportColumns = useMemo(
    () => columns.filter((c) => selected.includes(c)),
    [columns, selected],
  );

  const maskedRows = useMemo(
    () => applyMasks(exportColumns, rows, masks),
    [exportColumns, rows, masks],
  );

  const error = useMemo(
    () =>
      xlsxInputError({
        columns: exportColumns,
        rows: maskedRows,
        options: { sheetName, header, nullText },
      }),
    [exportColumns, maskedRows, sheetName, header, nullText],
  );

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

  const toggleColumn = (column: string, checked: boolean) => {
    setSelected((prev) => (checked ? [...prev, column] : prev.filter((c) => c !== column)));
  };

  const handleExport = async () => {
    if (error) return;
    setBusy(true);
    try {
      const filePath = await save({
        defaultPath: defaultFileName,
        filters: [{ name: "Excel", extensions: ["xlsx"] }],
      });
      if (!filePath) return;
      await runXlsxExport({
        path: filePath,
        input: { columns: exportColumns, rows, options: { sheetName, header, nullText } },
        masks,
        source: fullMode ? fullExport : undefined,
        connection,
        database,
        onJob: setJobId,
      });
      toast.success(`Exportiert nach ${filePath.split("/").pop()}`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>XLSX exportieren</DialogTitle>
          <DialogDescription>
            {rows.length} geladene Zeile{rows.length === 1 ? "" : "n"} mit {columns.length} Spalten.
          </DialogDescription>
        </DialogHeader>

        {fullExport && (
          <div className="space-y-2 text-xs">
            <label className="flex items-center gap-2">
              <Switch checked={fullMode} onCheckedChange={setFullMode} disabled={busy} />
              Alle gefilterten Zeilen exportieren
            </label>
            {fullMode && (
              <p className="text-muted-foreground">
                Seitenweises Lesen, maximal 64 MiB Rohdaten. Änderungen während des Exports können
                das Ergebnis beeinflussen; offene Tabellenänderungen sind nicht enthalten.
              </p>
            )}
          </div>
        )}
        <fieldset disabled={busy} className="contents">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="xlsx-sheet">Blattname</Label>
              <Input
                id="xlsx-sheet"
                value={sheetName}
                onChange={(event) => setSheetName(event.target.value)}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="xlsx-null">NULL-Darstellung</Label>
              <Input
                id="xlsx-null"
                value={nullText}
                placeholder="leer"
                onChange={(event) => setNullText(event.target.value)}
              />
            </div>

            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <Label htmlFor="xlsx-header">Kopfzeile</Label>
              <Switch
                id="xlsx-header"
                checked={header}
                onCheckedChange={setHeader}
                aria-label="Kopfzeile"
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Spalten und Maskierung</Label>
            <div className="max-h-52 space-y-1.5 overflow-auto rounded-md border p-2">
              {columns.map((column) => {
                const mask = maskFor(column);
                return (
                  <div key={column} className="flex items-center gap-2">
                    <Switch
                      checked={selected.includes(column)}
                      onCheckedChange={(checked) => toggleColumn(column, checked)}
                      aria-label={`Spalte ${column}`}
                    />
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
        </fieldset>
        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter>
          {busy && jobId && (
            <Button
              variant="outline"
              onClick={() =>
                void cancelTask(jobId).catch((failure) => toast.error(String(failure)))
              }
            >
              Abbrechen
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Schließen
          </Button>
          <Button onClick={() => void handleExport()} disabled={busy || Boolean(error)}>
            {busy && <LoaderIcon className="size-3.5 animate-spin" />}
            Exportieren
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
