import { filterOperatorLabel, operatorNeedsValue, parseFilterList } from "@/lib/sql-filter";
import type { FilterCondition, RowRule } from "@/lib/table-view-state";

function text(value: unknown): string {
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function compare(left: string, right: string): number {
  const a = Number(left);
  const b = Number(right);
  if (left.trim() !== "" && right.trim() !== "" && Number.isFinite(a) && Number.isFinite(b)) {
    return a - b;
  }
  return left.localeCompare(right);
}

function matchesCondition(row: Record<string, unknown>, condition: FilterCondition): boolean {
  const raw = row[condition.column];
  if (condition.operator === "isNull") return raw == null;
  if (condition.operator === "isNotNull") return raw != null;
  if (raw == null) return false;
  const value = text(raw);
  const target = condition.value;
  switch (condition.operator) {
    case "eq":
      return compare(value, target) === 0;
    case "neq":
      return compare(value, target) !== 0;
    case "gt":
      return compare(value, target) > 0;
    case "gte":
      return compare(value, target) >= 0;
    case "lt":
      return compare(value, target) < 0;
    case "lte":
      return compare(value, target) <= 0;
    case "in":
      return parseFilterList(target).some((item) => compare(value, item) === 0);
    case "notIn":
      return !parseFilterList(target).some((item) => compare(value, item) === 0);
    case "contains":
      return value.toLowerCase().includes(target.toLowerCase());
    case "startsWith":
      return value.toLowerCase().startsWith(target.toLowerCase());
    case "endsWith":
      return value.toLowerCase().endsWith(target.toLowerCase());
    default:
      return false;
  }
}

export function activeRuleConditions(conditions: FilterCondition[]): FilterCondition[] {
  return conditions.filter(
    (condition) =>
      condition.column &&
      (condition.operator === "isNull" ||
        condition.operator === "isNotNull" ||
        condition.value.trim() !== ""),
  );
}

export function describeRule(conditions: FilterCondition[], combinator: "AND" | "OR"): string {
  return activeRuleConditions(conditions)
    .map((condition) =>
      [
        condition.column,
        filterOperatorLabel(condition.operator),
        operatorNeedsValue(condition.operator) ? parseFilterList(condition.value).join(", ") : "",
      ]
        .filter(Boolean)
        .join(" "),
    )
    .join(combinator === "OR" ? " oder " : " und ");
}

export function rowRuleColor(row: Record<string, unknown>, rules: RowRule[]): string | undefined {
  return rules.find((rule) => {
    const conditions = activeRuleConditions(rule.conditions);
    if (!conditions.length) return false;
    return rule.combinator === "OR"
      ? conditions.some((condition) => matchesCondition(row, condition))
      : conditions.every((condition) => matchesCondition(row, condition));
  })?.color;
}
