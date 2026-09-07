import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { useActiveConnection } from "@/lib/connections";
import { explainQuery } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import {
  buildSavedPerfTest,
  type PerfRun,
  type PerfTestDefinition,
  runMetricsFromPlan,
  type SavedPerfTest,
} from "@/lib/perf-test";
import { effectiveConnectionString } from "@/lib/ssh";

export interface PerfRunRequest {
  sql: string;
  repeats: number;
  analyze: boolean;
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
}

export function usePerfRunner(): PerfRunnerState {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const [current, setCurrent] = useState<SavedPerfTest | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  const start = useCallback(
    async (request: PerfRunRequest) => {
      if (!connection || running) return;
      cancelRef.current = false;
      setRunning(true);
      setError(null);
      setProgress({ done: 0, total: request.repeats });
      const runs: PerfRun[] = [];
      const capturedAt = new Date();
      try {
        const connectionString = effectiveConnectionString(connection);
        for (let index = 1; index <= request.repeats; index += 1) {
          if (cancelRef.current) break;
          const startedAt = new Date();
          const started = performance.now();
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
          runs.push({
            index,
            startedAt: startedAt.toISOString(),
            metrics: runMetricsFromPlan(node, wall, root),
            plan: node,
          });
          setProgress({ done: runs.length, total: request.repeats });
        }
        if (runs.length === 0) {
          setCurrent(null);
          setError(cancelRef.current ? "Test abgebrochen. Es wurde kein Lauf gewertet." : null);
          return;
        }
        setCurrent(
          buildSavedPerfTest(request.definition, runs, request.sql, {
            connectionName: connection.name,
            databaseKind: connection.kind,
            database,
            capturedAt,
            analyze: request.analyze,
          }),
        );
        if (cancelRef.current) {
          toast.info(`Test abgebrochen. ${runs.length} von ${request.repeats} Läufen gemessen.`);
        }
      } catch (err) {
        setCurrent(null);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        cancelRef.current = false;
        setRunning(false);
        setProgress(null);
      }
    },
    [connection, database, running],
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
  };
}
