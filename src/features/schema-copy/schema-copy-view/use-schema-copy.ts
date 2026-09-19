import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { SavedConnection } from "@/lib/connections";
import {
  copySchemaTableData,
  executeSchemaObjectCopy,
  listSchemaCopyObjects,
  previewSchemaObjectCopy,
  type SchemaCopyObjectType,
  type SchemaObjectEntry,
} from "@/lib/db";
import { useActiveDatabase, useActiveSchema } from "@/lib/db-selection";
import { useSchemasQuery } from "@/lib/queries";
import { effectiveConnectionString } from "@/lib/ssh";
import { errorMessage, MAX_DATA_ROWS } from "./constants";

export function useSchemaCopy(connection: SavedConnection | null) {
  const database = useActiveDatabase();
  const activeSchema = useActiveSchema();
  const schemasQuery = useSchemasQuery();
  const schemas = useMemo(() => schemasQuery.data ?? [], [schemasQuery.data]);

  const [sourceSchema, setSourceSchema] = useState<string>("");
  const [targetSchema, setTargetSchema] = useState<string>("");
  const [objectType, setObjectType] = useState<SchemaCopyObjectType>("table");
  const [entries, setEntries] = useState<SchemaObjectEntry[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [focused, setFocused] = useState<string | null>(null);
  const [ddl, setDdl] = useState("");
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [transferData, setTransferData] = useState(false);
  const [rowLimit, setRowLimit] = useState("1000");
  const [dataRetry, setDataRetry] = useState<string[]>([]);
  const requestIdRef = useRef(0);

  const focusedEntry = entries.find((entry) => entry.name === focused) ?? null;
  const conflicts = selected.filter(
    (name) => entries.find((entry) => entry.name === name)?.status !== "missing",
  );
  const limit = Number.parseInt(rowLimit, 10);
  const limitValid = Number.isFinite(limit) && limit > 0 && limit <= MAX_DATA_ROWS;

  const loadEntries = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (!connection || !sourceSchema || !targetSchema || sourceSchema === targetSchema) {
      setEntries([]);
      setSelected([]);
      setFocused(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await listSchemaCopyObjects(
        connection.kind,
        effectiveConnectionString(connection),
        sourceSchema,
        targetSchema,
        objectType,
        database ?? undefined,
      );
      if (requestIdRef.current !== requestId) return;
      setEntries(list);
      setSelected([]);
      setFocused(list[0]?.name ?? null);
      setLoadError(null);
    } catch (error) {
      if (requestIdRef.current !== requestId) return;
      setEntries([]);
      setSelected([]);
      setFocused(null);
      setLoadError(errorMessage(error));
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }, [connection, database, objectType, sourceSchema, targetSchema]);

  useEffect(() => {
    if (!sourceSchema && activeSchema && schemas.includes(activeSchema))
      setSourceSchema(activeSchema);
  }, [activeSchema, schemas, sourceSchema]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  useEffect(() => {
    if (!connection || !focused || !sourceSchema || !targetSchema) {
      setDdl("");
      return;
    }
    let active = true;
    previewSchemaObjectCopy(
      connection.kind,
      effectiveConnectionString(connection),
      sourceSchema,
      targetSchema,
      objectType,
      focused,
      database ?? undefined,
    )
      .then((sql) => {
        if (active) setDdl(sql);
      })
      .catch((error) => {
        if (active) setDdl(`-- ${errorMessage(error)}`);
      });
    return () => {
      active = false;
    };
  }, [connection, database, focused, objectType, sourceSchema, targetSchema]);

  const toggle = (name: string) => {
    setSelected((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
    );
  };

  const handleExecute = async () => {
    if (!connection) return;
    if (conflicts.length > 0) {
      toast.error(
        `Namenskonflikt: ${conflicts.join(", ")} existiert bereits in ${targetSchema}. Auswahl anpassen.`,
      );
      return;
    }
    if (objectType === "table" && transferData && !limitValid) {
      toast.error(`Zeilenbegrenzung muss zwischen 1 und ${MAX_DATA_ROWS} liegen.`);
      return;
    }
    setRunning(true);
    const url = effectiveConnectionString(connection);
    const messages: string[] = [];
    const failedData: string[] = [];
    for (const name of selected) {
      try {
        await executeSchemaObjectCopy(
          connection.kind,
          url,
          sourceSchema,
          targetSchema,
          objectType,
          name,
          database ?? undefined,
        );
        messages.push(`${name}: Struktur erstellt`);
        if (objectType === "table" && transferData) {
          try {
            const rows = await copySchemaTableData(
              connection.kind,
              url,
              sourceSchema,
              targetSchema,
              name,
              limit,
              database ?? undefined,
            );
            messages.push(`${name}: ${rows} Zeilen übernommen`);
          } catch (error) {
            failedData.push(name);
            messages.push(`${name}: Datentransfer abgebrochen — ${errorMessage(error)}`);
          }
        }
      } catch (error) {
        messages.push(`${name}: fehlgeschlagen — ${errorMessage(error)}`);
      }
    }
    setLog(messages);
    setDataRetry(failedData);
    setRunning(false);
    toast.success(`${selected.length} Objekt(e) verarbeitet.`);
    await loadEntries();
  };

  const handleDataRetry = async () => {
    if (!connection || dataRetry.length === 0) return;
    if (!limitValid) {
      toast.error(`Zeilenbegrenzung muss zwischen 1 und ${MAX_DATA_ROWS} liegen.`);
      return;
    }
    setRunning(true);
    const url = effectiveConnectionString(connection);
    const messages: string[] = [];
    const stillFailed: string[] = [];
    for (const name of dataRetry) {
      try {
        const rows = await copySchemaTableData(
          connection.kind,
          url,
          sourceSchema,
          targetSchema,
          name,
          limit,
          database ?? undefined,
        );
        messages.push(`${name}: ${rows} Zeilen übernommen`);
      } catch (error) {
        stillFailed.push(name);
        messages.push(`${name}: Datentransfer abgebrochen — ${errorMessage(error)}`);
      }
    }
    setLog(messages);
    setDataRetry(stillFailed);
    setRunning(false);
  };

  return {
    conflicts,
    dataRetry,
    database,
    ddl,
    entries,
    focused,
    focusedEntry,
    handleDataRetry,
    handleExecute,
    limitValid,
    loadEntries,
    loadError,
    loading,
    log,
    objectType,
    rowLimit,
    running,
    schemas,
    selected,
    setFocused,
    setObjectType,
    setRowLimit,
    setSourceSchema,
    setTargetSchema,
    setTransferData,
    sourceSchema,
    targetSchema,
    toggle,
    transferData,
  };
}
