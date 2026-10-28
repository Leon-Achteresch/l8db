import { filterOperatorLabel, operatorNeedsValue, parseFilterList } from "@/lib/sql-filter";
import type { FilterCondition, RowRule } from "@/lib/table-view-state";

export const ROW_RULE_COLORS = [
  { name: "red", label: "Rot", value: "#ef4444" },
  { name: "orange", label: "Orange", value: "#f97316" },
  { name: "yellow", label: "Gelb", value: "#eab308" },
  { name: "green", label: "Grün", value: "#22c55e" },
  { name: "teal", label: "Türkis", value: "#14b8a6" },
  { name: "blue", label: "Blau", value: "#3b82f6" },
  { name: "violet", label: "Violett", value: "#8b5cf6" },
  { name: "pink", label: "Pink", value: "#ec4899" },
] as const;

export function nextRuleColor(rules: { color: string }[]): string {
  const used = new Set(rules.map((rule) => rule.color.toLowerCase()));
  return (
    ROW_RULE_COLORS.find((color) => !used.has(color.value))?.value ??
    ROW_RULE_COLORS[rules.length % ROW_RULE_COLORS.length].value
  );
}

export function ruleColorLabel(color: string): string {
  return ROW_RULE_COLORS.find((entry) => entry.value === color.toLowerCase())?.label ?? color;
}

function text(value: unknown): string {
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function compare(left: string, right: string): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(right.trim()) && /^\d{4}-\d{2}-\d{2}[ T]/.test(left)) {
    return left.slice(0, 10).localeCompare(right.trim());
  }
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
