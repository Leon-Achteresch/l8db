import { useQuery } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  isReadOnlyConnection,
  type SavedConnection,
  useActiveConnection,
  useConnectionsStore,
} from "@/lib/connections";
import {
  cancelExecution,
  executeQuery,
  loadPartitionDdl,
  loadSchemaCatalog,
  planTransfer,
  runTransfer,
  type TransferContent,
  type TransferEndpoint,
  type TransferOutcome,
  type TransferPlan,
  type TransferProgress,
  type TransferSchemaPair,
} from "@/lib/db";
import { databaseFromConnectionString, useActiveDatabase } from "@/lib/db-selection";
import { prepareConnection } from "@/lib/prepare-connection";
import { capabilitiesFor } from "@/lib/providers";
import { compareTypesFor, defaultCompareTypes } from "@/lib/schema-compare/types";
import { oracleLoginSchema } from "@/lib/schema-selection";
import { effectiveConnectionString } from "@/lib/ssh";
import { readTabState, tabStateKey, useTabState, writeTabState } from "@/lib/tab-state";
import { ANY_SCHEMA_SQL, defaultTargetSchema } from "@/lib/transfer/default-target";
import {
  nativeScript,
  objectKey,
  pickableObjects,
  selectTables,
} from "@/lib/transfer/native-script";

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

const NATIVE_KINDS = new Set(["postgres", "mysql", "mssql", "oracle", "sqlite"]);

