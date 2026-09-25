import { LoaderIcon } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import type { DataExportFormat } from "@/lib/export-formats";
import type { FullTableExportSource } from "./csv-export-dialog";
import { ColumnMaskList } from "./csv-export-dialog/column-mask-list";
import { useDataExport } from "./data-export-dialog/use-data-export";

export function DataExportDialog({
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
  const {
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
  } = useDataExport({ format, onClose, columns, rows, baseFileName, fullExport });

  return (
    <Dialog open={format !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Als {info.label} exportieren</DialogTitle>
          <DialogDescription>
            {rows.length} geladene Zeile{rows.length === 1 ? "" : "n"} mit {columns.length} Spalten.{" "}
            {info.description}
          </DialogDescription>
        </DialogHeader>

        <ColumnMaskList
          columns={columns}
          maskFor={maskFor}
          setMaskMode={setMaskMode}
          setMaskText={setMaskText}
        />

        {fullSupported && (
          <div className="grid gap-2 rounded-md border p-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="data-export-full">Alle gefilterten Zeilen exportieren</Label>
              <Switch
                id="data-export-full"
                checked={fullMode}
                onCheckedChange={setFullMode}
                aria-label="Alle gefilterten Zeilen exportieren"
              />
            </div>
            {fullMode && (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor="data-export-max-rows">Zeilenlimit</Label>
                  <Input
                    id="data-export-max-rows"
                    value={maxRows}
                    inputMode="numeric"
                    onChange={(event) => setMaxRows(event.target.value)}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Der Export streamt in Stapeln direkt aus der Datenbank in die Datei.
                </p>
                {busy && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {progressRows} Zeilen geschrieben
                    </span>
                    <Button variant="outline" size="sm" onClick={handleCancel}>
                      Abbrechen
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Schließen
          </Button>
          <Button
            onClick={() => void handleExport()}
            disabled={busy || (fullMode && !limitValid) || (!fullMode && rows.length === 0)}
          >
            {busy && <LoaderIcon className="size-3.5 animate-spin" />}
            Exportieren
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
