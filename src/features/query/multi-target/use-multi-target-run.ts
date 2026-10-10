import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { type SavedConnection, useConnectionsStore } from "@/lib/connections";
import { deriveDmlPreview } from "@/lib/dml-preview";
import {
  MULTI_TARGET_PER_SERVER_LIMIT,
  type MultiTarget,
  type MultiTargetGate,
  type MultiTargetRunHandle,
  multiTargetGate,
  startMultiTargetRun,
  type TargetRun,
} from "@/lib/multi-target";
import { multiTargetExecutor } from "@/lib/multi-target/executor";
import { invalidateAfterSql } from "@/lib/query-client";
import { useSettingsStore } from "@/lib/settings";

export interface PendingConfirmation {
  sql: string;
  gate: MultiTargetGate;
  counts: Record<string, TargetRun> | null;
  countReason: string | null;
  counting: boolean;
}

export function useMultiTargetRun() {
  const queryClient = useQueryClient();
  const [order, setOrder] = useState<string[]>([]);
  const [runs, setRuns] = useState<Record<string, TargetRun>>({});
  const [running, setRunning] = useState(false);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [lastSql, setLastSql] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const handleRef = useRef<MultiTargetRunHandle | null>(null);
  const countRef = useRef<MultiTargetRunHandle | null>(null);

  useEffect(
    () => () => {
      handleRef.current?.cancelAll();
      countRef.current?.cancelAll();
    },
    [],
  );

  const execute = useCallback(
    (sql: string, gate: MultiTargetGate) => {
      const settings = useSettingsStore.getState();
      const started = performance.now();
      const all = [...gate.rejected.map((entry) => entry.target), ...gate.allowed];
      setOrder(all.map((target) => target.id));
      setRuns({});
      setElapsedMs(null);
      setLastSql(sql);
      setRunning(true);
      const handle = startMultiTargetRun({
        targets: gate.allowed,
        rejected: gate.rejected,
        sql,
        concurrency: settings.multiTargetConcurrency,
        perServerLimit: MULTI_TARGET_PER_SERVER_LIMIT,
        timeoutSeconds: settings.multiTargetTimeout,
        maxRows: settings.multiTargetRowLimit,
        executor: multiTargetExecutor(gate.write),
        onUpdate: (run) => setRuns((current) => ({ ...current, [run.id]: run })),
      });
      handleRef.current = handle;
      void handle.done.finally(async () => {
        if (handleRef.current === handle) handleRef.current = null;
        setElapsedMs(Math.round(performance.now() - started));
        setRunning(false);
        if (!gate.write) return;
        const invalidated = new Set<string>();
        for (const target of gate.allowed) {
          const key = `${target.connectionId}\u0001${target.database ?? ""}`;
          if (invalidated.has(key)) continue;
          invalidated.add(key);
          await invalidateAfterSql(queryClient, target.connectionId, target.database, sql);
        }
      });
    },
    [queryClient],
  );

  const start = useCallback(
    (sql: string, targets: MultiTarget[], kind: SavedConnection["kind"] | null) => {
      if (!sql.trim() || !targets.length || handleRef.current) return;
      const connections = useConnectionsStore.getState().connections;
      const gate = multiTargetGate(
        sql,
        targets.map((target) => ({
          target,
          connection: connections.find((entry) => entry.id === target.connectionId) ?? null,
        })),
        kind,
      );
      if (!gate.allowed.length) {
        toast.error("Keines der Ziele darf diese Anweisung ausführen.");
        setOrder(gate.rejected.map((entry) => entry.target.id));
        setRuns(
          Object.fromEntries(
            gate.rejected.map(({ target, reason }) => [
              target.id,
              {
                id: target.id,
                status: "rejected" as const,
                durationMs: null,
                rowCount: null,
                rowsAffected: null,
                truncated: false,
                error: reason,
                notice: null,
                partial: null,
                result: null,
              },
            ]),
          ),
        );
        return;
      }
      if (gate.requiresConfirmation) {
        setPending({ sql, gate, counts: null, countReason: null, counting: false });
        return;
      }
      execute(sql, gate);
    },
    [execute],
  );

  const countAffected = useCallback(
    (connection: SavedConnection | null) => {
      const current = pending;
      if (!current || current.counting || !connection) return;
      const derived = deriveDmlPreview(current.sql, connection.kind, 1);
      if (derived?.status !== "ready") {
        setPending({
          ...current,
          countReason:
            derived?.status === "unavailable"
              ? derived.reason
              : "Keine UPDATE-, DELETE-, MERGE- oder INSERT … SELECT-Anweisung.",
        });
        return;
      }
      setPending({ ...current, counting: true, counts: {}, countReason: null });
      const settings = useSettingsStore.getState();
      const handle = startMultiTargetRun({
        targets: current.gate.allowed,
        sql: derived.countSql,
        concurrency: settings.multiTargetConcurrency,
        perServerLimit: MULTI_TARGET_PER_SERVER_LIMIT,
        timeoutSeconds: settings.dmlPreviewTimeout,
        maxRows: 1,
        executor: multiTargetExecutor(false),
        onUpdate: (run) =>
          setPending((latest) =>
            latest ? { ...latest, counts: { ...(latest.counts ?? {}), [run.id]: run } } : latest,
          ),
      });
      countRef.current = handle;
      void handle.done.finally(() => {
        if (countRef.current === handle) countRef.current = null;
        setPending((latest) => (latest ? { ...latest, counting: false } : latest));
      });
    },
    [pending],
  );

  const resolveConfirmation = useCallback(
    (accepted: boolean) => {
      countRef.current?.cancelAll();
      countRef.current = null;
      const current = pending;
      setPending(null);
      if (accepted && current) execute(current.sql, current.gate);
    },
    [execute, pending],
  );

  const cancel = useCallback((id: string) => handleRef.current?.cancel(id), []);
  const cancelAll = useCallback(() => handleRef.current?.cancelAll(), []);
  const clear = useCallback(() => {
    if (handleRef.current) return;
    setOrder([]);
    setRuns({});
    setElapsedMs(null);
    setLastSql(null);
  }, []);

  return {
    order,
    runs,
    running,
    elapsedMs,
    lastSql,
    pending,
    start,
    cancel,
    cancelAll,
    clear,
    countAffected,
    resolveConfirmation,
  };
}

export type MultiTargetRunState = ReturnType<typeof useMultiTargetRun>;
