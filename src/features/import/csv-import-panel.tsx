import {
  AlertTriangleIcon,
  ArrowRightIcon,
  BookmarkIcon,
  CheckCircle2Icon,
  UploadIcon,
} from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CsvPresetBar } from "@/features/import/csv-preset-bar";
import { CSV_MAX_IMPORT_ROWS, CSV_PREVIEW_ROWS, parseCsv } from "@/lib/csv-import";
import { remapPreset } from "@/lib/csv-mapping-presets";
import { cancelTask, isTaskActive } from "@/lib/tasks";
import { CsvConflictOptions } from "./csv-conflict-options";
import { CsvParseOptions } from "./csv-import-panel/csv-parse-options";
import { StructuredParseOptions } from "./csv-import-panel/structured-parse-options";
import type { CsvImportState } from "./csv-import-panel/use-csv-import";
import { CsvMappingTable } from "./csv-mapping-table";
import { CsvPreviewTable } from "./csv-preview-table";

export function CsvImportPanel({
  csv,
  actions,
  onPickFile,
}: {
  csv: CsvImportState;
  actions: HTMLElement | null;
  onPickFile: () => void;
}) {
  const {
    format,
    sheet,
    setSheet,
    skipRows,
    setSkipRows,
    structured,
    mappingTargets,
    inferredTypes,
    conflictsSupported,
    conflict,
    setConflict,
    blocked,
    connection,
    database,
    emptyField,
    fileError,
    fileName,
    filePath,
    handleImport,
    handleMappingChange,
    handlePickTable,
    issues,
    mappings,
    openTransaction,
    outcome,
    parsed,
    quote,
    rowCount,
    running,
    schema,
    setDelimiter,
    setEmptyField,
    setFileError,
    setHasHeader,
    setMappings,
    setQuote,
    tables,
    targetColumns,
    targetTable,
    task,
    text,
    tooManyRows,
  } = csv;
  const [previewMode, setPreviewMode] = useState<"mapped" | "file">("mapped");
  const mapped = mappings.filter((mapping) => mapping.target !== null);
  const showMapped = previewMode === "mapped" && mapped.length > 0;
  const previewRows = parsed?.rows.slice(0, CSV_PREVIEW_ROWS) ?? [];
  const numericType = (index: number) =>
    inferredTypes[index] === "integer" || inferredTypes[index] === "decimal";
  const total = parsed?.totalRows;
  const active = Boolean(task && isTaskActive(task));

  const tablePicker = (
    <Select value={targetTable ?? undefined} onValueChange={(v) => void handlePickTable(v)}>
      <SelectTrigger
        size="sm"
        aria-label={`Zieltabelle in ${schema}`}
        className="h-7 w-auto min-w-36 gap-1 font-mono text-xs"
      >
        <span className="text-muted-foreground">{schema}.</span>
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
  );

  return (
    <fieldset disabled={running} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        id="import-step-source"
        className="flex min-h-10 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-1.5"
      >
        <span className="min-w-0 truncate font-mono text-sm">
          {fileName ?? "Keine Datei gewählt"}
        </span>
        <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
        {tablePicker}
        <div className="ml-auto flex items-center gap-2">
          {filePath && format !== "csv" && (
            <StructuredParseOptions
              format={format}
              structured={structured}
              sheet={sheet}
              setSheet={setSheet}
              skipRows={skipRows}
              setSkipRows={setSkipRows}
              parsed={parsed}
              setHasHeader={setHasHeader}
              emptyField={emptyField}
              setEmptyField={setEmptyField}
            />
          )}
          {parsed && format === "csv" && (
            <CsvParseOptions
              parsed={parsed}
              quote={quote}
              setDelimiter={setDelimiter}
              setQuote={setQuote}
              setHasHeader={setHasHeader}
              emptyField={emptyField}
              setEmptyField={setEmptyField}
            />
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {fileError && (
          <p className="border-b bg-destructive/5 px-4 py-2 font-mono text-xs text-destructive">
            {fileError}
          </p>
        )}
        {outcome?.error && (
          <p className="border-b bg-destructive/5 px-4 py-2 font-mono text-xs text-destructive">
            Import fehlgeschlagen
            {outcome.failed_row !== null ? `, Datensatz ${outcome.failed_row}` : ""}
            {outcome.failed_column ? `, Spalte "${outcome.failed_column}"` : ""}: {outcome.error}
          </p>
        )}
        {outcome && !outcome.error && (
          <p className="flex items-center gap-2 border-b bg-emerald-500/5 px-4 py-2 text-xs text-emerald-700 dark:text-emerald-400">
            <CheckCircle2Icon className="size-4 shrink-0" />
            {outcome.inserted_rows} eingefügt · {outcome.updated_rows ?? 0} aktualisiert ·{" "}
            {outcome.skipped_rows ?? 0} übersprungen.
          </p>
        )}
        {openTransaction && (
          <p className="flex items-center gap-2 border-b bg-amber-500/5 px-4 py-2 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangleIcon className="size-4 shrink-0" />
            Offene Transaktion für diese Verbindung. Erst abschließen, dann importieren.
          </p>
        )}
        {tooManyRows && (
          <p className="border-b bg-destructive/5 px-4 py-2 text-xs text-destructive">
            Mehr als {CSV_MAX_IMPORT_ROWS} Zeilen. Import ist auf {CSV_MAX_IMPORT_ROWS} Zeilen und
            10 MB begrenzt.
          </p>
        )}

        {!fileName && (
          <div className="flex flex-col items-center justify-center gap-2 py-24 text-center">
            <Button variant="outline" size="sm" onClick={onPickFile}>
              <UploadIcon />
              Datendatei wählen…
            </Button>
            {targetTable && (
              <span className="text-xs text-muted-foreground">
                Ziel: <span className="font-mono">{`${schema}.${targetTable}`}</span>
              </span>
            )}
          </div>
        )}

        {parsed && mappingTargets.length > 0 && (
          <section id="import-step-mapping" className="border-b">
            <div className="flex h-9 items-center gap-2 px-4">
              <h3 className="text-xs font-semibold">Zuordnung</h3>
              <span className="text-xs text-muted-foreground tabular-nums">
                {mapped.length} von {parsed.headers.length} Spalten
              </span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="xs" className="ml-auto">
                    <BookmarkIcon />
                    Vorlagen
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-auto max-w-xl">
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
                        const preview =
                          format !== "csv" && parsed
                            ? parsed
                            : parseCsv(text ?? "", {
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
                </PopoverContent>
              </Popover>
            </div>
            <CsvMappingTable
              headers={parsed.headers}
              sampleRow={parsed.rows[0]}
              mappings={mappings}
              targets={mappingTargets}
              inferredTypes={inferredTypes}
              onChange={handleMappingChange}
            />
          </section>
        )}

        {connection && targetTable && conflictsSupported && (
          <section id="import-step-options" className="border-b px-4 py-3">
            <CsvConflictOptions
              key={`${connection.id}-${database}-${schema}-${targetTable}`}
              connection={connection}
              database={database}
              schema={schema}
              table={targetTable}
              columns={targetColumns}
              mapped={mappings.flatMap((mapping) => (mapping.target ? [mapping.target] : []))}
              value={conflict}
              onChange={setConflict}
            />
          </section>
        )}

        {issues && (issues.errors.length > 0 || issues.warnings.length > 0) && (
          <ul className="space-y-1 border-b px-4 py-2 text-xs">
            {issues.errors.slice(0, 10).map((error, index) => (
              <li key={`e${index}`} className="text-destructive">
                {error}
              </li>
            ))}
            {issues.warnings.slice(0, 10).map((warning, index) => (
              <li key={`w${index}`} className="text-amber-700 dark:text-amber-400">
                {warning}
              </li>
            ))}
          </ul>
        )}

        {parsed && (
          <section id="import-step-run">
            <div className="flex h-9 items-center gap-2 px-4">
              <h3 className="text-xs font-semibold">Vorschau</h3>
              <span className="truncate text-xs text-muted-foreground tabular-nums">
                erste {Math.min(rowCount, CSV_PREVIEW_ROWS)} von{" "}
                {total === null || total === undefined
                  ? `mehr als ${rowCount.toLocaleString("de-DE")}`
                  : total.toLocaleString("de-DE")}{" "}
                Zeilen
                {parsed.raggedRows.length > 0 &&
                  ` · ${parsed.raggedRows.length} Zeile(n) mit abweichender Spaltenzahl`}
              </span>
              <Tabs
                value={showMapped ? "mapped" : "file"}
                onValueChange={(value) => setPreviewMode(value as "mapped" | "file")}
                className="ml-auto"
              >
                <TabsList aria-label="Vorschau" className="group-data-horizontal/tabs:h-7">
                  <TabsTrigger
                    value="mapped"
                    disabled={mapped.length === 0}
                    className="flex-none px-2 text-xs"
                  >
                    Zugeordnet
                  </TabsTrigger>
                  <TabsTrigger value="file" className="flex-none px-2 text-xs">
                    Datei
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            {showMapped ? (
              <CsvPreviewTable
                headers={mapped.map((mapping) => mapping.target ?? "")}
                rows={previewRows.map((row) => mapped.map((mapping) => row[mapping.csvIndex]))}
                numeric={mapped.map((mapping) => numericType(mapping.csvIndex))}
              />
            ) : (
              <CsvPreviewTable
                headers={parsed.headers}
                rows={previewRows}
                numeric={parsed.headers.map((_, index) => numericType(index))}
              />
            )}
            {structured?.source_types.some(Boolean) && (
              <p className="px-4 py-2 font-mono text-[11px] text-muted-foreground">
                {structured.columns
                  .map((column, index) => `${column}: ${structured.source_types[index] ?? "?"}`)
                  .join(" · ")}
              </p>
            )}
          </section>
        )}
      </div>

      {actions &&
        createPortal(
          <>
            {active && task && (
              <>
                <span className="text-xs text-muted-foreground tabular-nums" role="status">
                  {task.progress ?? 0}
                  {task.total !== undefined ? ` / ${task.total}` : ""} Zeilen
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
              </>
            )}
            {!active && parsed && targetTable && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {parsed.truncated ? "Alle Datensätze" : `${rowCount} Zeile(n)`} nach {schema}.
                {targetTable}
              </span>
            )}
            <Button size="sm" disabled={blocked || running} onClick={() => void handleImport()}>
              {running ? <Spinner className="size-3.5" /> : <UploadIcon />}
              {running ? "Import läuft…" : "Importieren"}
            </Button>
          </>,
          actions,
        )}
    </fieldset>
  );
}
