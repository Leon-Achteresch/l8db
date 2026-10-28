import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import type { ConvexImportFormat, ConvexImportMode } from "@/lib/db/convex-studio-data";
import { MAX_IMPORT_BYTES } from "./convex-data-utils";

const FORMATS: { value: ConvexImportFormat; label: string }[] = [
  { value: "jsonLines", label: "JSONL (ein Objekt pro Zeile)" },
  { value: "jsonArray", label: "JSON-Array" },
  { value: "csv", label: "CSV mit Kopfzeile" },
];

const MODES: { value: ConvexImportMode; label: string }[] = [
  { value: "requireEmpty", label: "Nur in leere Tabelle" },
  { value: "append", label: "Anhängen" },
  { value: "replace", label: "Tabelle ersetzen" },
];

const formatFor = (name: string): ConvexImportFormat =>
  name.endsWith(".csv") ? "csv" : name.endsWith(".json") ? "jsonArray" : "jsonLines";

export function ConvexDataImportDialog({
  table,
  onOpenChange,
  onImport,
}: {
  table: string;
  onOpenChange: (open: boolean) => void;
  onImport: (format: ConvexImportFormat, mode: ConvexImportMode, content: string) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<ConvexImportFormat>("jsonLines");
  const [mode, setMode] = useState<ConvexImportMode>("requireEmpty");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tooLarge = file !== null && file.size > MAX_IMPORT_BYTES;

  async function submit() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await onImport(format, mode, await file.text());
      onOpenChange(false);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !busy && onOpenChange(open)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            In <span className="font-mono">{table}</span> importieren
          </DialogTitle>
          <DialogDescription>
            JSONL, JSON-Array oder CSV bis 8 MiB. CSV-Werte werden als Zahlen bzw. Texte übernommen;
            für verschachtelte Werte JSONL verwenden.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="convex-data-import-file" className="text-xs">
              Datei
            </Label>
            <Input
              id="convex-data-import-file"
              type="file"
              accept=".jsonl,.ndjson,.json,.csv"
              disabled={busy}
              onChange={(event) => {
                const next = event.target.files?.[0] ?? null;
                setFile(next);
                if (next) setFormat(formatFor(next.name.toLowerCase()));
              }}
              className="text-xs"
            />
            {tooLarge && (
              <p className="text-xs text-destructive">Die Datei ist größer als 8 MiB.</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={format}
              onValueChange={(value) => setFormat(value as ConvexImportFormat)}
            >
              <SelectTrigger size="sm" className="h-8 text-xs" aria-label="Format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FORMATS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={mode}
              onValueChange={(value) => {
                setMode(value as ConvexImportMode);
                setConfirmed(false);
              }}
            >
              <SelectTrigger size="sm" className="h-8 text-xs" aria-label="Modus">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODES.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {mode === "replace" && (
            <Label className="flex items-center gap-2 text-xs font-normal text-destructive">
              <Checkbox
                checked={confirmed}
                onCheckedChange={(value) => setConfirmed(value === true)}
              />
              Alle vorhandenen Dokumente in {table} werden gelöscht.
            </Label>
          )}
        </div>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Abbrechen
          </Button>
          <Button
            variant={mode === "replace" ? "destructive" : "default"}
            onClick={() => void submit()}
            disabled={busy || !file || tooLarge || (mode === "replace" && !confirmed)}
          >
            {busy ? "Importiert…" : "Importieren"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
