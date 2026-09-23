import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { useActiveConnection } from "@/lib/connections";
import { executeQuery, explainQuery } from "@/lib/db";
import { useActiveCapabilities, useActiveDatabase } from "@/lib/db-selection";
import {
  buildSavedPerfTest,
  emptyMetrics,
  normalizeConcurrency,
  normalizeRepeats,
  type PerfRun,
  type PerfTestDefinition,
  runMetricsFromPlan,
  runMetricsFromResult,
  runPerfLoop,
  type SavedPerfTest,
} from "@/lib/perf-test";
import { effectiveConnectionString } from "@/lib/ssh";

export interface PerfRunRequest {
  sql: string;
  repeats: number;
  concurrency: number;
  analyze: boolean;
  timed: boolean;
  definition: PerfTestDefinition | null;
}

export interface PerfRunnerState {
  current: SavedPerfTest | null;
  setCurrent: (saved: SavedPerfTest | null) => void;
  running: boolean;
  progress: { done: number; total: number } | null;
  error: string | null;
  setError: (message: string | null) => void;
  start: (request: PerfRunRequest) => Promise<void>;
  cancel: () => void;
  canRun: boolean;
  canExplain: boolean;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function usePerfRunner(): PerfRunnerState {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const capabilities = useActiveCapabilities();
  const [current, setCurrent] = useState<SavedPerfTest | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  const start = useCallback(
    async (request: PerfRunRequest) => {
      if (!connection || running) return;
      const timed = request.timed || !capabilities.explain;
      const repeats = normalizeRepeats(request.repeats);
      const concurrency = normalizeConcurrency(request.concurrency);
      cancelRef.current = false;
      setRunning(true);
      setError(null);
      setProgress({ done: 0, total: repeats });
      const capturedAt = new Date();
      const connectionString = effectiveConnectionString(connection);

      const execute = async (index: number): Promise<PerfRun> => {
        const startedAt = new Date().toISOString();
        const started = performance.now();
        try {
          if (timed) {
            const result = await executeQuery(
              connection.kind,
              connectionString,
              request.sql,
              database ?? undefined,
            );
            return {
              index,
              startedAt,
              metrics: runMetricsFromResult(result, performance.now() - started),
              plan: null,
              error: null,
            };
          }
          const plans = await explainQuery(
            connection.kind,
            connectionString,
            request.sql,
            request.analyze,
            database ?? undefined,
          );
          const wall = performance.now() - started;
          const root = plans[0] as Record<string, unknown> | undefined;
          const node = plans[0]?.Plan;
          if (!node) throw new Error("Kein Ausführungsplan erhalten.");
          return {
            index,
            startedAt,
            metrics: runMetricsFromPlan(node, wall, root),
            plan: node,
            error: null,
          };
        } catch (err) {
          return {
            index,
            startedAt,
            metrics: emptyMetrics(performance.now() - started),
            plan: null,
            error: messageOf(err),
          };
        }
      };

      try {
        const outcome = await runPerfLoop({
          repeats,
          concurrency,
          execute,
          isCancelled: () => cancelRef.current,
          onProgress: (done, total) => setProgress({ done, total }),
        });
        if (outcome.aborted) {
          setCurrent(null);
          setError(outcome.aborted);
          return;
        }
        if (outcome.runs.length === 0) {
          setCurrent(null);
          setError(outcome.cancelled ? "Test abgebrochen. Es wurde kein Lauf gewertet." : null);
          return;
        }
        setCurrent(
          buildSavedPerfTest(request.definition, outcome.runs, request.sql, {
            connectionName: connection.name,
            databaseKind: connection.kind,
            database,
            capturedAt,
            analyze: request.analyze,
            timed,
            concurrency,
            elapsedMs: outcome.elapsedMs,
          }),
        );
        if (outcome.cancelled) {
          toast.info(`Test abgebrochen. ${outcome.runs.length} von ${repeats} Läufen gemessen.`);
        }
      } catch (err) {
        setCurrent(null);
        setError(messageOf(err));
      } finally {
        cancelRef.current = false;
        setRunning(false);
        setProgress(null);
      }
    },
    [connection, database, running, capabilities.explain],
  );

  const cancel = useCallback(() => {
    cancelRef.current = true;
  }, []);

  return {
    current,
    setCurrent,
    running,
    progress,
    error,
    setError,
    start,
    cancel,
    canRun: Boolean(connection),
    canExplain: capabilities.explain,
  };
}
