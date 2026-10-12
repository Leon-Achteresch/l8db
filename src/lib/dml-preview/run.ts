import type { DmlPreviewResponse } from "@/lib/db/dml-preview";
import type { QueryResult } from "@/lib/db/types";
import type { DmlPreviewPlan } from "./derive";

export type PreviewPlanQueries = Pick<DmlPreviewPlan, "countSql" | "sampleSql" | "limit">;

export interface DmlPreviewExecutor {
  preview: (plan: PreviewPlanQueries, jobId: string) => Promise<DmlPreviewResponse>;
  cancel: (jobId: string) => Promise<unknown>;
  note?: string | null;
}

export interface DmlPreviewOutcome {
  count: number | null;
  sample: QueryResult;
  requests: number;
  readOnly: boolean;
}

export const MISSING_TABLE_REASON =
  "Die Vorschau läuft auf einer eigenen Verbindung und sieht diese Tabelle nicht, zum Beispiel eine temporäre Tabelle der Editor-Sitzung.";

const MISSING_TABLE =
  /42P01|does not exist|no such table|doesn't exist|Invalid object name|ORA-00942|Catalog Error: Table/i;

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
    };
  } catch (error) {
    if (signal?.aborted || isDmlPreviewCancelled(error)) throw new DmlPreviewCancelled();
    if (isMissingTableError(error))
      throw new DmlPreviewUnavailableError(
        `${MISSING_TABLE_REASON} (${error instanceof Error ? error.message : String(error)})`,
      );
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}
