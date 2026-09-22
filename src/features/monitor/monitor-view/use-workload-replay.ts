import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { type SavedConnection, useActiveConnection, useConnectionsStore } from "@/lib/connections";
import { executeQuery, executeQueryWithParams } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { ensurePassword } from "@/lib/password-prompt";
import { normalizeConcurrency, normalizeRepeats } from "@/lib/perf-test";
import { supports } from "@/lib/providers";
import { effectiveConnectionString, ensureSshTunnel } from "@/lib/ssh";
import {
  buildSavedWorkload,
  buildSavedWorkloadResult,
  defaultWorkloadFileName,
  defaultWorkloadResultFileName,
  parseWorkloadFile,
  parseWorkloadResultFile,
  runWorkload,
  type SavedWorkload,
  type SavedWorkloadResult,
  serializeWorkload,
  type WorkloadStatement,
} from "@/lib/workload";

const WORKLOAD_FILTERS = [{ name: "l8db-Workload", extensions: ["json"] }];

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

async function prepareConnection(id: string): Promise<SavedConnection> {
  const initial = useConnectionsStore.getState().connections.find((entry) => entry.id === id);
  if (!initial) throw new Error("Die Zielverbindung existiert nicht mehr.");
  if (!(await ensurePassword(id))) throw new Error("Ohne Passwort kann nicht verbunden werden.");
  const fresh = useConnectionsStore.getState().connections.find((entry) => entry.id === id);
  if (fresh?.ssh?.host && !fresh.tunnelPort) {
    const outcome = await ensureSshTunnel(fresh);
    if (!outcome.ok) throw new Error(outcome.error ?? "SSH-Tunnel konnte nicht geöffnet werden.");
  }
  const ready = useConnectionsStore.getState().connections.find((entry) => entry.id === id);
  if (!ready) throw new Error("Die Zielverbindung existiert nicht mehr.");
  return ready;
}

