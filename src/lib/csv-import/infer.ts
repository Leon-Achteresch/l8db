import type { CsvCell } from "./types";

export type InferredType =
  | "empty"
  | "boolean"
  | "integer"
  | "decimal"
  | "date"
  | "timestamp"
  | "json"
  | "text";

export const INFERRED_TYPE_LABELS: Record<InferredType, string> = {
  empty: "leer",
  boolean: "Boolean",
  integer: "Ganzzahl",
  decimal: "Dezimalzahl",
  date: "Datum",
  timestamp: "Zeitstempel",
  json: "JSON",
  text: "Text",
};

const BOOLEAN_WORDS = new Set(["true", "false", "t", "f", "yes", "no", "ja", "nein"]);
const INTEGER = /^[+-]?\d+$/;
const DECIMAL = /^[+-]?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

function classify(value: string): InferredType {
  const text = value.trim();
  if (text === "") return "empty";
  if (BOOLEAN_WORDS.has(text.toLowerCase())) return "boolean";
  if (INTEGER.test(text)) return text.length > 1 && /^[+-]?0\d/.test(text) ? "text" : "integer";
  if (DECIMAL.test(text)) return "decimal";
  if (DATE.test(text) && !Number.isNaN(Date.parse(text))) return "date";
  if (TIMESTAMP.test(text) && !Number.isNaN(Date.parse(text.replace(" ", "T")))) return "timestamp";
  if ((text.startsWith("{") || text.startsWith("[")) && isJson(text)) return "json";
  return "text";
}

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function merge(current: InferredType, next: InferredType): InferredType {
  if (current === next || next === "empty") return current;
  if (current === "empty") return next;
  const numeric = new Set<InferredType>(["integer", "decimal"]);
  if (numeric.has(current) && numeric.has(next)) return "decimal";
  const temporal = new Set<InferredType>(["date", "timestamp"]);
  if (temporal.has(current) && temporal.has(next)) return "timestamp";
  return "text";
}

export function inferColumnType(values: CsvCell[]): InferredType {
  let result: InferredType = "empty";
  for (const value of values) {
    if (value === null) continue;
    result = merge(result, classify(value));
    if (result === "text") return result;
  }
  return result;
}

export function inferColumnTypes(columnCount: number, rows: CsvCell[][]): InferredType[] {
  return Array.from({ length: columnCount }, (_, index) =>
    inferColumnType(rows.map((row) => row[index] ?? null)),
  );
}

const COMPATIBLE: Record<Exclude<InferredType, "empty" | "text">, RegExp> = {
  boolean: /bool|bit|tinyint|int|number|numeric/,
  integer:
    /int|serial|number|numeric|decimal|real|float|double|money|bool|bit|char|text|string|clob/,
  decimal: /numeric|decimal|number|real|float|double|money|char|text|string|clob/,
  date: /date|time|char|text|string|clob/,
  timestamp: /time|date|char|text|string|clob/,
  json: /json|char|text|string|clob|object|array|variant|super/,
};

export function typeMismatch(inferred: InferredType, targetType: string): boolean {
  if (inferred === "empty") return false;
  const target = targetType.toLowerCase();
  if (inferred === "text")
    return /^(big|small|tiny|medium)?int|^integer|^serial|^bool|^numeric|^decimal|^number\b|^real|^float|^double/.test(
      target,
    );
  return !COMPATIBLE[inferred].test(target);
}
