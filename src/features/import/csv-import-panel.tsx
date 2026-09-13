import { AlertTriangleIcon, CheckCircle2Icon, TableIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { CsvPresetBar } from "@/features/import/csv-preset-bar";
import { useActiveConnection } from "@/lib/connections";
import {
  buildImportPayload,
  CSV_MAX_IMPORT_ROWS,
  CSV_PREVIEW_ROWS,
  type CsvParseResult,
  parseCsv,
  suggestMappings,
  validateMappings,
} from "@/lib/csv-import";
import { runCsvImport } from "@/lib/csv-import-runner";
import { remapPreset } from "@/lib/csv-mapping-presets";
import { listImportColumns } from "@/lib/db";
import { useActiveDatabase, useActiveSchema } from "@/lib/db-selection";
import { useCsvImportField } from "@/lib/hooks/use-csv-import-field";
import { pickImportFile, readImportFile } from "@/lib/import-file";
import { useTablesQuery } from "@/lib/queries";
import { effectiveConnectionString } from "@/lib/ssh";
import { cancelTask, isTaskActive, useTasksStore } from "@/lib/tasks";
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

  const scopeKey = JSON.stringify([connection?.id, database, schema]);
  const [fileName, setFileName] = useCsvImportField(scopeKey, "fileName");
  const [filePath, setFilePath] = useCsvImportField(scopeKey, "filePath");
  const [text, setText] = useCsvImportField(scopeKey, "text");
  const [delimiter, setDelimiter] = useCsvImportField(scopeKey, "delimiter");
  const [quote, setQuote] = useCsvImportField(scopeKey, "quote");
  const [hasHeader, setHasHeader] = useCsvImportField(scopeKey, "hasHeader");
  const [emptyField, setEmptyField] = useCsvImportField(scopeKey, "emptyField");
  const [targetTable, setTargetTable] = useCsvImportField(scopeKey, "targetTable");
  const [targetColumns, setTargetColumns] = useCsvImportField(scopeKey, "targetColumns");
  const [mappings, setMappings] = useCsvImportField(scopeKey, "mappings");
  const [outcome, setOutcome] = useCsvImportField(scopeKey, "outcome");
  const [jobId, setJobId] = useCsvImportField(scopeKey, "jobId");
  const [fileError, setFileError] = useState<string | null>(null);
  const [starting, setRunning] = useState(false);
  const [columnsLoading, setColumnsLoading] = useState(false);
  const requestSequence = useRef(0);
  const task = useTasksStore((state) => state.tasks.find((entry) => entry.id === jobId));
  const running = starting || Boolean(task && isTaskActive(task));
  useEffect(() => {
    if (!filePath || text !== null) return;
    let active = true;
    void readImportFile(filePath)
      .then((file) => {
        if (active) setText(file.text);
      })
      .catch((failure) => {
        if (active) setFileError(`Datei erneut wählen: ${String(failure)}`);
      });
    return () => {
      active = false;
    };
  }, [filePath, text, setText]);

  useEffect(() => {
    if (!connection || !targetTable) return;
    let active = true;
    setColumnsLoading(true);
    void listImportColumns(
      connection.kind,
      effectiveConnectionString(connection),
      schema,
      targetTable,
      database ?? undefined,
    )
      .then((columns) => {
        if (active) setTargetColumns(columns);
      })
      .catch((failure) => {
        if (active) {
          setTargetColumns([]);
          setFileError(String(failure));
        }
      })
      .finally(() => {
        if (active) setColumnsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [connection, database, schema, targetTable, setTargetColumns]);

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
    try {
      const file = await pickImportFile("csv");
      if (!file) return;
      const detected = parseCsv(file.text, { maxRows: CSV_PREVIEW_ROWS });
      setFileName(file.name);
      setFilePath(file.path);
      setText(file.text);
      setDelimiter(detected.delimiter);
      setHasHeader(detected.hasHeader);
      setOutcome(null);
      setMappings(targetColumns.length ? suggestMappings(detected.headers, targetColumns) : []);
    } catch (failure) {
      setFileError(String(failure));
    }
  };

  const handlePickTable = async (table: string) => {
    setTargetTable(table);
    setOutcome(null);
    if (!connection) return;
    const sequence = ++requestSequence.current;
    setColumnsLoading(true);
    try {
      const columns = await listImportColumns(
        connection.kind,
        effectiveConnectionString(connection),
        schema,
        table,
        database ?? undefined,
      );
      if (sequence !== requestSequence.current) return;
      setTargetColumns(columns);
      setMappings(parsed ? suggestMappings(parsed.headers, columns) : []);
      setFileError(null);
    } catch (err) {
      if (sequence !== requestSequence.current) return;
      setTargetColumns([]);
      setMappings([]);
      setFileError(typeof err === "string" ? err : String(err));
    } finally {
      if (sequence === requestSequence.current) setColumnsLoading(false);
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
    if (!connection || !parsed || !targetTable || running || columnsLoading) return;
    setRunning(true);
    setOutcome(null);
    try {
      const payload = buildImportPayload(mappings, parsed.rows);
      const result = await runCsvImport(
        connection,
        database,
        {
          schema,
          table: targetTable,
          columns: payload.columns,
          rows: payload.rows,
        },
        setJobId,
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
    columnsLoading ||
    !targetTable ||
    rowCount === 0 ||
    tooManyRows ||
    Boolean(openTransaction) ||
    (issues?.errors.length ?? 1) > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <p className="text-xs text-muted-foreground">
        Ziel: {connection?.name} · {database} · {schema}
      </p>
      {task && isTaskActive(task) && (
        <div className="flex items-center gap-3" role="status">
          <span className="text-xs">
            {task.progress ?? 0} / {task.total ?? 0} Zeilen verarbeitet
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={!task.cancellable || task.status === "cancelling"}
            onClick={() =>
              void cancelTask(task.id).catch((failure) => setFileError(String(failure)))
            }
          >
            Abbrechen
          </Button>
        </div>
      )}
      <fieldset disabled={running} className="contents">
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
              <Badge
                variant="outline"
                className="border-amber-500/30 bg-amber-500/5 text-amber-600"
              >
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
              <Select
                value={targetTable ?? undefined}
                onValueChange={(v) => void handlePickTable(v)}
              >
                <SelectTrigger size="sm" className="w-72">
                  <SelectValue placeholder="Tabelle wählen…" />
                </SelectTrigger>
                <SelectContent searchable>
                  {(tables.data ?? []).map((table) => (
                    <SelectItem key={`${table.schema}.${table.name}`} value={table.name}>
                      {table.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {targetColumns.length > 0 && (
              <>
                <CsvPresetBar
                  value={{
                    scope: JSON.stringify([connection?.id, database, schema, targetTable]),
                    headers: parsed.headers,
                    mappings,
                    delimiter: parsed.delimiter,
                    quote,
                    hasHeader: parsed.hasHeader,
                    emptyField,
                  }}
                  onLoad={(preset) => {
                    try {
                      const preview = parseCsv(text ?? "", {
                        delimiter: preset.delimiter,
                        quote: preset.quote,
                        hasHeader: preset.hasHeader,
                        emptyField: preset.emptyField,
                        maxRows: CSV_MAX_IMPORT_ROWS,
                      });
                      const next = remapPreset(preset, preview.headers);
                      setDelimiter(preset.delimiter);
                      setQuote(preset.quote);
                      setHasHeader(preset.hasHeader);
                      setEmptyField(preset.emptyField);
                      setMappings(next);
                      setFileError(null);
                    } catch (failure) {
                      setFileError(String(failure));
                    }
                  }}
                />
                <CsvMappingTable
                  headers={parsed.headers}
                  sampleRow={parsed.rows[0]}
                  mappings={mappings}
                  targets={targetColumns}
                  onChange={handleMappingChange}
                />
              </>
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
            Mehr als {CSV_MAX_IMPORT_ROWS} Zeilen. Import ist auf {CSV_MAX_IMPORT_ROWS} Zeilen und
            10 MB begrenzt.
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
            Import fehlgeschlagen
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
      </fieldset>
    </div>
  );
}