export function useWorkloadReplay() {
  const active = useActiveConnection();
  const activeDatabase = useActiveDatabase();
  const connections = useConnectionsStore((state) => state.connections);
  const [workload, setWorkloadState] = useState<SavedWorkload | null>(null);
  const [workloadName, setWorkloadName] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [repeats, setRepeats] = useState("5");
  const [concurrency, setConcurrency] = useState("1");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{
    statement: number;
    done: number;
    total: number;
  } | null>(null);
  const [result, setResult] = useState<SavedWorkloadResult | null>(null);
  const [baseline, setBaseline] = useState<{ fileName: string; saved: SavedWorkloadResult } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  const target = useMemo(
    () => connections.find((entry) => entry.id === (targetId ?? active?.id)) ?? null,
    [active?.id, connections, targetId],
  );

  const setWorkload = useCallback(
    (statements: WorkloadStatement[], name: string | null = null) => {
      if (!active || statements.length === 0) return;
      setWorkloadState(
        buildSavedWorkload(statements, {
          connectionName: active.name,
          databaseKind: active.kind,
          database: activeDatabase,
        }),
      );
      setWorkloadName(name);
      setResult(null);
      setError(null);
    },
    [active, activeDatabase],
  );

  const updateParam = useCallback((statement: number, param: number, value: string) => {
    setWorkloadState((current) => {
      if (!current) return current;
      const statements = current.statements.map((entry, index) => {
        if (index !== statement) return entry;
        const params = [...(entry.params ?? [])];
        while (params.length <= param) params.push("");
        params[param] = value;
        return { ...entry, params };
      });
      return { ...current, statements };
    });
  }, []);

  const saveWorkload = useCallback(async () => {
    if (!workload) return;
    try {
      const path = await save({
        defaultPath: defaultWorkloadFileName({
          name: workload.database ?? workload.connectionName,
        }),
        filters: WORKLOAD_FILTERS,
      });
      if (!path) return;
      await writeTextFile(path, serializeWorkload(workload));
      setWorkloadName(fileNameOf(path));
      toast.success("Workload gespeichert.");
    } catch (err) {
      toast.error(`Workload konnte nicht gespeichert werden: ${messageOf(err)}`);
    }
  }, [workload]);

  const openWorkload = useCallback(async () => {
    try {
      const path = await open({ multiple: false, directory: false, filters: WORKLOAD_FILTERS });
      if (typeof path !== "string") return;
      setWorkloadState(parseWorkloadFile(await readTextFile(path)));
      setWorkloadName(fileNameOf(path));
      setResult(null);
      setError(null);
    } catch (err) {
      setError(messageOf(err));
    }
  }, []);

  const saveResult = useCallback(async () => {
    if (!result) return;
    try {
      const path = await save({
        defaultPath: defaultWorkloadResultFileName({ name: result.connectionName }),
        filters: WORKLOAD_FILTERS,
      });
      if (!path) return;
      await writeTextFile(path, serializeWorkload(result));
      toast.success("Ergebnis gespeichert.");
    } catch (err) {
      toast.error(`Ergebnis konnte nicht gespeichert werden: ${messageOf(err)}`);
    }
  }, [result]);

  const openBaseline = useCallback(async () => {
    try {
      const path = await open({ multiple: false, directory: false, filters: WORKLOAD_FILTERS });
      if (typeof path !== "string") return;
      setBaseline({
        fileName: fileNameOf(path),
        saved: parseWorkloadResultFile(await readTextFile(path)),
      });
      setError(null);
    } catch (err) {
      setError(messageOf(err));
    }
  }, []);

  const run = useCallback(async () => {
    if (!workload || !target || running) return;
    cancelRef.current = false;
    setRunning(true);
    setError(null);
    const runRepeats = normalizeRepeats(Number.parseInt(repeats, 10));
    const runConcurrency = normalizeConcurrency(Number.parseInt(concurrency, 10));
    const capturedAt = new Date();
    try {
      const connection = await prepareConnection(target.id);
      const url = effectiveConnectionString(connection);
      const database = connection.id === active?.id ? (activeDatabase ?? undefined) : undefined;
      const results = await runWorkload({
        statements: workload.statements,
        repeats: runRepeats,
        concurrency: runConcurrency,
        kind: connection.kind,
        bindable: supports(connection, "bind_parameters"),
        execute: (sql, params) =>
          params
            ? executeQueryWithParams(connection.kind, url, sql, params, database)
            : executeQuery(connection.kind, url, sql, database),
        isCancelled: () => cancelRef.current,
        onProgress: (statement, done, total) => setProgress({ statement, done, total }),
      });
      setResult(
        buildSavedWorkloadResult(
          results,
          { repeats: runRepeats, concurrency: runConcurrency },
          {
            connectionName: connection.name,
            databaseKind: connection.kind,
            database: database ?? null,
            capturedAt,
          },
        ),
      );
      if (cancelRef.current) toast.info("Replay abgebrochen. Teilergebnis wird angezeigt.");
    } catch (err) {
      setError(messageOf(err));
    } finally {
      cancelRef.current = false;
      setRunning(false);
      setProgress(null);
    }
  }, [active?.id, activeDatabase, concurrency, repeats, running, target, workload]);

  const cancel = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const takeResultAsBaseline = useCallback(() => {
    if (result) setBaseline({ fileName: `Lauf gegen ${result.connectionName}`, saved: result });
  }, [result]);

  return {
    connections,
    workload,
    workloadName,
    setWorkload,
    updateParam,
    saveWorkload,
    openWorkload,
    target,
    setTargetId,
    repeats,
    setRepeats,
    concurrency,
    setConcurrency,
    running,
    progress,
    run,
    cancel,
    result,
    saveResult,
    baseline,
    setBaseline,
    openBaseline,
    takeResultAsBaseline,
    error,
    setError,
  };
}

export type WorkloadReplayState = ReturnType<typeof useWorkloadReplay>;
