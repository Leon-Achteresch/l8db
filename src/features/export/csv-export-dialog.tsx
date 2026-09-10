import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { LoaderIcon } from "lucide-react";
import { useMemo, useState } from "react";
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
import {
  CSV_DELIMITERS,
  CSV_QUOTES,
  type CsvLineEnding,
  type CsvOptions,
  DEFAULT_CSV_OPTIONS,
  csvOptionsError,
  csvPreview,
  serializeCsv,
} from "@/lib/export";

const PREVIEW_ROWS = 5;

type CsvExportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: string[];
  rows: Record<string, unknown>[];
  defaultFileName: string;
};

export function CsvExportDialog({
  open,
  onOpenChange,
  columns,
  rows,
  defaultFileName,
}: CsvExportDialogProps) {
  const [options, setOptions] = useState<CsvOptions>(DEFAULT_CSV_OPTIONS);
  const [busy, setBusy] = useState(false);

  const optionError = csvOptionsError(options);

  const preview = useMemo(() => {
    if (optionError) return "";
    return csvPreview(columns, rows, options, PREVIEW_ROWS);
  }, [columns, rows, options, optionError]);

  const update = <K extends keyof CsvOptions>(key: K, value: CsvOptions[K]) => {
    setOptions((prev) => ({ ...prev, [key]: value }));
  };

  const handleExport = async () => {
    if (optionError) return;
    setBusy(true);
    try {
      const filePath = await save({
        defaultPath: defaultFileName,
        filters: [{ name: "CSV", extensions: ["csv", "txt"] }],
      });
      if (!filePath) return;
      await writeTextFile(filePath, serializeCsv(columns, rows, options));
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
          <DialogTitle>CSV exportieren</DialogTitle>
          <DialogDescription>
            {rows.length} geladene Zeile{rows.length === 1 ? "" : "n"} mit {columns.length} Spalten.
          </DialogDescription>
        </DialogHeader>

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
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button onClick={() => void handleExport()} disabled={busy || Boolean(optionError)}>
            {busy && <LoaderIcon className="size-3.5 animate-spin" />}
            Exportieren
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
