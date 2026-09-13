import { ClipboardPasteIcon } from "lucide-react";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CsvMappingTable } from "@/features/import/csv-mapping-table";
import { CsvPreviewTable } from "@/features/import/csv-preview-table";
import type { SavedConnection } from "@/lib/connections";
import {
  buildImportPayload,
  type CsvColumnMapping,
  type ImportTargetColumn,
  parseCsv,
  suggestMappings,
  validateMappings,
} from "@/lib/csv-import";
import { listImportColumns } from "@/lib/db";
import { pasteRows } from "@/lib/paste-rows";
import { effectiveConnectionString } from "@/lib/ssh";

export function PasteRowsDialog({
  connection,
  database,
  schema,
  table,
  onComplete,
}: {
  connection: SavedConnection;
  database: string | null;
  schema: string;
  table: string;
  onComplete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [header, setHeader] = useState(true);
  const [targets, setTargets] = useState<ImportTargetColumn[]>([]);
  const [mappings, setMappings] = useState<CsvColumnMapping[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = useMemo(
    () => parseCsv(text, { hasHeader: header, maxRows: 1000 }),
    [text, header],
  );
  const issues = useMemo(
    () => validateMappings(mappings, targets, parsed.rows),
    [mappings, targets, parsed.rows],
  );
  useEffect(() => {
    if (!open) return;
    let active = true;
    setTargets([]);
    setError(null);
    void listImportColumns(
      connection.kind,
      effectiveConnectionString(connection),
      schema,
      table,
      database ?? undefined,
    )
      .then((columns) => {
        if (active) setTargets(columns);
      })
      .catch((failure) => {
        if (active) setError(String(failure));
      });
    return () => {
      active = false;
    };
  }, [open, connection, database, schema, table]);
  useEffect(() => {
    setMappings(suggestMappings(parsed.headers, targets));
  }, [parsed.headers, targets]);
  const run = async () => {
    if (busy || issues.errors.length || parsed.truncated || !targets.length) return;
    setBusy(true);
    setError(null);
    try {
      const payload = buildImportPayload(mappings, parsed.rows);
      const rows = payload.rows.map((row) =>
        Object.fromEntries(payload.columns.map((column, index) => [column, row[index]])),
      );
      const count = await pasteRows(connection, database, schema, table, rows);
      toast.success(
        `${count} Zeilen eingefügt. Jetzt im Transaktionspanel prüfen und committen oder zurückrollen.`,
      );
      setOpen(false);
      setText("");
    } catch (failure) {
      setError(String(failure));
    } finally {
      setBusy(false);
      onComplete();
    }
  };
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Tabellenblock einfügen"
            onClick={() => setOpen(true)}
          >
            <ClipboardPasteIcon className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Tabellenblock einfügen</TooltipContent>
      </Tooltip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Tabellenblock einfügen</DialogTitle>
            <DialogDescription>
              {schema}.{table}: Excel-, TSV- oder CSV-Daten einfügen, Spalten zuordnen und
              anschließend in der offenen Transaktion prüfen. Maximal 1000 Zeilen.
            </DialogDescription>
          </DialogHeader>
          <fieldset disabled={busy} className="grid max-h-[65vh] gap-3 overflow-auto">
            <textarea
              aria-label="Tabellenblock"
              className="min-h-28 rounded border p-2 font-mono text-xs"
              placeholder="Daten hier einfügen …"
              value={text}
              onChange={(event) => {
                if (event.target.value.length <= 1024 * 1024) setText(event.target.value);
                else setError("Maximal 1 MiB Zwischenablagedaten.");
              }}
            />
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={header}
                onChange={(event) => setHeader(event.target.checked)}
              />
              Erste Zeile enthält Spaltennamen
            </label>
            {text && (
              <>
                <CsvMappingTable
                  headers={parsed.headers}
                  sampleRow={parsed.rows[0]}
                  mappings={mappings}
                  targets={targets}
                  onChange={(csvIndex, target) =>
                    setMappings((current) => [
                      ...current.filter((entry) => entry.csvIndex !== csvIndex),
                      { csvIndex, target },
                    ])
                  }
                />
                <p className="text-xs">{parsed.rows.length} Zeilen · Vorschau der ersten 20</p>
                <CsvPreviewTable headers={parsed.headers} rows={parsed.rows.slice(0, 20)} />
              </>
            )}
            {parsed.truncated && (
              <p className="text-xs text-destructive">
                Mehr als 1000 Zeilen. Bitte den Block verkleinern.
              </p>
            )}
            {text &&
              [...issues.errors, ...issues.warnings].map((issue) => (
                <p className="text-xs" key={issue}>
                  {issue}
                </p>
              ))}
          </fieldset>
          {error && (
            <p role="alert" className="whitespace-pre-wrap text-xs text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Schließen
            </Button>
            <Button
              onClick={() => void run()}
              disabled={
                busy ||
                !parsed.rows.length ||
                !targets.length ||
                parsed.truncated ||
                issues.errors.length > 0
              }
            >
              {busy ? "Wird eingefügt …" : "In Transaktion einfügen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
