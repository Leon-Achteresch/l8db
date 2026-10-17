import { parseFilterExpression } from "@/lib/filter-parser";
import { nextRuleColor, ROW_RULE_COLORS } from "@/lib/row-rules";
import {
  compileFilterConditions,
  type FilterOperatorKey,
  filterOperatorLabel,
  filterOperatorsForKind,
  filterSupportsOr,
  operatorNeedsList,
  operatorNeedsValue,
  parseFilterList,
} from "@/lib/sql-filter";
import type { FilterCondition, RowRule } from "@/lib/table-view-state";
import type { FilterAiContext, FilterAiProposal } from "./types";

export const FILTER_AI_MAX_CONDITIONS = 25;
export const FILTER_AI_MAX_RULES = 12;
const MAX_RULE_CONDITIONS = 10;
const MAX_LIST = 200;
const MAX_VALUE = 2_000;
const MAX_SQL = 20_000;
const MAX_NOTE = 300;
const MAX_RESPONSE = 200_000;

type Json = Record<string, unknown>;

const OPERATOR_ALIASES: Record<string, FilterOperatorKey | "between"> = {
  eq: "eq",
  "=": "eq",
  "==": "eq",
  "===": "eq",
  equals: "eq",
  equal: "eq",
  is: "eq",
  neq: "neq",
  ne: "neq",
  "!=": "neq",
  "<>": "neq",
  "!==": "neq",
  notequals: "neq",
  notequal: "neq",
  isnot: "neq",
  gt: "gt",
  ">": "gt",
  greaterthan: "gt",
  after: "gt",
  gte: "gte",
  ">=": "gte",
  "=>": "gte",
  ge: "gte",
  lt: "lt",
  "<": "lt",
  lessthan: "lt",
  before: "lt",
  lte: "lte",
  "<=": "lte",
  "=<": "lte",
  le: "lte",
  in: "in",
  oneof: "in",
  anyof: "in",
  notin: "notIn",
  nin: "notIn",
  noneof: "notIn",
  contains: "contains",
  like: "contains",
  ilike: "contains",
  includes: "contains",
  startswith: "startsWith",
  beginswith: "startsWith",
  prefix: "startsWith",
  endswith: "endsWith",
  suffix: "endsWith",
  isnull: "isNull",
  null: "isNull",
  missing: "isNull",
  isnotnull: "isNotNull",
  notnull: "isNotNull",
  exists: "isNotNull",
  between: "between",
};

