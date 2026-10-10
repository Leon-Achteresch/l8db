import type { DatabaseKind } from "@/lib/db";
import { quoteString } from "@/lib/sql-filter/quote";
import type { DashboardVariable } from "./model";

export type VariableValues = Record<string, string>;

export interface VariableScope {
  variables: DashboardVariable[];
  values: VariableValues;
}

export const EMPTY_SCOPE: VariableScope = { variables: [], values: {} };

const TOKEN = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
const QUOTED_OR_TOKEN =
  /('(?:[^'\\]|\\.|'')*'|"(?:[^"\\]|\\.|"")*")|\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
const WHOLE_TOKEN = /^\s*\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}\s*$/;

export function variableName(label: string): string {
  const base = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return /^[a-z_]/.test(base) ? base : `v_${base || "wert"}`;
}

export function variableToken(name: string): string {
  return `{{${name}}}`;
}

export function scopeValue(scope: VariableScope, name: string): string | null {
  const variable = scope.variables.find((v) => v.name === name);
  if (!variable) return null;
  return scope.values[name] ?? variable.defaultValue ?? "";
}

export function variableLiteral(
  variable: DashboardVariable,
  value: string,
  kind: DatabaseKind | null,
): string {
  const trimmed = value.trim();
  if (!trimmed) return "NULL";
  if (variable.type === "number") return /^-?\d+(\.\d+)?$/.test(trimmed) ? trimmed : "NULL";
  if (variable.type === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return "NULL";
    return kind === "oracle" ? `DATE '${trimmed}'` : `'${trimmed}'`;
  }
  return quoteString(neutralBackslashes(trimmed, kind), kind ?? undefined);
}

export function neutralBackslashes(value: string, kind: DatabaseKind | null): string {
  return kind === "odbc" ? value.replace(/\\/g, "\\\\") : value;
}

export function substituteVariables(
  sql: string,
  scope: VariableScope,
  kind: DatabaseKind | null,
): string {
  if (!sql.includes("{{")) return sql;
  return sql.replace(QUOTED_OR_TOKEN, (token, quoted: string | undefined, name: string) => {
    if (quoted) return token;
    const variable = scope.variables.find((v) => v.name === name);
    if (!variable) return token;
    return variableLiteral(variable, scopeValue(scope, name) ?? "", kind);
  });
}

export function filterVariable(value: string): string | null {
  return WHOLE_TOKEN.exec(value)?.[1] ?? null;
}

export function usedVariables(text: string): string[] {
  return [...new Set([...text.matchAll(TOKEN)].map((match) => match[1]))];
}
