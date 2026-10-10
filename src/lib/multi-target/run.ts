import type { QueryResult } from "@/lib/db/types";
import { createLimiter, isMultiTargetCancelled, type PartialProgress } from "./limiter";

export interface MultiTarget {
  id: string;
  connectionId: string;
  database: string | null;
  schema: string | null;
}

export type TargetStatus = "queued" | "running" | "done" | "error" | "cancelled" | "rejected";

export interface TargetRun {
  id: string;
  status: TargetStatus;
  durationMs: number | null;
  rowCount: number | null;
  rowsAffected: number | null;
  truncated: boolean;
  error: string | null;
  notice: string | null;
  partial: PartialProgress | null;
  result: QueryResult | null;
}

export interface MultiTargetRequest {
  target: MultiTarget;
  sql: string;
  jobId: string;
  timeoutSeconds: number;
  maxRows: number;
  signal?: AbortSignal;
}

export interface MultiTargetExecutor {
  execute: (request: MultiTargetRequest) => Promise<QueryResult>;
  cancel: (target: MultiTarget, jobId: string) => Promise<unknown>;
  canCancel: (target: MultiTarget) => boolean;
}

export function partialNotice(partial: PartialProgress, status: "cancelled" | "error"): string {
  return `${status === "cancelled" ? "Abgebrochen" : "Fehler"} nach ${partial.applied} von ${partial.total} Anweisungen; die bereits ausgeführten bleiben bestehen.`;
}

function partialOf(error: unknown): PartialProgress | null {
  const partial = (error as { partial?: PartialProgress | null } | null)?.partial;
  return partial && typeof partial.applied === "number" ? partial : null;
}

export const LATE_CANCEL_NOTICE =
  "Abbruch kam zu spät: Die Anweisung wurde auf diesem Ziel vollständig ausgeführt.";
export const UNSUPPORTED_CANCEL_NOTICE =
  "Dieser Treiber kann laufende Anweisungen nicht abbrechen. Das Ergebnis zeigt den tatsächlichen Ausgang.";

export interface MultiTargetRunOptions {
  targets: MultiTarget[];
  rejected?: { target: MultiTarget; reason: string }[];
  sql: string;
  concurrency: number;
  perServerLimit: number;
  timeoutSeconds: number;
  maxRows: number;
  executor: MultiTargetExecutor;
  onUpdate: (run: TargetRun) => void;
}

export interface MultiTargetRunHandle {
  done: Promise<void>;
  cancel: (id: string) => void;
  cancelAll: () => void;
  stats: () => { peak: number; started: number; active: number; queued: number };
}

export const MULTI_TARGET_MAX_CONCURRENCY = 16;
export const MULTI_TARGET_PER_SERVER_LIMIT = 8;
export const MULTI_TARGET_MAX_ROWS = 1000;

export function targetId(connectionId: string, database: string | null, schema: string | null) {
  return `${connectionId}\u0001${database ?? ""}\u0001${schema ?? ""}`;
}

export function multiTarget(
  connectionId: string,
  database: string | null = null,
  schema: string | null = null,
): MultiTarget {
  return { id: targetId(connectionId, database, schema), connectionId, database, schema };
}

export function emptyRun(id: string, status: TargetStatus = "queued"): TargetRun {
  return {
    id,
    status,
    durationMs: null,
    rowCount: null,
    rowsAffected: null,
    truncated: false,
    error: null,
    notice: null,
    partial: null,
    result: null,
  };
}

export function clampConcurrency(value: number): number {
  if (!Number.isFinite(value)) return 4;
  return Math.max(1, Math.min(MULTI_TARGET_MAX_CONCURRENCY, Math.floor(value)));
}

export function startMultiTargetRun(options: MultiTargetRunOptions): MultiTargetRunHandle {
  const limiter = createLimiter(
    clampConcurrency(options.concurrency),
    Math.max(1, Math.min(MULTI_TARGET_PER_SERVER_LIMIT, Math.floor(options.perServerLimit))),
  );
  const maxRows = Math.max(1, Math.min(MULTI_TARGET_MAX_ROWS, Math.floor(options.maxRows)));
  const controllers = new Map<string, AbortController>();
  for (const { target, reason } of options.rejected ?? [])
    options.onUpdate({ ...emptyRun(target.id, "rejected"), error: reason });
  for (const target of options.targets) options.onUpdate(emptyRun(target.id));

  const runOne = async (target: MultiTarget) => {
    const controller = new AbortController();
    controllers.set(target.id, controller);
    const jobId = crypto.randomUUID();
    let started = 0;
    const supported = options.executor.canCancel(target);
    try {
      const result = await limiter.run(
        target.connectionId,
        async () => {
          started = performance.now();
          options.onUpdate({ ...emptyRun(target.id, "running") });
          const onAbort = () => void options.executor.cancel(target, jobId).catch(() => false);
          controller.signal.addEventListener("abort", onAbort, { once: true });
          try {
            return await options.executor.execute({
              target,
              sql: options.sql,
              jobId,
              timeoutSeconds: options.timeoutSeconds,
              maxRows,
              signal: controller.signal,
            });
          } finally {
            controller.signal.removeEventListener("abort", onAbort);
          }
        },
        controller.signal,
      );
      options.onUpdate({
        id: target.id,
        status: "done",
        durationMs: Math.round(performance.now() - started),
        rowCount: result.columns.length ? result.rows.length : null,
        rowsAffected: result.rows_affected,
        truncated: Boolean(result.truncated),
        error: null,
        partial: null,
        notice: controller.signal.aborted
          ? supported
            ? LATE_CANCEL_NOTICE
            : UNSUPPORTED_CANCEL_NOTICE
          : null,
        result,
      });
    } catch (error) {
      const durationMs = started ? Math.round(performance.now() - started) : null;
      const partial = partialOf(error);
      if (isMultiTargetCancelled(error) || (controller.signal.aborted && supported)) {
        options.onUpdate({
          ...emptyRun(target.id, "cancelled"),
          durationMs,
          partial,
          notice: partial ? partialNotice(partial, "cancelled") : null,
        });
        return;
      }
      options.onUpdate({
        ...emptyRun(target.id, "error"),
        durationMs,
        partial,
        error: error instanceof Error ? error.message : String(error),
        notice: partial
          ? partialNotice(partial, "error")
          : controller.signal.aborted
            ? UNSUPPORTED_CANCEL_NOTICE
            : null,
      });
    } finally {
      controllers.delete(target.id);
    }
  };

  const done = Promise.all(options.targets.map(runOne)).then(() => undefined);
  return {
    done,
    cancel: (id) => controllers.get(id)?.abort(),
    cancelAll: () => {
      for (const controller of [...controllers.values()]) controller.abort();
    },
    stats: () => ({
      peak: limiter.peak,
      started: limiter.started,
      active: limiter.active,
      queued: limiter.queued,
    }),
  };
}
