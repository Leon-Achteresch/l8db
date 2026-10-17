import { filterConditionsText, filterConditionText } from "@/lib/filter-bar-format";
import { activeRuleConditions } from "@/lib/row-rules";
import { compileFilterConditions, operatorNeedsList, parseFilterList } from "@/lib/sql-filter";
import type { FilterCondition, RowRule } from "@/lib/table-view-state";
import type { FilterAiChange, FilterAiContext, FilterAiProposal } from "./types";

function conditionKey(condition: FilterCondition): string {
  return JSON.stringify([
    condition.column,
    condition.operator,
    operatorNeedsList(condition.operator)
      ? parseFilterList(condition.value).sort()
      : condition.value,
  ]);
}

function ruleKey(rule: RowRule): string {
  return JSON.stringify([
    rule.color.toLowerCase(),
    rule.combinator,
    activeRuleConditions(rule.conditions).map(conditionKey).sort(),
  ]);
}

function diff<T>(
  before: T[],
  after: T[],
  key: (item: T) => string,
  change: (item: T, kind: FilterAiChange["kind"]) => FilterAiChange,
): FilterAiChange[] {
  const previous = new Set(before.map(key));
  const next = new Set(after.map(key));
  return [
    ...after.map((item) => change(item, previous.has(key(item)) ? "keep" : "add")),
    ...before.filter((item) => !next.has(key(item))).map((item) => change(item, "remove")),
  ];
}

export function filterAiChanges(
  context: FilterAiContext,
  proposal: FilterAiProposal,
): FilterAiChange[] {
  const changes: FilterAiChange[] = [];
  const current = activeRuleConditions(context.conditions);
  if (proposal.sql !== null) {
    const before = (
      context.mode === "sql"
        ? context.sql
        : compileFilterConditions(current, context.combinator, context.kind, context.columnDetails)
    ).trim();
    const after = proposal.sql.trim();
    if (before === after) {
      if (after) changes.push({ kind: "keep", target: "sql", label: after });
    } else {
      if (before) changes.push({ kind: "remove", target: "sql", label: before });
      if (after) changes.push({ kind: "add", target: "sql", label: after });
    }
  }
  if (proposal.conditions !== null) {
    changes.push(
      ...diff(current, proposal.conditions, conditionKey, (condition, kind) => ({
        kind,
        target: "filter",
        label: filterConditionText(condition),
      })),
    );
    const before = current.length > 1 ? context.combinator : "AND";
    if (proposal.conditions.length > 1 && proposal.combinator !== before) {
      changes.push({
        kind: "add",
        target: "filter",
        label: `Bedingungen mit „${proposal.combinator === "OR" ? "oder" : "und"}“ verknüpft`,
      });
    }
  }
  if (proposal.rules !== null) {
    changes.push(
      ...diff(context.rules, proposal.rules, ruleKey, (rule, kind) => ({
        kind,
        target: "rule",
        label: filterConditionsText(activeRuleConditions(rule.conditions), rule.combinator),
        color: rule.color,
      })),
    );
  }
  return changes;
}

export function filterAiContextKey(context: FilterAiContext): string {
  return JSON.stringify([
    context.mode,
    context.sql.trim(),
    context.combinator,
    activeRuleConditions(context.conditions).map(conditionKey),
    context.rules.map(ruleKey),
  ]);
}

export function filterAiHasChanges(changes: FilterAiChange[]): boolean {
  return changes.some((change) => change.kind !== "keep");
}
