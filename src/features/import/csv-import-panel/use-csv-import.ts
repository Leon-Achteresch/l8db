import { useEffect, useMemo, useRef, useState } from "react";
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
import { listImportColumns } from "@/lib/db";
import { useActiveDatabase, useActiveSchema } from "@/lib/db-selection";
import { useCsvImportField } from "@/lib/hooks/use-csv-import-field";
import { pickImportFile, readCsvImportFile } from "@/lib/import-file";
import { useTablesQuery } from "@/lib/queries";
import { effectiveConnectionString } from "@/lib/ssh";
import { isTaskActive, useTasksStore } from "@/lib/tasks";
import { getTransactionForConnection, useTransactionStore } from "@/lib/transactions";

export function useCsvImport() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const schema = useActiveSchema();
  const tables = useTablesQuery();
  const transactions = useTransactionStore((state) => state.transactions);

  const scopeKey = JSON.stringify([connection?.id, database, schema]);
  const [partial, setPartial] = useCsvImportField(scopeKey, "partial");
  const [conflict, setConflict] = useCsvImportField(scopeKey, "conflict");
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
    void readCsvImportFile(filePath)
      .then((file) => {
        if (active) {
          setText(file.text);
          setPartial(file.partial);
        }
      })
      .catch((failure) => {
        if (active) setFileError(`Datei erneut wählen: ${String(failure)}`);
      });
    return () => {
      active = false;
    };
  }, [filePath, text, setText, setPartial]);

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
      partial,
    });
  }, [text, delimiter, quote, hasHeader, emptyField, partial]);

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
      setPartial("partial" in file && file.partial === true);
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
    setConflict(undefined);
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
    if (!connection || !parsed || blocked || running) return;
    setRunning(true);
    setOutcome(null);
    try {
      const payload = buildImportPayload(mappings, parsed.rows);
      const result = await runCsvImport(
        connection,
        database,
        {
          conflict,
          schema,
          table: targetTable,
          columns: payload.columns,
          rows: filePath ? [] : payload.rows,
          file: filePath
            ? {
                path: filePath,
                delimiter: parsed.delimiter,
                quote,
                has_header: parsed.hasHeader,
                empty_as_null: emptyField === "null",
                indices: mappings
                  .filter((mapping) => mapping.target !== null)
                  .map((mapping) => mapping.csvIndex),
              }
            : undefined,
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
  const tooManyRows = !filePath && (parsed?.truncated === true || rowCount > CSV_MAX_IMPORT_ROWS);
  const blocked =
    !parsed ||
    parsed.errors.length > 0 ||
    columnsLoading ||
    !targetTable ||
    rowCount === 0 ||
    tooManyRows ||
    Boolean(conflict && !conflict.constraint) ||
    Boolean(openTransaction) ||
    (issues?.errors.length ?? 1) > 0;

  return {
    conflict,
    setConflict,
    blocked,
    connection,
    database,
    emptyField,
    fileError: parsed?.errors.map((error) => error.message).join(" ") || fileError,
    fileName,
    handleImport,
    handleMappingChange,
    handlePickFile,
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
  };
}
export type CsvImportState = ReturnType<typeof useCsvImport>;
