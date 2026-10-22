import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { csvFileName } from "@/lib/dashboards/csv";
import type {
  StudioColumn,
  StudioFilterOperator,
  StudioRow,
  StudioTableKind,
} from "@/lib/db/supabase-studio-tables";
import { DEFAULT_CSV_OPTIONS, serializeCsv } from "@/lib/export";

export interface StudioTableRef {
  schema: string;
  name: string;
}

export const PAGE_SIZE = 50;

export const KIND_LABELS: Record<StudioTableKind, string> = {
  table: "Tabelle",
  partitioned_table: "Partitionierte Tabelle",
  view: "View",
  materialized_view: "Materialisierte View",
  foreign_table: "Fremdtabelle",
  unknown: "Tabelle",
};

export const FILTER_OPERATORS: { value: StudioFilterOperator; label: string }[] = [
  { value: "eq", label: "=" },
  { value: "neq", label: "<>" },
  { value: "lt", label: "<" },
  { value: "gt", label: ">" },
  { value: "lte", label: "<=" },
  { value: "gte", label: ">=" },
  { value: "like", label: "like" },
  { value: "ilike", label: "ilike" },
  { value: "is_null", label: "is null" },
  { value: "not_null", label: "is not null" },
  { value: "in", label: "in (a,b,c)" },
];

export const COMMON_TYPES = [
  "bigint",
  "integer",
  "smallint",
  "numeric",
  "real",
  "double precision",
  "text",
  "varchar(255)",
  "boolean",
  "uuid",
  "date",
  "time",
  "timestamp",
  "timestamptz",
  "interval",
  "json",
  "jsonb",
  "bytea",
  "text[]",
  "integer[]",
];

export const isWritableKind = (kind: StudioTableKind) =>
  kind === "table" || kind === "partitioned_table" || kind === "unknown";

export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

export function cellPreview(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function isJsonType(dataType: string) {
  return dataType === "json" || dataType === "jsonb" || dataType.endsWith("[]");
}

export function isBooleanType(dataType: string) {
  return dataType === "boolean";
}

export function apiValue(
  text: string,
  column: StudioColumn | undefined,
  original: unknown,
  sql: boolean,
): unknown {
  const dataType = column?.data_type ?? "";
  if (sql && !dataType.endsWith("[]")) return text;
  if (isBooleanType(dataType) || typeof original === "boolean") return text === "true";
  if (isJsonType(dataType) || (original !== null && typeof original === "object")) {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Ungültiges JSON in Spalte ${column?.name ?? ""}.`);
    }
  }
  if (typeof original === "number" && text.trim() !== "" && !Number.isNaN(Number(text))) {
    return Number(text);
  }
  return text;
}

export function rowKey(row: StudioRow, keyColumns: string[]): StudioRow {
  return Object.fromEntries(keyColumns.map((column) => [column, row[column]]));
}

const recentKey = (reference: string) => `l8db.supabase-studio.tables.recent.${reference}`;

export function loadRecentTables(reference: string): StudioTableRef[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(recentKey(reference)) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is StudioTableRef =>
            typeof item?.schema === "string" && typeof item?.name === "string",
        )
      : [];
  } catch {
    return [];
  }
}

export function rememberRecentTable(reference: string, table: StudioTableRef): StudioTableRef[] {
  const next = [
    table,
    ...loadRecentTables(reference).filter(
      (item) => item.schema !== table.schema || item.name !== table.name,
    ),
  ].slice(0, 10);
  localStorage.setItem(recentKey(reference), JSON.stringify(next));
  return next;
}

export function parseTableName(input: string): StudioTableRef | null {
  const value = input.trim();
  const dot = value.indexOf(".");
  const [schema, name] = dot < 0 ? ["public", value] : [value.slice(0, dot), value.slice(dot + 1)];
  return schema && name ? { schema, name } : null;
}

export function rowsJson(rows: StudioRow[]): string {
  return JSON.stringify(rows, null, 2);
}

export function rowsCsvText(columns: string[], rows: StudioRow[], bom = false): string {
  return serializeCsv(columns, rows, { ...DEFAULT_CSV_OPTIONS, bom });
}

export async function saveRows(
  title: string,
  format: "csv" | "json",
  columns: string[],
  rows: StudioRow[],
): Promise<boolean> {
  const csvName = csvFileName(title);
  const path = await save({
    defaultPath: format === "csv" ? csvName : csvName.replace(/\.csv$/, ".json"),
    filters: [{ name: format.toUpperCase(), extensions: [format] }],
  });
  if (!path) return false;
  await writeTextFile(path, format === "csv" ? rowsCsvText(columns, rows, true) : rowsJson(rows));
  return true;
}
