import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile, stat } from "@tauri-apps/plugin-fs";
import { AlertTriangleIcon, CheckCircle2Icon, TableIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  buildImportPayload,
  CSV_MAX_BYTES,
  CSV_MAX_IMPORT_ROWS,
  CSV_PREVIEW_ROWS,
  type CsvColumnMapping,
  type CsvEmptyFieldMode,
  type CsvParseResult,
  type ImportTargetColumn,
  parseCsv,
  suggestMappings,
  validateMappings,
} from "@/lib/csv-import";
import { type CsvImportOutcome, csvImport, listImportColumns } from "@/lib/db";
import { useActiveDatabase, useActiveSchema } from "@/lib/db-selection";
import { useTablesQuery } from "@/lib/queries";
import { effectiveConnectionString } from "@/lib/ssh";
import { getTransactionForConnection, useTransactionStore } from "@/lib/transactions";

import { CsvMappingTable } from "./csv-mapping-table";
import { CsvPreviewTable } from "./csv-preview-table";

const DELIMITER_OPTIONS = [
  { value: ",", label: "Komma (,)" },
  { value: ";", label: "Semikolon (;)" },
  { value: "\t", label: "Tabulator" },
  { value: "|", label: "Pipe (|)" },
];

const QUOTE_OPTIONS = [
  { value: '"', label: 'Doppeltes Anführungszeichen (")' },
  { value: "'", label: "Einfaches Anführungszeichen (')" },
];

