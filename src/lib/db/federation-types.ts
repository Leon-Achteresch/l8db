import type { QueryResult, TableInfo } from "./types";

export const FEDERATION_LIMITS = {
  sources: 8,
  sourceRows: 50_000,
  totalRows: 100_000,
  inputBytes: 64 * 1024 * 1024,
  resultRows: 10_000,
  resultBytes: 8 * 1024 * 1024,
  sqlBytes: 64 * 1024,
} as const;

export interface FederationSource {
  connectionId: string;
  database: string | null;
  schema: string;
  table: string;
  alias: string;
}

export interface FederationCatalog {
  databases: string[];
  schemas: string[];
  tables: TableInfo[];
  hasMore: boolean;
}

export interface FederationReport {
  result: QueryResult;
  sources: { alias: string; table: string; rows: number; bytes: number; maskedColumns: string[] }[];
  sourceRows: number;
  sourceBytes: number;
  sourceReads: number;
  durationMs: number;
}
