import { activeRuleConditions, ROW_RULE_COLORS } from "@/lib/row-rules";
import {
  filterOperatorsForKind,
  filterSupportsOr,
  operatorNeedsList,
  operatorNeedsValue,
  parseFilterList,
} from "@/lib/sql-filter";
import type { FilterCondition } from "@/lib/table-view-state";
import type { FilterAiContext } from "./types";

export const FILTER_AI_MAX_PROMPT = 2_000;
export const FILTER_AI_MAX_COLUMNS = 300;
const MAX_SQL = 4_000;
const MAX_TYPE = 60;
const MAX_NAME = 120;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function wireCondition(condition: FilterCondition) {
  return {
    column: condition.column,
    operator: condition.operator,
    ...(operatorNeedsValue(condition.operator)
      ? {
          value: operatorNeedsList(condition.operator)
            ? parseFilterList(condition.value)
            : condition.value,
        }
      : {}),
  };
}

function colorName(color: string): string {
  return ROW_RULE_COLORS.find((entry) => entry.value === color.toLowerCase())?.name ?? color;
}

function dialect(context: FilterAiContext): string {
  if (context.kind === "cassandra") return "CQL";
  return context.kind ? `${context.kind} SQL` : "SQL";
}

function sqlInstruction(context: FilterAiContext): string {
  if (context.json)
    return '"sql" is the complete new MongoDB filter document as a JSON string, for example "{\\"status\\":\\"error\\"}". Keep current conditions unless the user asks otherwise. Leave out "sql" to keep it unchanged.';
  return `"sql" is the complete new ${dialect(context)} WHERE condition without the WHERE keyword: one expression, no semicolons, no comments, nothing that writes data. Keep current conditions unless the user asks otherwise. Leave out "sql" to keep it unchanged.`;
}

export function filterAiSystemPrompt(context: FilterAiContext): string {
  const operators = filterOperatorsForKind(context.kind)
    .map((operator) => operator.key)
    .join(", ");
  return [
    "You turn a user's request into table filters and row colour rules for a database client.",
    "Reply with exactly one JSON object and nothing else: no Markdown, no prose.",
    context.mode === "sql"
      ? 'Schema: {"sql": string, "rules": Rule[], "note": string}'
      : 'Schema: {"filters": Condition[], "combinator": "AND" | "OR", "rules": Rule[], "note": string}',
    'Condition: {"column": string, "operator": string, "value": string | number | boolean | string[]}',
    'Rule: {"color": string, "combinator": "AND" | "OR", "conditions": Condition[]}',
    "Use only the listed column names, spelled exactly.",
    `operator is one of: ${operators}.`,
    "in and notIn take an array of strings. isNull and isNotNull take no value. contains, startsWith and endsWith take plain text without wildcards.",
    "Write dates as YYYY-MM-DD or YYYY-MM-DD HH:MM:SS and resolve relative dates such as last week yourself.",
    context.mode === "sql"
      ? sqlInstruction(context)
      : '"filters" is the complete new filter list: keep the current filters unless the user asks to change or remove them. Leave out "filters" to keep them unchanged.',
    'Rules colour matching rows without hiding the other rows. Use them when the user wants to mark, highlight or colour rows. "rules" is the complete new rule list; leave it out to keep the current rules.',
    `color is one of: ${ROW_RULE_COLORS.map((color) => color.name).join(", ")}.`,
    ...(filterSupportsOr(context.kind)
      ? []
      : ["This database does not support OR: always use AND."]),
    'If the request cannot be expressed with these columns, reply only {"note": "<short German explanation>"}.',
    "note is optional: German, at most one short sentence.",
  ].join("\n");
}

export function filterAiSchema(context: FilterAiContext): string {
  const types = new Map(context.columnDetails?.map((column) => [column.name, column.data_type]));
  const listed = context.columns.slice(0, FILTER_AI_MAX_COLUMNS).map((column) => {
    const type = types.get(column);
    return `- ${clip(column, MAX_NAME)}${type ? ` (${clip(type, MAX_TYPE)})` : ""}`;
  });
  const hidden = context.columns.length - listed.length;
  return [
    `Database: ${context.kind ?? "unknown"}`,
    "Columns:",
    ...listed,
    ...(hidden > 0 ? [`(${hidden} more columns not listed)`] : []),
  ].join("\n");
}

export function filterAiUserMessage(context: FilterAiContext, prompt: string): string {
  const current =
    context.mode === "sql"
      ? `Current ${context.json ? "MongoDB filter" : "SQL"}: ${clip(context.sql.trim(), MAX_SQL) || "(none)"}`
      : `Current filters: ${JSON.stringify({
          combinator: context.combinator,
          filters: activeRuleConditions(context.conditions).slice(0, 25).map(wireCondition),
        })}`;
  const rules = context.rules.slice(0, 12).map((rule) => ({
    color: colorName(rule.color),
    combinator: rule.combinator,
    conditions: activeRuleConditions(rule.conditions).slice(0, 10).map(wireCondition),
  }));
  return [
    `Today: ${context.today}`,
    current,
    `Current rules: ${JSON.stringify(rules)}`,
    `Request: ${clip(prompt.trim(), FILTER_AI_MAX_PROMPT)}`,
  ].join("\n");
}

export function filterAiRequest(context: FilterAiContext, prompt: string) {
  return {
    system: filterAiSystemPrompt(context),
    cached: filterAiSchema(context),
    messages: [{ role: "user" as const, text: filterAiUserMessage(context, prompt) }],
    maxTokens: 1_500,
  };
}
