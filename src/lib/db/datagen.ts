import type { ColumnMask } from "@/lib/masking";
import { invoke, type QueryExecutionOptions } from "./core";
import type { DatabaseKind } from "./providers";

export type DatagenLocale = "de" | "en";

export type DatagenGenerator =
  | { kind: "skip" }
  | { kind: "null" }
  | { kind: "fixed"; value: string }
  | { kind: "list"; values: string[] }
  | { kind: "pattern"; pattern: string }
  | { kind: "sequence"; start: number; step: number }
  | { kind: "sql"; expression: string }
  | { kind: "reference"; schema: string; table: string; column: string }
  | { kind: "email" }
  | { kind: "first_name" }
  | { kind: "last_name" }
  | { kind: "full_name" }
  | { kind: "username" }
  | { kind: "company" }
  | { kind: "city" }
  | { kind: "street" }
  | { kind: "postal_code" }
  | { kind: "country" }
  | { kind: "phone" }
  | { kind: "iban" }
  | { kind: "uuid" }
  | { kind: "url" }
  | { kind: "ip" }
  | { kind: "integer"; min: number; max: number }
  | { kind: "decimal"; min: number; max: number; scale: number }
  | { kind: "boolean" }
  | { kind: "date"; from: string; to: string }
  | { kind: "timestamp"; from: string; to: string }
  | { kind: "time" }
  | { kind: "lorem"; min: number; max: number }
  | { kind: "json" };

export type DatagenGeneratorKind = DatagenGenerator["kind"];

export interface DatagenColumn {
  name: string;
  dataType: string;
  nullable: boolean;
  maxLength?: number | null;
  generator: DatagenGenerator;
  nullRatio: number;
  enumValues: string[];
  note?: string | null;
}

export interface DatagenPlan {
  columns: DatagenColumn[];
  unique: string[][];
}

export interface DatagenRequest {
  schema: string;
  table: string;
  rows: number;
  batchSize: number;
  seed: number;
  locale: DatagenLocale;
  transaction: boolean;
  columns: DatagenColumn[];
  unique: string[][];
  source?: DatagenSource | null;
}

export interface DatagenSource {
  schema: string;
  table: string;
  masks: ColumnMask[];
}

export interface DatagenPreview {
  columns: string[];
  rows: Record<string, unknown>[];
  statement: string;
}

export interface DatagenOutcome {
  inserted: number;
  cancelled: boolean;
  committed: boolean;
  error: string | null;
}

export interface DatagenProgress {
  jobId: string | null;
  rows: number;
}

export async function datagenPlan(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  table: string,
  database?: string,
): Promise<DatagenPlan> {
  return invoke("datagen_plan", { kind, connectionString, database, schema, table });
}

export async function datagenPreview(
  kind: DatabaseKind,
  connectionString: string,
  request: DatagenRequest,
  database?: string,
): Promise<DatagenPreview> {
  return invoke("datagen_preview", { kind, connectionString, database, request });
}

export async function datagenRun(
  kind: DatabaseKind,
  connectionString: string,
  request: DatagenRequest,
  database?: string,
  options?: QueryExecutionOptions,
): Promise<DatagenOutcome> {
  return invoke("datagen_run", { kind, connectionString, database, request, options });
}
