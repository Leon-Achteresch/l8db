import type { DatabaseKind } from "@/lib/db";

export type FilterOperatorKey =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "notIn"
  | "contains"
  | "startsWith"
  | "endsWith"
  | "isNull"
  | "isNotNull";

export interface OperatorDef {
  key: FilterOperatorKey;
  label: string;
  needsValue: boolean;
  sqlLabel: string;
}

export const OPERATORS: OperatorDef[] = [
  { key: "eq", sqlLabel: "=", label: "ist gleich", needsValue: true },
  { key: "neq", sqlLabel: "<>", label: "ist ungleich", needsValue: true },
  { key: "in", sqlLabel: "IN", label: "ist in Liste", needsValue: true },
  { key: "notIn", sqlLabel: "NOT IN", label: "ist nicht in Liste", needsValue: true },
  { key: "gt", sqlLabel: ">", label: "ist größer als", needsValue: true },
  { key: "gte", sqlLabel: ">=", label: "ist größer/gleich", needsValue: true },
  { key: "lt", sqlLabel: "<", label: "ist kleiner als", needsValue: true },
  { key: "lte", sqlLabel: "<=", label: "ist kleiner/gleich", needsValue: true },
  { key: "contains", sqlLabel: "LIKE '%…%'", label: "enthält", needsValue: true },
  { key: "startsWith", sqlLabel: "LIKE '…%'", label: "beginnt mit", needsValue: true },
  { key: "endsWith", sqlLabel: "LIKE '%…'", label: "endet mit", needsValue: true },
  { key: "isNull", sqlLabel: "IS NULL", label: "ist NULL", needsValue: false },
  { key: "isNotNull", sqlLabel: "IS NOT NULL", label: "ist nicht NULL", needsValue: false },
];

export type FilterKind = DatabaseKind | null | undefined;

export function filterOperatorsForKind(kind?: FilterKind): OperatorDef[] {
  if (kind === "cassandra") {
    return OPERATORS.filter((op) => ["eq", "gt", "gte", "lt", "lte", "in"].includes(op.key));
  }
  if (kind === "redis") {
    return OPERATORS.filter((op) => ["eq", "contains", "startsWith", "endsWith"].includes(op.key));
  }
  if (kind === "dynamodb") {
    return OPERATORS.filter((op) => !["in", "notIn", "endsWith"].includes(op.key));
  }
  return OPERATORS;
}

export function filterOperatorLabel(key: string, translated = true, kind?: FilterKind): string {
  const operator = OPERATORS.find((op) => op.key === key);
  if (!operator) return key;
  if (translated) return operator.label;
  if (kind === "redis") {
    return (
      { eq: "MATCH …", contains: "MATCH *…*", startsWith: "MATCH …*", endsWith: "MATCH *…" }[key] ??
      key
    );
  }
  if (kind === "mongodb") {
    return (
      {
        eq: "$eq",
        neq: "$ne",
        gt: "$gt",
        gte: "$gte",
        lt: "$lt",
        lte: "$lte",
        in: "$in",
        notIn: "$nin",
        contains: "$regex …",
        startsWith: "$regex ^…",
        endsWith: "$regex …$",
        isNull: "$type: null",
        isNotNull: "$exists + $ne: null",
      }[key] ?? key
    );
  }
  const insensitive = !kind || ["postgres", "duckdb", "clickhouse"].includes(kind);
  return insensitive ? operator.sqlLabel.replace("LIKE", "ILIKE") : operator.sqlLabel;
}

export function filterSupportsOr(kind?: FilterKind): boolean {
  return kind !== "cassandra" && kind !== "redis";
}

export function combineFilterConditions(
  parts: string[],
  combinator: "AND" | "OR",
  kind?: FilterKind,
): string {
  if (!parts.length) return "";
  if (kind === "mongodb") {
    return parts.length === 1
      ? parts[0]
      : JSON.stringify({
          [combinator === "OR" ? "$or" : "$and"]: parts.map((part) => JSON.parse(part)),
        });
  }
  return parts.join(` ${filterSupportsOr(kind) ? combinator : "AND"} `);
}

export function operatorNeedsList(key: string): boolean {
  return key === "in" || key === "notIn";
}

export function parseFilterList(value: string): string[] {
  if (!value.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return [...new Set(parsed.filter((item) => item.trim() !== ""))];
    }
  } catch {
    return [value];
  }
  return [value];
}

export function changeFilterOperator(value: string, previous: string, next: string): string {
  if (operatorNeedsList(previous) === operatorNeedsList(next)) return value;
  return operatorNeedsList(next)
    ? JSON.stringify(value.trim() ? [value] : [])
    : (parseFilterList(value)[0] ?? "");
}

export function operatorNeedsValue(key: string): boolean {
  return OPERATORS.find((op) => op.key === key)?.needsValue ?? true;
}
