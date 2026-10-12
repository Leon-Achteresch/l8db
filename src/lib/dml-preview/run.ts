import type { DmlPreviewResponse } from "@/lib/db/dml-preview";
import type { QueryResult } from "@/lib/db/types";
import type { DmlPreviewPlan } from "./derive";

export type PreviewPlanQueries = Pick<DmlPreviewPlan, "countSql" | "sampleSql" | "limit"> & {
  table?: string;
};

export interface DmlPreviewExecutor {
  preview: (plan: PreviewPlanQueries, jobId: string) => Promise<DmlPreviewResponse>;
  cancel: (jobId: string) => Promise<unknown>;
  note?: string | null;
  busy?: boolean;
}

export interface DmlPreviewOutcome {
  count: number | null;
  sample: QueryResult;
  requests: number;
  readOnly: boolean;
  schemaNote: string | null;
}

export const MISSING_TABLE_REASON =
  "Die Vorschau läuft auf einer eigenen Verbindung und sieht diese Tabelle nicht, zum Beispiel eine temporäre Tabelle der Editor-Sitzung.";

export const LOCK_BLOCKED_REASON = "Vorschau blockiert durch Sperren deiner offenen Transaktion.";
export const LOCK_OTHER_REASON = "Vorschau blockiert durch Sperren einer anderen Sitzung.";
export const NOT_READ_ONLY_PREFIX = "Vorschau nicht lesend:";
export const SCHEMA_NOTE = "Tabellen ohne Schema werden im Standard-Schema der Verbindung gesucht.";

const MISSING_TABLE =
  /\b42P01\b|relation "[^"]*" does not exist|\b1146\b|Table '[^']*' doesn't exist|Invalid object name|ORA-00942|no such table|Table with name \S+ does not exist/i;
const LOCK_BLOCKED =
  /SQLSTATE 55P03|canceling statement due to lock timeout|Lock request time out period exceeded|Lock wait timeout exceeded; try restarting transaction|ORA-00054|ORA-30006/i;
const TIMED_OUT = /Query-Timeout|\b57014\b|canceling statement due to statement timeout/i;

export function isLockBlockedError(error: unknown, busy = false): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return LOCK_BLOCKED.test(message) || (busy && TIMED_OUT.test(message));
}

export function lockBlockedReason(busy: boolean): string {
  return busy ? LOCK_BLOCKED_REASON : LOCK_OTHER_REASON;
}

export class DmlPreviewCancelled extends Error {
  constructor() {
    super("Vorschau abgebrochen.");
    this.name = "DmlPreviewCancelled";
  }
}

export class DmlPreviewUnavailableError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "DmlPreviewUnavailableError";
  }
}

export function isDmlPreviewCancelled(error: unknown): error is DmlPreviewCancelled {
  return error instanceof DmlPreviewCancelled;
}

export function isDmlPreviewUnavailable(error: unknown): error is DmlPreviewUnavailableError {
  return error instanceof DmlPreviewUnavailableError;
}

export function isMissingTableError(error: unknown): boolean {
  return MISSING_TABLE.test(error instanceof Error ? error.message : String(error));
}

function countOf(result: QueryResult): number | null {
  const row = result.rows[0];
  const column = result.columns[0];
  if (!row || column === undefined) return null;
  const value = Number(row[column]);
  return Number.isFinite(value) ? value : null;
}

function bounded(sample: QueryResult | null, count: QueryResult, limit: number): QueryResult {
  if (!sample)
    return {
      columns: [],
      rows: [],
      rows_affected: null,
      execution_time_ms: count.execution_time_ms,
    };
  return {
    ...sample,
    truncated: Boolean(sample.truncated) || sample.rows.length > limit,
    rows: sample.rows.length > limit ? sample.rows.slice(0, limit) : sample.rows,
  };
}

export async function runDmlPreview(
  plan: PreviewPlanQueries,
  executor: DmlPreviewExecutor,
  options: { signal?: AbortSignal } = {},
): Promise<DmlPreviewOutcome> {
  const { signal } = options;
  if (signal?.aborted) throw new DmlPreviewCancelled();
  const jobId = crypto.randomUUID();
  const abort = () => void executor.cancel(jobId).catch(() => undefined);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await executor.preview(plan, jobId);
    if (signal?.aborted) throw new DmlPreviewCancelled();
    return {
      count: countOf(response.count),
      sample: bounded(response.sample, response.count, plan.limit),
      requests: 1,
      readOnly: response.readOnly,
      schemaNote:
        executor.note && !response.searchPath && plan.table && !plan.table.includes(".")
          ? SCHEMA_NOTE
          : null,
    };
  } catch (error) {
    if (signal?.aborted || isDmlPreviewCancelled(error)) throw new DmlPreviewCancelled();
    if (isDmlPreviewUnavailable(error)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (isLockBlockedError(error, executor.busy))
      throw new DmlPreviewUnavailableError(
        `${lockBlockedReason(Boolean(executor.busy))} (${message})`,
      );
    if (message.includes(NOT_READ_ONLY_PREFIX)) throw new DmlPreviewUnavailableError(message);
    if (isMissingTableError(error))
      throw new DmlPreviewUnavailableError(
        `${MISSING_TABLE_REASON} (${error instanceof Error ? error.message : String(error)})`,
      );
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}
