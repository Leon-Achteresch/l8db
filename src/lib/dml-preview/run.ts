import type { QueryResult } from "@/lib/db/types";
import type { DmlPreviewPlan } from "./derive";

export interface DmlPreviewExecutor {
  execute: (sql: string, jobId: string) => Promise<QueryResult>;
  cancel: (jobId: string) => Promise<unknown>;
  open?: () => Promise<void>;
  close?: (failed: boolean) => Promise<void>;
  holdsTransaction?: () => boolean;
  note?: string | null;
}

export type DmlPreviewPhase = "count" | "sample";

export interface DmlPreviewOutcome {
  count: number | null;
  sample: QueryResult;
  requests: number;
}

export class DmlPreviewCancelled extends Error {
  constructor() {
    super("Vorschau abgebrochen.");
    this.name = "DmlPreviewCancelled";
  }
}

export function isDmlPreviewCancelled(error: unknown): error is DmlPreviewCancelled {
  return error instanceof DmlPreviewCancelled;
}

function countOf(result: QueryResult): number | null {
  const row = result.rows[0];
  const column = result.columns[0];
  if (!row || column === undefined) return null;
  const value = Number(row[column]);
  return Number.isFinite(value) ? value : null;
}

function emptySample(count: QueryResult): QueryResult {
  return { columns: [], rows: [], rows_affected: null, execution_time_ms: count.execution_time_ms };
}

export async function runDmlPreview(
  plan: Pick<DmlPreviewPlan, "countSql" | "sampleSql" | "limit">,
  executor: DmlPreviewExecutor,
  options: { signal?: AbortSignal; onPhase?: (phase: DmlPreviewPhase) => void } = {},
): Promise<DmlPreviewOutcome> {
  const { signal, onPhase } = options;
  let requests = 0;
  const step = async (sql: string) => {
    if (signal?.aborted) throw new DmlPreviewCancelled();
    const jobId = crypto.randomUUID();
    const abort = () => void executor.cancel(jobId).catch(() => undefined);
    signal?.addEventListener("abort", abort, { once: true });
    requests++;
    try {
      const result = await executor.execute(sql, jobId);
      if (signal?.aborted) throw new DmlPreviewCancelled();
      return result;
    } catch (error) {
      if (signal?.aborted) throw new DmlPreviewCancelled();
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  };
  if (signal?.aborted) throw new DmlPreviewCancelled();
  await executor.open?.();
  let failed = true;
  try {
    onPhase?.("count");
    const counted = await step(plan.countSql);
    const count = countOf(counted);
    if (count === 0) {
      failed = false;
      return { count, sample: emptySample(counted), requests };
    }
    onPhase?.("sample");
    const sample = await step(plan.sampleSql);
    failed = false;
    return finished(count, sample, plan.limit, requests);
  } finally {
    await executor.close?.(failed);
  }
}

function finished(
  count: number | null,
  sample: QueryResult,
  limit: number,
  requests: number,
): DmlPreviewOutcome {
  return {
    count,
    sample: {
      ...sample,
      truncated: Boolean(sample.truncated) || sample.rows.length > limit,
      rows: sample.rows.length > limit ? sample.rows.slice(0, limit) : sample.rows,
    },
    requests,
  };
}
