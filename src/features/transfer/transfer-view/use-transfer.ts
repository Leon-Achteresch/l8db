import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import {
  isReadOnlyConnection,
  type SavedConnection,
  useActiveConnection,
  useConnectionsStore,
} from "@/lib/connections";
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
  type TransferSchemaPair,
} from "@/lib/db";
import { databaseFromConnectionString, useActiveDatabase } from "@/lib/db-selection";
import { capabilitiesFor } from "@/lib/providers";
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
  const active = useActiveConnection();
  const activeDatabase = useActiveDatabase();
  const [source, setSource] = useState<TransferSide>(() =>
    active && capabilitiesFor(active.kind).table_copy
      ? {
          connectionId: active.id,
          database:
            activeDatabase ?? databaseFromConnectionString(effectiveConnectionString(active)),
        }
      : EMPTY_TRANSFER_SIDE,
  );
  const [target, setTarget] = useState<TransferSide>(EMPTY_TRANSFER_SIDE);
  const [sourceSchemas, setSourceSchemas] = useState<string[]>([]);
  const [targetSchemas, setTargetSchemas] = useState<string[]>([]);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [foldNames, setFoldNames] = useState(true);
  const [plan, setPlan] = useState<TransferPlan | null>(null);
  const [planning, setPlanning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<TransferProgress["progress"] | null>(null);
  const [outcome, setOutcome] = useState<TransferOutcome | null>(null);
  const [cinema, setCinema] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const jobIdRef = useRef<string | null>(null);
  const planRunRef = useRef(0);
  const configRef = useRef({ source, target, pairs: [] as TransferSchemaPair[], foldNames });

  const sourceConnection = connections.find((entry) => entry.id === source.connectionId) ?? null;
  const targetConnection = connections.find((entry) => entry.id === target.connectionId) ?? null;
  const readOnly = isReadOnlyConnection(targetConnection);
  const pairs = schemas.map((schema) => ({
    source: schema,
    target: (mapping[schema] ?? "").trim() || schema,
  }));
  const sameEndpoint =
    Boolean(sourceConnection && targetConnection) &&
    source.connectionId === target.connectionId &&
    (source.database ?? "") === (target.database ?? "") &&
    pairs.some((pair) => pair.source === pair.target);
  const ready =
    Boolean(sourceConnection && targetConnection) &&
    schemas.length > 0 &&
    !readOnly &&
    !sameEndpoint;
  const planKey = ready ? JSON.stringify([source, target, pairs, foldNames]) : null;
  configRef.current = { source, target, pairs, foldNames };

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

  useEffect(() => {
    setPlan(null);
    setError(null);
    setOutcome(null);
    const run = ++planRunRef.current;
    const config = configRef.current;
    if (!planKey || !config.source.connectionId || !config.target.connectionId) {
      setPlanning(null);
      return;
    }
    const alive = () => planRunRef.current === run;
    setPlanning("Plan wird erstellt…");
    const timer = window.setTimeout(async () => {
      try {
        const [left, right] = await Promise.all([
          prepareConnection(config.source.connectionId as string),
          prepareConnection(config.target.connectionId as string),
        ]);
        const from = endpoint(left, config.source.database);
        let next = await planTransfer(
          right.kind,
          effectiveConnectionString(right),
          { source: from, schemas: config.pairs, foldNames: config.foldNames },
          config.target.database ?? undefined,
        );
        if (!alive()) return;
        if (next.native)
          next = await withNativeStructure(next, from, (text) => {
            if (alive()) setPlanning(text);
          });
        if (alive()) setPlan(next);
      } catch (cause) {
        if (alive()) setError(errorText(cause));
      } finally {
        if (alive()) setPlanning(null);
      }
    }, 500);
    return () => {
      window.clearTimeout(timer);
    };
  }, [planKey]);

  const start = async () => {
    if (!plan || !sourceConnection || !targetConnection || running) return;
    setRunning(true);
    setOutcome(null);
    setError(null);
    setProgress(null);
    setStartedAt(Date.now());
    setCinema(true);
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
      if (result.committed) setPlan(null);
    } catch (cause) {
      setError(errorText(cause));
      setCinema(false);
    } finally {
      jobIdRef.current = null;
      setRunning(false);
    }
  };

  const cancel = () => {
    if (jobIdRef.current) void cancelExecution(jobIdRef.current);
  };

  const toggleSchema = (schema: string) =>
    setSchemas((current) =>
      current.includes(schema)
        ? current.filter((entry) => entry !== schema)
        : sourceSchemas.filter((entry) => entry === schema || current.includes(entry)),
    );

  return {
    source,
    setSource: (value: TransferSide) => {
      setSource(value);
      setSchemas([]);
    },
    target,
    setTarget,
    sourceConnection,
    targetConnection,
    sourceSchemas,
    setSourceSchemas,
    targetSchemas,
    setTargetSchemas,
    schemas,
    toggleSchema,
    setSchemas,
    mapping,
    setMapping: (schema: string, value: string) =>
      setMapping((current) => ({ ...current, [schema]: value })),
    foldNames,
    setFoldNames,
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
    cinema,
    closeCinema: () => setCinema(false),
    startedAt,
    start,
    cancel,
  };
}
