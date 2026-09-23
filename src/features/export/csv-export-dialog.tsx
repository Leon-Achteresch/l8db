import { LoaderIcon, TrashIcon } from "lucide-react";
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
import { ColumnMaskList } from "./csv-export-dialog/column-mask-list";
import { CsvOptionsFields } from "./csv-export-dialog/csv-options-fields";
import { type CsvExportDialogProps, PREVIEW_ROWS } from "./csv-export-dialog/types";
import { useCsvExport } from "./csv-export-dialog/use-csv-export";

export function CsvExportDialog({
  open,
  onOpenChange,
  columns,
  rows,
  defaultFileName,
  fullExport,
}: CsvExportDialogProps) {
  const {
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
  } = useCsvExport({ open, onOpenChange, columns, rows, defaultFileName, fullExport });

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
                <SelectContent searchable>
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

        <CsvOptionsFields options={options} update={update} />

        <ColumnMaskList
          columns={columns}
          maskFor={maskFor}
          setMaskMode={setMaskMode}
          setMaskText={setMaskText}
        />

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
                    ? "Die Zeilenzahl ist nicht genau bekannt. Der Export streamt direkt aus der Datenbank in die Datei."
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
export type { FullTableExportSource } from "./csv-export-dialog/types";
