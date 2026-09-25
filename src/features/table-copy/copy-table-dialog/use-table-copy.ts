import { useQuery } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  isReadOnlyConnection,
  type SavedConnection,
  useActiveConnection,
  useConnectionsStore,
  visibleSchemas,
} from "@/lib/connections";
import {
  cancelExecution,
  copyTableToConnection,
  listSchemas,
  type TableCopyMode,
  type TableCopyOutcome,
  type TableCopyProgress,
} from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { capabilitiesFor } from "@/lib/providers";
import { prepareConnection } from "@/lib/schema-compare/store";
import { effectiveConnectionString } from "@/lib/ssh";

export interface TableCopySource {
  schema: string;
  name: string;
}

export function useTableCopy(source: TableCopySource | null, onClose: () => void) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const connections = useConnectionsStore((state) => state.connections);
  const [targetId, setTargetId] = useState("");
  const [targetSchema, setTargetSchema] = useState("");
  const [targetTable, setTargetTable] = useState("");
  const [mode, setMode] = useState<TableCopyMode>("create");
  const [includePrimaryKey, setIncludePrimaryKey] = useState(true);
  const [includeIndexes, setIncludeIndexes] = useState(true);
  const [preview, setPreview] = useState<TableCopyOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [progressRows, setProgressRows] = useState(0);
  const jobIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!source) return;
    setTargetId("");
    setTargetSchema("");
    setTargetTable(source.name);
    setMode("create");
    setPreview(null);
  }, [source]);

  const target = connections.find((entry) => entry.id === targetId) ?? null;
  const sameConnection = target?.id === connection?.id;
  const targetDatabase = sameConnection ? (database ?? undefined) : undefined;
  const readOnly = isReadOnlyConnection(target);
  const unsupported = Boolean(target && !capabilitiesFor(target.kind).table_copy);

  const schemasQuery = useQuery({
    queryKey: ["table-copy-schemas", targetId, targetDatabase],
    queryFn: async () => {
      const ready = await prepareConnection(targetId);
      return visibleSchemas(
        ready,
        await listSchemas(ready.kind, effectiveConnectionString(ready), targetDatabase),
      );
    },
    enabled: Boolean(source && target && !unsupported),
    retry: false,
  });
  const schemas = schemasQuery.data;

  useEffect(() => {
    if (schemas?.length && !schemas.includes(targetSchema)) setTargetSchema(schemas[0]);
  }, [schemas, targetSchema]);

  useEffect(() => {
    if (!busy) return;
    let active = true;
    const unlistenPromise = listen<TableCopyProgress>("table-copy-progress", (event) => {
      if (active && event.payload.jobId === jobIdRef.current) setProgressRows(event.payload.rows);
    });
    return () => {
      active = false;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [busy]);

  const ready =
    Boolean(source && connection && target && targetTable.trim()) &&
    !readOnly &&
    !unsupported &&
    (schemas?.length === 0 || Boolean(targetSchema));

  const run = async (dryRun: boolean) => {
    if (!source || !connection || !target || busy) return;
    setBusy(true);
    setProgressRows(0);
    const jobId = crypto.randomUUID();
    jobIdRef.current = jobId;
    try {
      const fresh: SavedConnection = await prepareConnection(target.id);
      const outcome = await copyTableToConnection(
        fresh.kind,
        effectiveConnectionString(fresh),
        {
          source: {
            kind: connection.kind,
            connectionString: effectiveConnectionString(connection),
            database: database ?? null,
            schema: source.schema,
            table: source.name,
          },
          targetSchema,
          targetTable: targetTable.trim(),
          mode,
          includePrimaryKey,
          includeIndexes,
          dryRun,
        },
        targetDatabase,
        { jobId },
      );
      if (!dryRun) for (const warning of outcome.warnings) toast.warning(warning);
      if (outcome.error) {
        setPreview(outcome);
        toast.error(outcome.error);
      } else if (dryRun) {
        setPreview(outcome);
      } else {
        toast.success(`${outcome.rows} Zeilen nach ${fresh.name} kopiert.`);
        onClose();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      jobIdRef.current = null;
      setBusy(false);
    }
  };

  const cancel = () => {
    if (jobIdRef.current) void cancelExecution(jobIdRef.current);
  };

  return {
    target,
    setTargetId: (id: string) => {
      setTargetId(id);
      setTargetSchema("");
      setPreview(null);
    },
    schemas,
    schemasError: schemasQuery.error,
    targetSchema,
    setTargetSchema,
    targetTable,
    setTargetTable,
    mode,
    setMode,
    includePrimaryKey,
    setIncludePrimaryKey,
    includeIndexes,
    setIncludeIndexes,
    preview,
    busy,
    progressRows,
    readOnly,
    unsupported,
    ready,
    run,
    cancel,
  };
}