const COLOR_ALIASES: Record<string, string> = {
  rot: "red",
  crimson: "red",
  gelb: "yellow",
  amber: "yellow",
  gold: "yellow",
  grün: "green",
  gruen: "green",
  lime: "green",
  türkis: "teal",
  tuerkis: "teal",
  cyan: "teal",
  blau: "blue",
  sky: "blue",
  violett: "violet",
  lila: "violet",
  purple: "violet",
  indigo: "violet",
  rosa: "pink",
  magenta: "pink",
};

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function jsonEnd(source: string, start: number): number | null {
  let depth = 0;
  let quoted = false;
  for (let index = start; index < source.length; index++) {
    const character = source[index];
    if (quoted) {
      if (character === "\\") index++;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{" || character === "[") depth++;
    else if (character === "}" || character === "]") {
      depth--;
      if (depth === 0) return index + 1;
    }
  }
  return null;
}

function parseLoose(candidate: string): unknown {
  try {
    return JSON.parse(candidate);
  } catch {
    const repaired = candidate.replace(/[“”„]/g, '"').replace(/,\s*([}\]])/g, "$1");
    try {
      return JSON.parse(repaired);
    } catch {
      return undefined;
    }
  }
}

export function extractFilterAiJson(text: string): unknown {
  const source = text.slice(0, MAX_RESPONSE);
  const fenced = source.match(/```[a-zA-Z]*\s*([\s\S]*?)```/);
  for (const body of fenced ? [fenced[1], source] : [source]) {
    let start = body.search(/[{[]/);
    while (start >= 0) {
      const end = jsonEnd(body, start);
      if (end === null) break;
      const parsed = parseLoose(body.slice(start, end));
      if (parsed !== undefined) return parsed;
      const next = body.slice(start + 1).search(/[{[]/);
      start = next < 0 ? -1 : start + 1 + next;
    }
  }
  return undefined;
}

function cleanIdent(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^(?:"([^"]*)"|`([^`]*)`|\[([^\]]*)\])$/);
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : trimmed;
}

export function resolveFilterColumn(raw: unknown, columns: string[]): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const cleaned = cleanIdent(raw);
  const tries = [raw.trim(), cleaned, cleanIdent(cleaned.split(".").at(-1) ?? "")];
  for (const name of tries) if (columns.includes(name)) return name;
  for (const name of tries) {
    const matches = columns.filter((column) => column.toLowerCase() === name.toLowerCase());
    if (matches.length === 1) return matches[0];
  }
  return null;
}

function operatorKey(raw: unknown): FilterOperatorKey | "between" | null {
  if (typeof raw !== "string") return null;
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  return OPERATOR_ALIASES[key] ?? null;
}

function scalar(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "boolean" || typeof value === "bigint") return String(value);
  return null;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  return trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")
    ? trimmed.slice(1, -1).replace(/''/g, "'")
    : value;
}

function listValues(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string" && value.trim().startsWith("[")
      ? parseFilterList(value)
      : typeof value === "string"
        ? value.split(",")
        : [value];
  const values = raw
    .map(scalar)
    .filter((item): item is string => item !== null)
    .map((item) => unquote(item).trim())
    .filter((item) => item !== "");
  return [...new Set(values)];
}

function stripWildcards(operator: FilterOperatorKey, value: string): string {
  if (operator === "contains") return value.replace(/^[%*]+|[%*]+$/g, "");
  if (operator === "startsWith") return value.replace(/[%*]+$/, "");
  if (operator === "endsWith") return value.replace(/^[%*]+/, "");
  return value;
}

interface Scope {
  context: FilterAiContext;
  warnings: string[];
  types: Map<string, string>;
}

function warn(scope: Scope, message: string) {
  if (!scope.warnings.includes(message) && scope.warnings.length < 8) scope.warnings.push(message);
}

function condition(
  scope: Scope,
  column: string,
  operator: FilterOperatorKey,
  value: string,
): FilterCondition | null {
  const supported = filterOperatorsForKind(scope.context.kind).some(
    (entry) => entry.key === operator,
  );
  if (!supported) {
    warn(
      scope,
      `„${filterOperatorLabel(operator)}“ wird von dieser Datenbank nicht unterstützt und wurde übersprungen.`,
    );
    return null;
  }
  const dataType = scope.types.get(column);
  return { id: newId(), column, operator, value, ...(dataType ? { dataType } : {}) };
}

function normalizeCondition(scope: Scope, raw: unknown): FilterCondition[] {
  if (!isObject(raw)) return [];
  const columnSource = raw.column ?? raw.field ?? raw.col ?? raw.name;
  const column = resolveFilterColumn(columnSource, scope.context.columns);
  if (!column) {
    warn(
      scope,
      typeof columnSource === "string" && columnSource.trim()
        ? `Spalte „${clip(columnSource.trim(), 60)}“ gibt es nicht – Bedingung übersprungen.`
        : "Eine Bedingung ohne Spalte wurde übersprungen.",
    );
    return [];
  }
  const value = "value" in raw ? raw.value : (raw.values ?? raw.val);
  let operator = operatorKey(raw.operator ?? raw.op ?? raw.comparison ?? "eq");
  if (!operator) {
    warn(scope, `Unbekannter Operator bei „${column}“ – Bedingung übersprungen.`);
    return [];
  }
  if (operator === "between") {
    const bounds = Array.isArray(value)
      ? value
      : isObject(value)
        ? [value.from ?? value.min ?? value.start, value.to ?? value.max ?? value.end]
        : [];
    const [low, high] = bounds.map(scalar);
    const parts = [
      low ? condition(scope, column, "gte", unquote(low)) : null,
      high ? condition(scope, column, "lte", unquote(high)) : null,
    ].filter((part): part is FilterCondition => part !== null);
    if (!parts.length) warn(scope, `Bereich für „${column}“ ohne Grenzen übersprungen.`);
    return parts;
  }
  if (value === null && (operator === "eq" || operator === "neq")) {
    operator = operator === "eq" ? "isNull" : "isNotNull";
  }
  if (!operatorNeedsValue(operator)) {
    const made = condition(scope, column, operator, "");
    return made ? [made] : [];
  }
  if (Array.isArray(value) && value.length > 1 && (operator === "eq" || operator === "neq")) {
    operator = operator === "eq" ? "in" : "notIn";
  }
  if (operatorNeedsList(operator)) {
    const values = listValues(value);
    if (!values.length) {
      warn(scope, `Liste für „${column}“ ist leer – Bedingung übersprungen.`);
      return [];
    }
    if (values.length > MAX_LIST) warn(scope, `Nur die ersten ${MAX_LIST} Listenwerte übernommen.`);
    const made = condition(scope, column, operator, JSON.stringify(values.slice(0, MAX_LIST)));
    return made ? [made] : [];
  }
  const single = scalar(Array.isArray(value) && value.length === 1 ? value[0] : value);
  const text = single === null ? "" : stripWildcards(operator, unquote(single));
  if (!text.trim()) {
    warn(scope, `Bedingung für „${column}“ ohne Wert übersprungen.`);
    return [];
  }
  if (text.length > MAX_VALUE) {
    warn(scope, `Wert für „${column}“ ist zu lang – Bedingung übersprungen.`);
    return [];
  }
  const made = condition(scope, column, operator, text);
  return made ? [made] : [];
}

function signature(condition: FilterCondition): string {
  return JSON.stringify([condition.column, condition.operator, condition.value]);
}

function entriesOf(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw;
  if (!isObject(raw)) return null;
  if (["column", "field", "col", "name"].some((key) => key in raw)) return [raw];
  return Object.entries(raw).map(([column, value]) =>
    isObject(value) && ("operator" in value || "op" in value)
      ? { ...value, column }
      : {
          column,
          operator: Array.isArray(value) ? "in" : value === null ? "isNull" : "eq",
          value,
        },
  );
}

function normalizeConditions(scope: Scope, raw: unknown, limit: number): FilterCondition[] | null {
  const list = entriesOf(raw);
  if (!list) {
    warn(scope, "Bedingungen in der KI-Antwort hatten ein ungültiges Format.");
    return null;
  }
  const seen = new Set<string>();
  const conditions: FilterCondition[] = [];
  for (const entry of list.slice(0, limit * 4)) {
    for (const made of normalizeCondition(scope, entry)) {
      const key = signature(made);
      if (seen.has(key)) continue;
      seen.add(key);
      conditions.push(made);
    }
  }
  if (conditions.length > limit) warn(scope, `Nur die ersten ${limit} Bedingungen übernommen.`);
  if (list.length > 0 && conditions.length === 0) return null;
  return conditions.slice(0, limit);
}

function combinatorOf(
  scope: Scope,
  raw: unknown,
  fallback: "AND" | "OR",
  count: number,
): "AND" | "OR" {
  const text = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  const value =
    text === "OR" || text === "ODER" || text === "||" || text === "ANY"
      ? "OR"
      : text === "AND" || text === "UND" || text === "&&" || text === "ALL"
        ? "AND"
        : fallback;
  if (value === "OR" && !filterSupportsOr(scope.context.kind)) {
    if (count > 1)
      warn(scope, "Diese Datenbank unterstützt kein „oder“ – Bedingungen mit „und“ verknüpft.");
    return "AND";
  }
  return value;
}

function normalizeColor(raw: unknown, taken: { color: string }[]): string {
  if (typeof raw === "string") {
    const text = raw.trim().toLowerCase();
    const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
    if (hex)
      return hex[1].length === 3 ? `#${[...hex[1]].map((digit) => digit + digit).join("")}` : text;
    const name = COLOR_ALIASES[text] ?? text;
    const named = ROW_RULE_COLORS.find((color) => color.name === name);
    if (named) return named.value;
  }
  return nextRuleColor(taken);
}

function normalizeRules(scope: Scope, raw: unknown): RowRule[] | null {
  const list = Array.isArray(raw) ? raw : isObject(raw) ? [raw] : null;
  if (!list) {
    warn(scope, "Farbregeln in der KI-Antwort hatten ein ungültiges Format.");
    return null;
  }
  const rules: RowRule[] = [];
  for (const entry of list.slice(0, FILTER_AI_MAX_RULES * 2)) {
    if (!isObject(entry)) continue;
    const source =
      entry.conditions ??
      entry.filters ??
      entry.where ??
      (entry.column !== undefined || entry.field !== undefined ? [entry] : undefined);
    const conditions =
      source === undefined ? null : normalizeConditions(scope, source, MAX_RULE_CONDITIONS);
    if (!conditions?.length) {
      warn(scope, "Eine Farbregel ohne gültige Bedingung wurde übersprungen.");
      continue;
    }
    rules.push({
      id: newId(),
      color: normalizeColor(entry.color ?? entry.colour, [...rules, ...scope.context.rules]),
      combinator: combinatorOf(scope, entry.combinator, "AND", conditions.length),
      conditions,
    });
  }
  if (rules.length > FILTER_AI_MAX_RULES)
    warn(scope, `Nur die ersten ${FILTER_AI_MAX_RULES} Farbregeln übernommen.`);
  if (list.length > 0 && rules.length === 0) return null;
  return rules.slice(0, FILTER_AI_MAX_RULES);
}

function stripLiterals(sql: string, backslash: boolean): string | null {
  let result = "";
  let index = 0;
  while (index < sql.length) {
    const character = sql[index];
    const close = character === "[" ? "]" : character;
    if (character === "'" || character === '"' || character === "`" || character === "[") {
      index++;
      let closed = false;
      while (index < sql.length) {
        if (backslash && sql[index] === "\\" && close !== "]") {
          index += 2;
          continue;
        }
        if (sql[index] === close) {
          if (sql[index + 1] === close && close !== "]") {
            index += 2;
            continue;
          }
          index++;
          closed = true;
          break;
        }
        index++;
      }
      if (!closed) return null;
      result += " ";
      continue;
    }
    result += character;
    index++;
  }
  return result;
}

const FORBIDDEN_WORDS =
  /\b(union|returning|into|insert|update|delete|drop|alter|create|truncate|grant|revoke|exec|execute|call|merge|copy|attach|detach|pragma|sleep|pg_sleep|waitfor|benchmark)\b/i;

export function filterSqlProblem(sql: string, json: boolean): string | null {
  if (sql.length > MAX_SQL) return "Ausdruck ist zu lang";
  if (json) {
    try {
      const value: unknown = JSON.parse(sql);
      return isObject(value) ? null : "kein JSON-Objekt";
    } catch {
      return "kein gültiges JSON";
    }
  }
  for (const backslash of [false, true]) {
    const outside = stripLiterals(sql, backslash);
    if (outside === null) return "Anführungszeichen nicht geschlossen";
    for (const token of [";", "--", "/*", "*/", "#", "$$"]) {
      if (outside.includes(token)) return `„${token}“ ist nicht erlaubt`;
    }
    const word = outside.match(FORBIDDEN_WORDS);
    if (word) return `„${word[1].toUpperCase()}“ ist nicht erlaubt`;
  }
  return null;
}

function cleanSql(raw: string, json: boolean): string {
  const trimmed = raw.trim();
  if (json) return trimmed;
  return trimmed
    .replace(/^where\s+/i, "")
    .replace(/[\s;]+$/, "")
    .trim();
}

export function parseFilterAiResponse(text: string, context: FilterAiContext): FilterAiProposal {
  if (text.length > MAX_RESPONSE) throw new Error("Die KI-Antwort ist zu lang.");
  const parsed = extractFilterAiJson(text);
  if (parsed === undefined) {
    const snippet = text.trim().replace(/\s+/g, " ");
    throw new Error(
      snippet
        ? `Die KI hat keinen Filter geliefert: „${clip(snippet, 160)}“`
        : "Die KI hat keine Antwort geliefert.",
    );
  }
  const root: Json = Array.isArray(parsed) ? { filters: parsed } : (parsed as Json);
  const scope: Scope = {
    context,
    warnings: [],
    types: new Map(context.columnDetails?.map((column) => [column.name, column.data_type])),
  };
  const noteSource = root.note ?? root.message ?? root.explanation;
  const note = typeof noteSource === "string" ? clip(noteSource.trim(), MAX_NOTE) : "";
  const filterSource = root.filters ?? root.conditions ?? root.filter;
  const sqlSource = [root.sql, root.where, root.filter].find(
    (value) => typeof value === "string",
  ) as string | undefined;

  let conditions =
    filterSource !== undefined && typeof filterSource !== "string"
      ? normalizeConditions(scope, filterSource, FILTER_AI_MAX_CONDITIONS)
      : null;
  const combinator = combinatorOf(
    scope,
    root.combinator ?? root.logic ?? root.join,
    context.combinator,
    conditions?.length ?? 0,
  );
  const rules = rulesOf(scope, root);
  const cleaned = sqlSource === undefined ? null : cleanSql(sqlSource, context.json);
  const sqlProblem = cleaned === null ? null : filterSqlProblem(cleaned, context.json);
  let sql: string | null = null;

  if (context.mode === "sql") {
    if (cleaned !== null && !sqlProblem) sql = cleaned;
    else if (conditions)
      sql = compileFilterConditions(conditions, combinator, context.kind, context.columnDetails);
    conditions = null;
  } else if (!conditions && cleaned !== null && !sqlProblem) {
    try {
      const expression = parseFilterExpression(cleaned, context.columns, context.kind);
      conditions = expression.conditions.map((entry) => {
        const dataType = scope.types.get(entry.column) ?? entry.dataType;
        return { id: newId(), ...entry, ...(dataType ? { dataType } : {}) };
      });
      return finish(scope, {
        conditions,
        combinator: combinatorOf(scope, expression.combinator, "AND", conditions.length),
        sql: null,
        rules,
        note,
      });
    } catch {
      sql = cleaned;
      warn(scope, "Der Vorschlag passt nicht in den einfachen Filter und wird als SQL übernommen.");
    }
  }
  if (sqlProblem && sql === null && conditions === null) {
    const message = `Die KI hat einen ungültigen Ausdruck vorgeschlagen (${sqlProblem}).`;
    if (!rules) throw new Error(message);
    warn(scope, message);
  }
  return finish(scope, { conditions, combinator, sql, rules, note });
}

function rulesOf(scope: Scope, root: Json): RowRule[] | null {
  const source = root.rules ?? root.colors ?? root.highlights;
  return source === undefined ? null : normalizeRules(scope, source);
}

function finish(scope: Scope, proposal: Omit<FilterAiProposal, "warnings">): FilterAiProposal {
  if (
    proposal.conditions === null &&
    proposal.sql === null &&
    proposal.rules === null &&
    !proposal.note
  ) {
    throw new Error(
      scope.warnings.length ? scope.warnings.join(" ") : "Die KI hat keine Änderung vorgeschlagen.",
    );
  }
  return { ...proposal, warnings: scope.warnings };
}
