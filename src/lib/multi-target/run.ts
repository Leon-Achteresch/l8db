import type { QueryResult } from "@/lib/db/types";
import { createLimiter, isMultiTargetCancelled } from "./limiter";

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
  result: QueryResult | null;
}

export interface MultiTargetRequest {
  target: MultiTarget;
  sql: string;
  jobId: string;
  timeoutSeconds: number;
  maxRows: number;
}

export interface MultiTargetExecutor {
  execute: (request: MultiTargetRequest) => Promise<QueryResult>;
  cancel: (target: MultiTarget, jobId: string) => Promise<unknown>;
}

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
    try {
      const result = await limiter.run(
        target.connectionId,
        async () => {
          started = performance.now();
          options.onUpdate({ ...emptyRun(target.id, "running") });
          const onAbort = () => void options.executor.cancel(target, jobId).catch(() => undefined);
          controller.signal.addEventListener("abort", onAbort, { once: true });
          try {
            return await options.executor.execute({
              target,
              sql: options.sql,
              jobId,
              timeoutSeconds: options.timeoutSeconds,
              maxRows,
            });
          } finally {
            controller.signal.removeEventListener("abort", onAbort);
          }
        },
        controller.signal,
      );
      const durationMs = Math.round(performance.now() - started);
      if (controller.signal.aborted) {
        options.onUpdate({ ...emptyRun(target.id, "cancelled"), durationMs });
        return;
      }
      options.onUpdate({
        id: target.id,
        status: "done",
        durationMs,
        rowCount: result.columns.length ? result.rows.length : null,
        rowsAffected: result.rows_affected,
        truncated: Boolean(result.truncated),
        error: null,
        result,
      });
    } catch (error) {
      const durationMs = started ? Math.round(performance.now() - started) : null;
      if (controller.signal.aborted || isMultiTargetCancelled(error)) {
        options.onUpdate({ ...emptyRun(target.id, "cancelled"), durationMs });
        return;
      }
      options.onUpdate({
        ...emptyRun(target.id, "error"),
        durationMs,
        error: error instanceof Error ? error.message : String(error),
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
