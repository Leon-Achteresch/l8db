import { invoke } from "@tauri-apps/api/core";
import type { DatabaseKind } from "./providers";
import type { ExplainNode } from "./rows";

export interface IndexAdvice {
  schema: string;
  table: string;
  column: string;
  estimatedTableRows: number;
  estimatedResultRows: number;
  selectivity: number;
  sql: string;
}

export function adviseIndexes(
  kind: DatabaseKind,
  connectionString: string,
  database: string | null,
  plan: ExplainNode,
): Promise<IndexAdvice[]> {
  return invoke("advise_indexes", { kind, connectionString, database, plan });
}
