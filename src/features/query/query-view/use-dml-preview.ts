import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  autoPreviewApplies,
  type DmlPreviewDerivation,
  type DmlPreviewOutcome,
  type DmlPreviewPhase,
  deriveDmlPreview,
  hasBindParameters,
  isDmlPreviewCancelled,
  needsDmlPreview,
  runDmlPreview,
} from "@/lib/dml-preview";
import { dmlPreviewExecutor } from "@/lib/dml-preview/executor";
import { isProduction } from "@/lib/environments";
import { useSettingsStore } from "@/lib/settings";

import type { QueryViewCapabilities, QueryViewConnection } from "./types";

export interface DmlPreviewState {
  derivation: DmlPreviewDerivation;
  production: boolean;
  manual: boolean;
  phase: DmlPreviewPhase | null;
  outcome: DmlPreviewOutcome | null;
  error: string | null;
  stopped: boolean;
  note: string | null;
}

const BOUND_REASON =
  "Die Anweisung nutzt Bind-Parameter. Die Vorschau setzt keine Parameterwerte ein.";

export function useDmlPreview(
  connection: QueryViewConnection,
  database: string | null,
  caps: QueryViewCapabilities,
) {
  const [state, setState] = useState<DmlPreviewState | null>(null);
  const resolverRef = useRef<((accepted: boolean) => void) | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const settledRef = useRef<Promise<void>>(Promise.resolve());

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const finish = useCallback(
    (accepted: boolean) => {
      abort();
      const resolve = resolverRef.current;
      resolverRef.current = null;
      setState(null);
      void settledRef.current.then(() => resolve?.(accepted));
    },
    [abort],
  );

  useEffect(
    () => () => {
      abortRef.current?.abort();
      resolverRef.current?.(false);
      resolverRef.current = null;
    },
    [],
  );

  const open = useCallback(
    (sql: string, manual: boolean, bound: boolean): Promise<boolean> => {
      if (!connection) return Promise.resolve(!manual);
      const settings = useSettingsStore.getState();
      const derived = deriveDmlPreview(sql, connection.kind, settings.dmlPreviewRowLimit);
      if (!derived) {
        if (manual)
          toast.info("Keine UPDATE-, DELETE-, MERGE- oder INSERT … SELECT-Anweisung gefunden.");
        return Promise.resolve(!manual);
      }
      const derivation: DmlPreviewDerivation =
        bound && derived.status === "ready"
          ? {
              status: "unavailable",
              kind: derived.kind,
              statement: derived.statement,
              reason: BOUND_REASON,
              whereMissing: derived.whereMissing,
            }
          : derived;
      abort();
      resolverRef.current?.(false);
      const ready = derivation.status === "ready";
      setState({
        derivation,
        production: isProduction(connection),
        manual,
        phase: ready ? "count" : null,
        outcome: null,
        error: null,
        stopped: false,
        note: null,
      });
      if (derivation.status === "ready") {
        const controller = new AbortController();
        abortRef.current = controller;
        const executor = dmlPreviewExecutor(connection, database, settings.dmlPreviewTimeout);
        const running = runDmlPreview(derivation, executor, {
          signal: controller.signal,
          onPhase: (phase) =>
            !controller.signal.aborted &&
            setState((current) => (current ? { ...current, phase } : current)),
        });
        settledRef.current = running.then(
          () => undefined,
          () => undefined,
        );
        running.then(
          (outcome) => {
            if (controller.signal.aborted) return;
            abortRef.current = null;
            setState((current) =>
              current ? { ...current, phase: null, outcome, note: executor.note ?? null } : current,
            );
          },
          (error: unknown) => {
            if (isDmlPreviewCancelled(error) && controller.signal.aborted) return;
            abortRef.current = null;
            setState((current) =>
              current
                ? { ...current, phase: null, error: String(error), note: executor.note ?? null }
                : current,
            );
          },
        );
      }
      return new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
      });
    },
    [connection, database, abort],
  );

  const confirmBeforeRun = useCallback(
    async (sql: string, bound = false): Promise<boolean> => {
      if (!connection || !caps.dml_preview) return true;
      const mode = useSettingsStore.getState().dmlPreviewMode;
      if (!autoPreviewApplies(mode, isProduction(connection))) return true;
      if (!needsDmlPreview(sql, connection.kind)) return true;
      return open(sql, false, bound);
    },
    [connection, caps.dml_preview, open],
  );

  const preview = useCallback(
    (sql: string) => {
      const bound = caps.query_language === "sql" && hasBindParameters(sql);
      return open(sql, true, bound);
    },
    [open, caps.query_language],
  );

  const stop = useCallback(() => {
    abort();
    setState((current) => (current ? { ...current, phase: null, stopped: true } : current));
  }, [abort]);

  return {
    state,
    confirmBeforeRun,
    preview,
    run: () => finish(true),
    cancel: () => finish(false),
    stop,
  };
}

export type DmlPreviewControls = ReturnType<typeof useDmlPreview>;
