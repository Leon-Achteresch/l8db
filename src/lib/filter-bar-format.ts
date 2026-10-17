import { operatorNeedsList, operatorNeedsValue, parseFilterList } from "@/lib/sql-filter";
import type { FilterCondition } from "@/lib/table-view-state";

const OPERATOR_SYMBOLS: Record<string, string> = {
  eq: "=",
  neq: "≠",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  in: "in",
  notIn: "nicht in",
  contains: "enthält",
  startsWith: "beginnt mit",
  endsWith: "endet mit",
  isNull: "ist NULL",
  isNotNull: "ist nicht NULL",
};

export function filterOperatorSymbol(operator: string): string {
  return OPERATOR_SYMBOLS[operator] ?? operator;
}

export function filterValueText(condition: FilterCondition): string {
  if (!operatorNeedsValue(condition.operator)) return "";
  return operatorNeedsList(condition.operator)
    ? parseFilterList(condition.value).join(", ")
    : condition.value;
}

export function filterConditionText(condition: FilterCondition): string {
  return [condition.column, filterOperatorSymbol(condition.operator), filterValueText(condition)]
    .filter(Boolean)
    .join(" ");
}

export function filterConditionsText(
  conditions: FilterCondition[],
  combinator: "AND" | "OR",
): string {
  return conditions.map(filterConditionText).join(combinator === "OR" ? " oder " : " und ");
}

export function filterIdentifier(column: string): string {
  return /^[\p{L}_][\p{L}\p{N}_$]*$/u.test(column) ? column : `"${column.replace(/"/g, '""')}"`;
}

export function localIsoDate(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
