import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { SavedConnection } from "@/lib/connections";
import { datagenIssues, runDatagen } from "@/lib/datagen";
import {
  cancelExecution,
  type DatagenColumn,
  type DatagenLocale,
  type DatagenPlan,
  type DatagenPreview,
  type DatagenRequest,
  datagenPlan,
  datagenPreview,
} from "@/lib/db";
import type { ColumnMask } from "@/lib/masking";
import { capabilitiesFor } from "@/lib/providers";
import { effectiveConnectionString } from "@/lib/ssh";

export type DatagenMode = "generate" | "copy";

interface Options {
  open: boolean;
  connection: SavedConnection;
  database: string | null;
  schema: string;
  table: string;
  onComplete: () => void;
}

export function useTestData({ open, connection, database, schema, table, onComplete }: Options) {
  const transactional = capabilitiesFor(connection.kind).transactions;
  const [mode, setMode] = useState<DatagenMode>("generate");
  const [targetSchema, setTargetSchema] = useState(schema);
  const [targetTable, setTargetTable] = useState(table);
  const [plan, setPlan] = useState<DatagenPlan | null>(null);
  const [columns, setColumns] = useState<DatagenColumn[]>([]);
  const [masks, setMasks] = useState<ColumnMask[]>([]);
  const [rows, setRows] = useState(1000);
  const [batchSize, setBatchSize] = useState(1000);
  const [seed, setSeed] = useState(1);
  const [locale, setLocale] = useState<DatagenLocale>("de");
  const [transaction, setTransaction] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<DatagenPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const jobRef = useRef<string | null>(null);

  const planSchema = mode === "copy" ? targetSchema : schema;
  const planTable = mode === "copy" ? targetTable : table;

  useEffect(() => {
    if (!open || !planTable.trim()) return;
    let active = true;
    setLoading(true);
    setError(null);
    setPreview(null);
    datagenPlan(
      connection.kind,
      effectiveConnectionString(connection),
      planSchema,
      planTable,
      database ?? undefined,
    )
      .then((next) => {
        if (!active) return;
        setPlan(next);
        setColumns(next.columns);
      })
      .catch((err) => {
        if (!active) return;
        setPlan(null);
        setColumns([]);
        setError(String(err));
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [open, connection, database, planSchema, planTable]);

  const request = useMemo<DatagenRequest>(
    () => ({
      schema: planSchema,
      table: planTable,
      rows,
      batchSize,
      seed,
      locale,
      transaction: transaction && transactional,
      columns:
        mode === "copy"
          ? columns.map((column) => ({
              ...column,
              generator:
                column.generator.kind === "skip" ? column.generator : { kind: "null" as const },
              nullRatio: 0,
            }))
          : columns,
      unique: plan?.unique ?? [],
      source: mode === "copy" ? { schema, table, masks } : null,
    }),
    [
      planSchema,
      planTable,
      rows,
      batchSize,
      seed,
      locale,
      transaction,
      transactional,
      columns,
      plan,
      mode,
      schema,
      table,
      masks,
    ],
  );

  const issues = useMemo(() => (plan ? datagenIssues(request) : []), [plan, request]);

  const updateColumn = (name: string, patch: Partial<DatagenColumn>) => {
    setColumns((current) =>
      current.map((column) => (column.name === name ? { ...column, ...patch } : column)),
    );
    setPreview(null);
  };

  const setMask = (column: string, mask: ColumnMask | null) => {
    setMasks((current) => [
      ...current.filter((entry) => entry.column !== column),
      ...(mask ? [mask] : []),
    ]);
    setPreview(null);
  };

  const loadPreview = async () => {
    setPreviewing(true);
    setError(null);
    try {
      setPreview(
        await datagenPreview(
          connection.kind,
          effectiveConnectionString(connection),
          request,
          database ?? undefined,
        ),
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setPreviewing(false);
    }
  };

  const run = async () => {
    setRunning(true);
    setProgress(0);
    setError(null);
    try {
      const outcome = await runDatagen(connection, database, request, setProgress, (id) => {
        jobRef.current = id;
      });
      if (outcome.cancelled) {
        toast.warning(
          request.transaction
            ? "Abgebrochen – alle Zeilen zurückgerollt."
            : `Abgebrochen nach ${outcome.inserted.toLocaleString("de-DE")} Zeilen.`,
        );
      } else if (outcome.error) {
        setError(outcome.error);
        toast.error(
          request.transaction
            ? "Fehler – Transaktion zurückgerollt."
            : `Fehler nach ${outcome.inserted.toLocaleString("de-DE")} Zeilen.`,
        );
      } else {
        toast.success(`${outcome.inserted.toLocaleString("de-DE")} Zeilen eingefügt.`);
      }
      if (outcome.inserted > 0 || outcome.committed) onComplete();
    } catch (err) {
      setError(String(err));
    } finally {
      jobRef.current = null;
      setRunning(false);
    }
  };

  const cancel = () => {
    if (jobRef.current) void cancelExecution(jobRef.current);
  };

  return {
    mode,
    setMode,
    targetSchema,
    setTargetSchema,
    targetTable,
    setTargetTable,
    columns,
    updateColumn,
    masks,
    setMask,
    rows,
    setRows,
    batchSize,
    setBatchSize,
    seed,
    setSeed,
    locale,
    setLocale,
    transaction,
    setTransaction,
    loading,
    error,
    issues,
    preview,
    previewing,
    loadPreview,
    running,
    progress,
    run,
    cancel,
  };
}