export function CsvImportPanel() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const schema = useActiveSchema();
  const tables = useTablesQuery();
  const transactions = useTransactionStore((state) => state.transactions);

  const [fileName, setFileName] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [delimiter, setDelimiter] = useState<string | null>(null);
  const [quote, setQuote] = useState('"');
  const [hasHeader, setHasHeader] = useState<boolean | null>(null);
  const [emptyField, setEmptyField] = useState<CsvEmptyFieldMode>("null");
  const [targetTable, setTargetTable] = useState<string | null>(null);
  const [targetColumns, setTargetColumns] = useState<ImportTargetColumn[]>([]);
  const [mappings, setMappings] = useState<CsvColumnMapping[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<CsvImportOutcome | null>(null);

  const openTransaction = connection ? getTransactionForConnection(connection.id) : undefined;
  void transactions;

  const parsed: CsvParseResult | null = useMemo(() => {
    if (text === null) return null;
    return parseCsv(text, {
      delimiter: delimiter ?? undefined,
      quote,
      hasHeader: hasHeader ?? undefined,
      emptyField,
      maxRows: CSV_MAX_IMPORT_ROWS,
    });
  }, [text, delimiter, quote, hasHeader, emptyField]);

  const issues = useMemo(() => {
    if (!parsed || targetColumns.length === 0) return null;
    return validateMappings(mappings, targetColumns, parsed.rows);
  }, [parsed, targetColumns, mappings]);

  const handlePickFile = async () => {
    setFileError(null);
    const path = await open({
      filters: [{ name: "CSV", extensions: ["csv", "tsv", "txt"] }],
      multiple: false,
    });
    if (!path || typeof path !== "string") return;
    try {
      const info = await stat(path);
      if (typeof info.size === "number" && info.size > CSV_MAX_BYTES) {
        setFileError(
          `Datei ist zu groß (${(info.size / 1024 / 1024).toFixed(1)} MB, Maximum 10 MB).`,
        );
        return;
      }
    } catch {
      setFileError(null);
    }
    const content = await readTextFile(path);
    const detected = parseCsv(content, { maxRows: CSV_PREVIEW_ROWS });
    setFileName(path.split("/").pop() ?? path);
    setText(content);
    setDelimiter(detected.delimiter);
    setHasHeader(detected.hasHeader);
    setOutcome(null);
    setMappings(targetColumns.length > 0 ? suggestMappings(detected.headers, targetColumns) : []);
  };

  const handlePickTable = async (table: string) => {
    setTargetTable(table);
    setOutcome(null);
    if (!connection) return;
    try {
      const columns = await listImportColumns(
        connection.kind,
        effectiveConnectionString(connection),
        schema,
        table,
        database ?? undefined,
      );
      setTargetColumns(columns);
      setMappings(parsed ? suggestMappings(parsed.headers, columns) : []);
      setFileError(null);
    } catch (err) {
      setTargetColumns([]);
      setMappings([]);
      setFileError(typeof err === "string" ? err : String(err));
    }
  };

  const handleMappingChange = (csvIndex: number, target: string | null) => {
    setOutcome(null);
    setMappings((current) => {
      const next = current.filter((m) => m.csvIndex !== csvIndex);
      next.push({ csvIndex, target });
      return next.sort((a, b) => a.csvIndex - b.csvIndex);
    });
  };

  const handleImport = async () => {
    if (!connection || !parsed || !targetTable) return;
    setRunning(true);
    setOutcome(null);
    try {
      const payload = buildImportPayload(mappings, parsed.rows);
      const result = await csvImport(
        connection.kind,
        effectiveConnectionString(connection),
        {
          schema,
          table: targetTable,
          columns: payload.columns,
          rows: payload.rows,
        },
        database ?? undefined,
      );
      setOutcome(result);
    } catch (err) {
      setOutcome({
        inserted_rows: 0,
        failed_row: null,
        failed_column: null,
        error: typeof err === "string" ? err : String(err),
      });
    } finally {
      setRunning(false);
    }
  };

  const rowCount = parsed?.rows.length ?? 0;
  const tooManyRows = parsed?.truncated === true || rowCount > CSV_MAX_IMPORT_ROWS;
  const blocked =
    !parsed ||
    !targetTable ||
    rowCount === 0 ||
    tooManyRows ||
    Boolean(openTransaction) ||
    (issues?.errors.length ?? 1) > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => void handlePickFile()}>
          CSV wählen…
        </Button>
        {fileName && (
          <span className="truncate font-mono text-xs text-muted-foreground">{fileName}</span>
        )}
      </div>

      {fileError && (
        <p className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 font-mono text-xs text-destructive">
          {fileError}
        </p>
      )}

      {parsed && (
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Trennzeichen</Label>
            <Select value={parsed.delimiter} onValueChange={setDelimiter}>
              <SelectTrigger size="sm" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DELIMITER_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Anführungszeichen</Label>
            <Select value={quote} onValueChange={setQuote}>
              <SelectTrigger size="sm" className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QUOTE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 pb-2">
            <Switch
              id="csv-header"
              checked={parsed.hasHeader}
              onCheckedChange={(checked) => setHasHeader(checked)}
            />
            <Label htmlFor="csv-header" className="text-xs">
              Erste Zeile ist Kopfzeile
            </Label>
          </div>
          <div className="flex items-center gap-2 pb-2">
            <Switch
              id="csv-empty-null"
              checked={emptyField === "null"}
              onCheckedChange={(checked) => setEmptyField(checked ? "null" : "empty")}
            />
            <Label htmlFor="csv-empty-null" className="text-xs">
              Leere Felder als NULL
            </Label>
          </div>
        </div>
      )}

      {parsed && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">{parsed.columnCount} Spalten</Badge>
          <Badge variant="outline">
            {parsed.totalRows === null
              ? `mehr als ${rowCount} Zeilen (Gesamtumfang unbekannt)`
              : `${parsed.totalRows} Zeilen`}
          </Badge>
          <span>Vorschau: erste {Math.min(rowCount, CSV_PREVIEW_ROWS)} Zeilen</span>
          {parsed.raggedRows.length > 0 && (
            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/5 text-amber-600">
              {parsed.raggedRows.length} Zeile(n) mit abweichender Spaltenzahl
            </Badge>
          )}
        </div>
      )}

      {parsed && (
        <CsvPreviewTable headers={parsed.headers} rows={parsed.rows.slice(0, CSV_PREVIEW_ROWS)} />
      )}

      {parsed && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <TableIcon className="size-4 text-muted-foreground" />
            <Label className="text-xs text-muted-foreground">Zieltabelle in {schema}</Label>
            <Select value={targetTable ?? undefined} onValueChange={(v) => void handlePickTable(v)}>
              <SelectTrigger size="sm" className="w-72">
                <SelectValue placeholder="Tabelle wählen…" />
              </SelectTrigger>
              <SelectContent>
                {(tables.data ?? []).map((table) => (
                  <SelectItem key={`${table.schema}.${table.name}`} value={table.name}>
                    {table.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {targetColumns.length > 0 && (
            <CsvMappingTable
              headers={parsed.headers}
              sampleRow={parsed.rows[0]}
              mappings={mappings}
              targets={targetColumns}
              onChange={handleMappingChange}
            />
          )}
        </div>
      )}

      {issues && issues.errors.length > 0 && (
        <ul className="space-y-1 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {issues.errors.slice(0, 10).map((error, index) => (
            <li key={index}>{error}</li>
          ))}
        </ul>
      )}

      {issues && issues.warnings.length > 0 && (
        <ul className="space-y-1 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-600">
          {issues.warnings.slice(0, 10).map((warning, index) => (
            <li key={index}>{warning}</li>
          ))}
        </ul>
      )}

      {openTransaction && (
        <p className="flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-600">
          <AlertTriangleIcon className="size-4 shrink-0" />
          Offene Transaktion für diese Verbindung. Erst abschließen, dann importieren.
        </p>
      )}

      {tooManyRows && (
        <p className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          Mehr als {CSV_MAX_IMPORT_ROWS} Zeilen. Import ist auf {CSV_MAX_IMPORT_ROWS} Zeilen und 10
          MB begrenzt.
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button size="sm" disabled={blocked || running} onClick={() => void handleImport()}>
          {running ? "Import läuft…" : "Importieren"}
        </Button>
        {parsed && targetTable && (
          <span className="text-xs text-muted-foreground">
            {rowCount} Zeile(n) nach {schema}.{targetTable}
          </span>
        )}
      </div>

      {outcome?.error && (
        <p className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 font-mono text-xs text-destructive">
          Import zurückgerollt
          {outcome.failed_row !== null ? `, Datensatz ${outcome.failed_row}` : ""}
          {outcome.failed_column ? `, Spalte "${outcome.failed_column}"` : ""}: {outcome.error}
        </p>
      )}

      {outcome && !outcome.error && (
        <p className="flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-600">
          <CheckCircle2Icon className="size-4 shrink-0" />
          {outcome.inserted_rows} Zeile(n) importiert.
        </p>
      )}
    </div>
  );
}
