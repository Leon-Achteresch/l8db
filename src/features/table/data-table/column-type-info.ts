import type { DetailedColumnInfo } from "@/lib/db";
import type { TableRow } from "../data-table-types";

export type ColumnTypeKind = "text" | "number" | "boolean" | "date" | "json" | "key" | "uuid";

function kindFromDataType(dataType: string): ColumnTypeKind | null {
  const lower = dataType.toLowerCase();
  if (lower.includes("bool")) return "boolean";
  if (lower.includes("uuid") || lower === "uniqueidentifier") return "uuid";
  if (lower.includes("json") || lower === "object" || lower === "array") return "json";
  if (lower.includes("time") || lower.includes("date") || lower.includes("interval")) return "date";
  if (/^(number|numeric|dec|float|double|real|serial|money|binary_)|int/.test(lower))
    return "number";
  if (/char|text|clob|string/.test(lower)) return "text";
  return null;
}

export function getColumnTypeInfo(col: string, rows: TableRow[], detail?: DetailedColumnInfo) {
  let first: unknown;
  for (const row of rows) {
    const value = row[col];
    if (value !== null && value !== undefined) {
      first = value;
      break;
    }
  }

  let type: ColumnTypeKind = "text";
  const known = detail ? kindFromDataType(detail.data_type) : null;

  if (detail?.is_primary_key) {
    type = "key";
  } else if (known) {
    type = known;
  } else if (col.toLowerCase() === "id" || col.toLowerCase() === "uuid") {
    type = col.toLowerCase() === "id" ? "key" : "uuid";
  } else if (first === undefined) {
    if (col.toLowerCase().endsWith("_id") || col.toLowerCase().endsWith("id")) {
      type = "key";
    } else {
      type = "text";
    }
  } else {
    if (typeof first === "boolean") {
      type = "boolean";
    } else if (typeof first === "number") {
      type = "number";
    } else if (typeof first === "object") {
      type = "json";
    } else if (typeof first === "string") {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(first)) {
        type = "uuid";
      } else if (
        !Number.isNaN(Date.parse(first)) &&
        (first.includes("-") || first.includes("T") || first.includes(":"))
      ) {
        type = "date";
      } else if (col.toLowerCase().endsWith("_id") || col.toLowerCase().endsWith("id")) {
        type = "key";
      }
    }
  }

  switch (type) {
    case "key":
      return {
        label: "id",
        align: "text-left" as const,
        colorClass: "text-amber-500 bg-amber-500/10 border-amber-500/20",
        iconName: "Key",
      };
    case "uuid":
      return {
        label: "uuid",
        align: "text-left" as const,
        colorClass: "text-yellow-500 bg-yellow-500/10 border-yellow-500/20",
        iconName: "Fingerprint",
      };
    case "number":
      return {
        label: "num",
        align: "text-left" as const,
        colorClass: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20",
        iconName: "Hash",
      };
    case "boolean":
      return {
        label: "bool",
        align: "text-left" as const,
        colorClass: "text-sky-500 bg-sky-500/10 border-sky-500/20",
        iconName: "Binary",
      };
    case "date":
      return {
        label: "date",
        align: "text-left" as const,
        colorClass: "text-rose-500 bg-rose-500/10 border-rose-500/20",
        iconName: "Calendar",
      };
    case "json":
      return {
        label: "json",
        align: "text-left" as const,
        colorClass: "text-purple-500 bg-purple-500/10 border-purple-500/20",
        iconName: "Braces",
      };
    case "text":
      return {
        label: "text",
        align: "text-left" as const,
        colorClass: "text-slate-500 bg-slate-500/10 border-slate-500/20",
        iconName: "Type",
      };
  }
}