async function withNativeStructure(
  plan: TransferPlan,
  source: TransferEndpoint,
  excluded: Record<string, string[]> | null,
  onStep: (text: string) => void,
): Promise<TransferPlan> {
  const next: TransferPlan = { ...plan, preData: [], postData: [], warnings: [...plan.warnings] };
  const types =
    source.kind === "oracle" ? compareTypesFor(source.kind) : defaultCompareTypes(source.kind);
  for (const [index, pair] of plan.schemas.entries()) {
    onStep(
      `Struktur von ${pair.source} wird gelesen (Schema ${index + 1} von ${plan.schemas.length})…`,
    );
    const catalog = await loadSchemaCatalog(
      source.kind,
      source.connectionString,
      pair.source,
      types,
      source.database ?? undefined,
    );
    const skip = new Set(excluded?.[pair.source] ?? []);
    const picked =
      excluded && (pair.tables || skip.size > 0)
        ? [...new Set(pickableObjects(catalog).map(objectKey))].filter((key) => !skip.has(key))
        : undefined;
    const selection = selectTables(
      catalog,
      pair.tables &&
        plan.tables
          .filter((table) => table.sourceSchema === pair.source)
          .map((table) => table.sourceName),
      picked,
    );
    const objects = selection.objects;
    next.warnings.push(...selection.warnings);
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
  const scope = `tool:transfer:${active?.id ?? ""}`;
  const plannedKey = tabStateKey(scope, "plannedKey");
  const planStateKey = tabStateKey(scope, "plan");
  const [initialSource] = useState<TransferSide>(() =>
    active && capabilitiesFor(active.kind).table_copy
      ? {
          connectionId: active.id,
          database:
            activeDatabase ?? databaseFromConnectionString(effectiveConnectionString(active)),
        }
      : EMPTY_TRANSFER_SIDE,
  );
  const [source, setSource] = useTabState(tabStateKey(scope, "source"), initialSource);
  const [target, setTarget] = useTabState(tabStateKey(scope, "target"), EMPTY_TRANSFER_SIDE);
  const [sourceSchemas, setSourceSchemas] = useState<string[] | null>([]);
  const [targetSchemas, setTargetSchemas] = useState<string[] | null>([]);
  const [schemas, setSchemas] = useTabState<string[]>(tabStateKey(scope, "schemas"), []);
  const [mapping, setMapping] = useTabState<Record<string, string>>(
    tabStateKey(scope, "mapping"),
    {},
  );
  const [tables, setTables] = useTabState<Record<string, string[]>>(
    tabStateKey(scope, "tables"),
    {},
  );
  const [objects, setObjects] = useTabState<Record<string, string[]>>(
    tabStateKey(scope, "objects"),
    {},
  );
  const [content, setContent] = useTabState<TransferContent>(tabStateKey(scope, "content"), "all");
  const [foldNames, setFoldNames] = useTabState(tabStateKey(scope, "foldNames"), true);
  const [replaceTarget, setReplace] = useTabState(tabStateKey(scope, "replace"), false);
  const [plan, setPlan] = useTabState<TransferPlan | null>(planStateKey, null);
  const [planning, setPlanning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<TransferProgress["progress"] | null>(null);
  const [outcome, setOutcome] = useState<TransferOutcome | null>(null);
  const [cinema, setCinema] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const jobIdRef = useRef<string | null>(null);
  const planRunRef = useRef(0);
  const configRef = useRef({
    source,
    target,
    pairs: [] as TransferSchemaPair[],
    foldNames,
    replace: false,
    mirror: false,
    content,
    objects: null as Record<string, string[]> | null,
  });

  const sourceConnection = connections.find((entry) => entry.id === source.connectionId) ?? null;
  const targetConnection = connections.find((entry) => entry.id === target.connectionId) ?? null;
  const readOnly = isReadOnlyConnection(targetConnection);
  const sourceLogin = useMemo(
    () =>
      sourceConnection?.kind === "oracle"
        ? oracleLoginSchema(sourceConnection.connectionString, sourceSchemas ?? [])
        : null,
    [sourceConnection, sourceSchemas],
  );
  const targetLogin = useMemo(
    () =>
      targetConnection?.kind === "oracle"
        ? oracleLoginSchema(targetConnection.connectionString, targetSchemas ?? [])
        : null,
    [targetConnection, targetSchemas],
  );
  const targetId = targetConnection?.id ?? null;
  const anySchema = useQuery({
    queryKey: ["transfer-target-any-schema", targetId],
    enabled: Boolean(targetLogin && targetId),
    retry: false,
    staleTime: 300_000,
    queryFn: async () => {
      const ready = await prepareConnection(targetId as string);
      const result = await executeQuery(
        ready.kind,
        effectiveConnectionString(ready),
        ANY_SCHEMA_SQL,
      );
      return Number(Object.values(result.rows[0] ?? {})[0] ?? 0) > 0;
    },
  });
  const defaultTarget = (schema: string) =>
    defaultTargetSchema(schema, sourceLogin, targetLogin, anySchema.data !== false);
  const pairs: TransferSchemaPair[] = schemas.map((schema) => ({
    source: schema,
    target: (mapping[schema] ?? "").trim() || defaultTarget(schema),
    ...(tables[schema] ? { tables: tables[schema] } : {}),
  }));
  const replace = replaceTarget;
  const mirror =
    replace && content !== "data" && pairs.every((pair) => !pair.tables && !objects[pair.source]);
  const native =
    Boolean(sourceConnection && targetConnection) &&
    sourceConnection?.kind === targetConnection?.kind &&
    NATIVE_KINDS.has(sourceConnection?.kind ?? "");
  const picked = native && content !== "data" ? objects : null;
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
  const planKey = ready
    ? JSON.stringify([source, target, pairs, foldNames, replace, mirror, content, picked])
    : null;
  configRef.current = {
    source,
    target,
    pairs,
    foldNames,
    replace,
    mirror,
    content,
    objects: picked,
  };

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
    if (planKey && readTabState(plannedKey) === planKey && readTabState(planStateKey)) return;
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
    let job: string | null = null;
    setPlanning("Plan wird erstellt…");
    const timer = window.setTimeout(async () => {
      try {
        const [left, right] = await Promise.all([
          prepareConnection(config.source.connectionId as string),
          prepareConnection(config.target.connectionId as string),
        ]);
        const from = endpoint(left, config.source.database);
        if (!alive()) return;
        job = crypto.randomUUID();
        let next = await planTransfer(
          right.kind,
          effectiveConnectionString(right),
          {
            source: from,
            schemas: config.pairs,
            foldNames: config.foldNames,
            replace: config.replace,
            mirror: config.mirror,
            content: config.content,
          },
          config.target.database ?? undefined,
          { jobId: job },
        ).finally(() => {
          job = null;
        });
        if (!alive()) return;
        if (next.native && next.content !== "data")
          next = await withNativeStructure(next, from, config.objects, (text) => {
            if (alive()) setPlanning(text);
          });
        if (alive()) {
          setPlan(next);
          writeTabState(plannedKey, planKey);
        }
      } catch (cause) {
        if (alive()) setError(errorText(cause));
      } finally {
        if (alive()) setPlanning(null);
      }
    }, 500);
    return () => {
      window.clearTimeout(timer);
      if (job) void cancelExecution(job);
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
        : (sourceSchemas ?? []).filter((entry) => entry === schema || current.includes(entry)),
    );

  return {
    scope,
    source,
    setSource: (value: TransferSide) => {
      setSource(value);
      setSchemas([]);
      setTables({});
      setObjects({});
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
    defaultTarget,
    setMapping: (schema: string, value: string) =>
      setMapping((current) => ({ ...current, [schema]: value })),
    tables,
    setTables: (schema: string, value: string[] | null) =>
      setTables((current) => {
        const { [schema]: _, ...rest } = current;
        return value ? { ...rest, [schema]: value } : rest;
      }),
    objects,
    setObjects: (schema: string, value: string[] | null) =>
      setObjects((current) => {
        const { [schema]: _, ...rest } = current;
        return value ? { ...rest, [schema]: value } : rest;
      }),
    pickObjects: native && content !== "data",
    content,
    setContent,
    foldNames,
    setFoldNames,
    replace,
    mirror,
    setReplace,
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
