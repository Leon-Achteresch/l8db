import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { isReadOnlyConnection, type SavedConnection, useConnectionsStore } from "@/lib/connections";
import {
  cancelExecution,
  loadPartitionDdl,
  loadSchemaCatalog,
  planTransfer,
  runTransfer,
  type TransferEndpoint,
  type TransferOutcome,
  type TransferPlan,
  type TransferProgress,
} from "@/lib/db";
import { prepareConnection } from "@/lib/schema-compare/store";
import { defaultCompareTypes } from "@/lib/schema-compare/types";
import { effectiveConnectionString } from "@/lib/ssh";
import { nativeScript } from "@/lib/transfer/native-script";

export interface TransferSide {
  connectionId: string | null;
  database: string | null;
}

export const EMPTY_TRANSFER_SIDE: TransferSide = { connectionId: null, database: null };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function endpoint(connection: SavedConnection, database: string | null): TransferEndpoint {
  return {
    kind: connection.kind,
    connectionString: effectiveConnectionString(connection),
    database,
  };
}

async function withNativeStructure(
  plan: TransferPlan,
  source: TransferEndpoint,
  onStep: (text: string) => void,
): Promise<TransferPlan> {
  const next: TransferPlan = { ...plan, preData: [], postData: [], warnings: [...plan.warnings] };
  const types = defaultCompareTypes(source.kind);
  for (const pair of plan.schemas) {
    onStep(`Struktur von ${pair.source} wird gelesen…`);
    const objects = await loadSchemaCatalog(
      source.kind,
      source.connectionString,
      pair.source,
      types,
      source.database ?? undefined,
    );
    const partitioned = objects.filter(
      (object) =>
        object.object_type === "table" &&
        object.attributes.partitioned === "YES" &&
        !/PARTITION BY/i.test(object.ddl),
    );
    if (partitioned.length > 0) {
      const clauses = await loadPartitionDdl(
        source.kind,
        source.connectionString,
        pair.source,
        partitioned.map((object) => object.name),
        source.database ?? undefined,
      ).catch((): Record<string, string> => ({}));
      for (const object of partitioned)
        if (clauses[object.name]) object.ddl = `${object.ddl}\n${clauses[object.name]}`;
    }
    const script = nativeScript(source.kind, pair.source, pair.target, objects);
    next.preData.push(...script.preData);
    next.postData.push(...script.postData);
    next.warnings.push(...script.warnings);
  }
  return next;
}

export function useTransfer() {
  const connections = useConnectionsStore((state) => state.connections);
  const [source, setSource] = useState<TransferSide>(EMPTY_TRANSFER_SIDE);
  const [target, setTarget] = useState<TransferSide>(EMPTY_TRANSFER_SIDE);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [foldNames, setFoldNames] = useState(true);
  const [plan, setPlan] = useState<TransferPlan | null>(null);
  const [planning, setPlanning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<TransferProgress["progress"] | null>(null);
  const [outcome, setOutcome] = useState<TransferOutcome | null>(null);
  const jobIdRef = useRef<string | null>(null);

  const sourceConnection = connections.find((entry) => entry.id === source.connectionId) ?? null;
  const targetConnection = connections.find((entry) => entry.id === target.connectionId) ?? null;
  const readOnly = isReadOnlyConnection(targetConnection);
  const sameEndpoint =
    Boolean(sourceConnection && targetConnection) &&
    source.connectionId === target.connectionId &&
    (source.database ?? "") === (target.database ?? "") &&
    schemas.some((schema) => (mapping[schema] ?? schema) === schema);
  const pairs = schemas.map((schema) => ({
    source: schema,
    target: (mapping[schema] ?? "").trim() || schema,
  }));
  const ready =
    Boolean(sourceConnection && targetConnection) &&
    schemas.length > 0 &&
    !readOnly &&
    !sameEndpoint &&
    !running;

  useEffect(() => {
    if (!running) return;
    let active = true;
    const unlistenPromise = listen<TransferProgress>("transfer-progress", (event) => {
      if (active && event.payload.jobId === jobIdRef.current) setProgress(event.payload.progress);
    });
    return () => {
      active = false;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [running]);

  const invalidate = () => {
    setPlan(null);
    setOutcome(null);
    setError(null);
  };

  const analyze = async () => {
    if (!sourceConnection || !targetConnection || !ready) return;
    invalidate();
    setPlanning("Quelle wird analysiert…");
    try {
      const [left, right] = await Promise.all([
        prepareConnection(sourceConnection.id),
        prepareConnection(targetConnection.id),
      ]);
      const from = endpoint(left, source.database);
      let next = await planTransfer(
        right.kind,
        effectiveConnectionString(right),
        { source: from, schemas: pairs, foldNames },
        target.database ?? undefined,
      );
      if (next.native) next = await withNativeStructure(next, from, setPlanning);
      setPlan(next);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setPlanning(null);
    }
  };

  const start = async () => {
    if (!plan || !sourceConnection || !targetConnection || running) return;
    setRunning(true);
    setOutcome(null);
    setError(null);
    setProgress(null);
    const jobId = crypto.randomUUID();
    jobIdRef.current = jobId;
    try {
      const [left, right] = await Promise.all([
        prepareConnection(sourceConnection.id),
        prepareConnection(targetConnection.id),
      ]);
      const result = await runTransfer(
        right.kind,
        effectiveConnectionString(right),
        { source: endpoint(left, source.database), plan },
        target.database ?? undefined,
        { jobId },
      );
      setOutcome(result);
      if (result.committed)
        toast.success(`${result.rows} Zeilen in ${result.tables.length} Tabellen übertragen.`);
      else toast.error(result.error ?? "Transfer fehlgeschlagen.");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      jobIdRef.current = null;
      setRunning(false);
    }
  };

  const cancel = () => {
    if (jobIdRef.current) void cancelExecution(jobIdRef.current);
  };

  return {
    source,
    setSource: (value: TransferSide) => {
      setSource(value);
      setSchemas([]);
      invalidate();
    },
    target,
    setTarget: (value: TransferSide) => {
      setTarget(value);
      invalidate();
    },
    sourceConnection,
    targetConnection,
    schemas,
    setSchemas: (value: string[]) => {
      setSchemas(value);
      invalidate();
    },
    mapping,
    setMapping: (schema: string, value: string) => {
      setMapping((current) => ({ ...current, [schema]: value }));
      invalidate();
    },
    foldNames,
    setFoldNames: (value: boolean) => {
      setFoldNames(value);
      invalidate();
    },
    crossFamily: Boolean(
      sourceConnection && targetConnection && sourceConnection.kind !== targetConnection.kind,
    ),
    readOnly,
    sameEndpoint,
    ready,
    plan,
    planning,
    error,
    running,
    progress,
    outcome,
    analyze,
    start,
    cancel,
  };
}
