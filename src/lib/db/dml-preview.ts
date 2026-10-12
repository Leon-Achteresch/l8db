import { invoke, type QueryExecutionOptions } from "./core";
import type { DatabaseKind } from "./providers";
import type { QueryResult } from "./types";

export interface DmlPreviewRequest {
  countSql: string;
  sampleSql: string;
  limit: number;
  lockTimeoutMs?: number;
}

export interface DmlPreviewResponse {
  count: QueryResult;
  sample: QueryResult | null;
  readOnly: boolean;
  searchPath: string | null;
}

export async function previewDml(
  kind: DatabaseKind,
  connectionString: string,
  database: string | undefined,
  request: DmlPreviewRequest,
  options?: QueryExecutionOptions,
): Promise<DmlPreviewResponse> {
  return invoke("preview_dml", { kind, connectionString, database, request, options });
}
