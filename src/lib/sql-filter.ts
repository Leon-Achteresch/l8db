import type { DatabaseKind } from "@/lib/db";
import { identifierStyleForKind, quoteIdentifier } from "@/lib/export";

export interface OperatorDef {
  key: string;
  label: string;
  needsValue: boolean;
}

export const OPERATORS: OperatorDef[] = [
  { key: "eq", label: "ist gleich", needsValue: true },
  { key: "neq", label: "ist ungleich", needsValue: true },
  { key: "gt", label: "ist größer als", needsValue: true },
  { key: "gte", label: "ist größer/gleich", needsValue: true },
  { key: "lt", label: "ist kleiner als", needsValue: true },
  { key: "lte", label: "ist kleiner/gleich", needsValue: true },
  { key: "contains", label: "enthält", needsValue: true },
  { key: "startsWith", label: "beginnt mit", needsValue: true },
  { key: "endsWith", label: "endet mit", needsValue: true },
  { key: "isNull", label: "ist leer", needsValue: false },
  { key: "isNotNull", label: "ist nicht leer", needsValue: false },
];

export type FilterKind = DatabaseKind | null | undefined;

export function operatorNeedsValue(key: string): boolean {
  return OPERATORS.find((op) => op.key === key)?.needsValue ?? true;
}

export function quoteIdent(name: string, kind?: FilterKind): string {
  return quoteIdentifier(name, identifierStyleForKind(kind));
}

export function quoteLiteral(value: string, kind?: FilterKind): string {
  const trimmed = value.trim();
  const strict = kind === "oracle" || kind === "mssql";
  if (!strict && /^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  if (!strict && (trimmed === "true" || trimmed === "false" || trimmed === "null")) return trimmed;
  return `'${value.replace(/'/g, "''")}'`;
}

export function quoteLike(value: string): string {
  return value.replace(/'/g, "''").replace(/([%_\\])/g, "\\$1");
}

export function textMatch(columnExpression: string, pattern: string, kind?: FilterKind): string {
  const literal = `'${pattern}'`;
  switch (kind) {
    case "oracle":
      return `UPPER(TO_CHAR(${columnExpression})) LIKE UPPER(${literal}) ESCAPE '\\'`;
    case "mssql":
      return `CAST(${columnExpression} AS NVARCHAR(MAX)) LIKE ${literal} ESCAPE '\\'`;
    case "mysql":
      return `CAST(${columnExpression} AS CHAR) LIKE ${literal}`;
    case "sqlite":
      return `CAST(${columnExpression} AS TEXT) LIKE ${literal} ESCAPE '\\'`;
    case "clickhouse":
      return `toString(${columnExpression}) ILIKE ${literal}`;
    case "odbc":
    case "cassandra":
      return `UPPER(CAST(${columnExpression} AS VARCHAR(4000))) LIKE UPPER(${literal}) ESCAPE '\\'`;
    default:
      return `${columnExpression}::text ILIKE ${literal}`;
  }
}

export function compileConditionExpression(
  columnExpression: string,
  operator: string,
  value: string,
  kind?: FilterKind,
): string | null {
  if (operatorNeedsValue(operator) && value.trim() === "") return null;
  switch (operator) {
    case "eq":
      return `${columnExpression} = ${quoteLiteral(value, kind)}`;
    case "neq":
      return `${columnExpression} <> ${quoteLiteral(value, kind)}`;
    case "gt":
      return `${columnExpression} > ${quoteLiteral(value, kind)}`;
    case "gte":
      return `${columnExpression} >= ${quoteLiteral(value, kind)}`;
    case "lt":
      return `${columnExpression} < ${quoteLiteral(value, kind)}`;
    case "lte":
      return `${columnExpression} <= ${quoteLiteral(value, kind)}`;
    case "contains":
      return textMatch(columnExpression, `%${quoteLike(value)}%`, kind);
    case "startsWith":
      return textMatch(columnExpression, `${quoteLike(value)}%`, kind);
    case "endsWith":
      return textMatch(columnExpression, `%${quoteLike(value)}`, kind);
    case "isNull":
      return `${columnExpression} IS NULL`;
    case "isNotNull":
      return `${columnExpression} IS NOT NULL`;
    default:
      return null;
  }
}

export function compileSingleCondition(
  column: string,
  operator: string,
  value: string,
  kind?: FilterKind,
): string | null {
  if (!column) return null;
  if (operatorNeedsValue(operator) && value === "") return null;
  return compileConditionExpression(quoteIdent(column, kind), operator, value, kind);
}

export function compileContentFilter(columns: string[], value: string, kind?: FilterKind): string {
  return columns
    .map((col) => compileSingleCondition(col, "contains", value, kind))
    .filter((part): part is string => part !== null)
    .join(" OR ");
}
