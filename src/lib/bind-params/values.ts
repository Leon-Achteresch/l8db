import type { DatabaseKind } from "@/lib/db";
import { detectBindParams, scanBindParams } from "./scan";
import type { BindParamRef, BindParamType, BindParamValue, ParameterizedQuery } from "./types";

export function pgCastFor(type: BindParamType): string {
  switch (type) {
    case "int":
      return "bigint";
    case "numeric":
      return "numeric";
    case "bool":
      return "boolean";
    case "timestamp":
      return "timestamptz";
    default:
      return "text";
  }
}

const INT_PATTERN = /^[+-]?\d+$/;

const NUMERIC_PATTERN = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

const TRUE_VALUES = ["true", "t", "1", "yes", "y"];

const FALSE_VALUES = ["false", "f", "0", "no", "n"];

export function normalizeBindValue(entry: BindParamValue): string | null {
  if (entry.type === "null") return null;
  const raw = entry.value;
  if (entry.type === "bool") {
    const lowered = raw.trim().toLowerCase();
    if (TRUE_VALUES.includes(lowered)) return "true";
    if (FALSE_VALUES.includes(lowered)) return "false";
    return raw;
  }
  if (entry.type === "int" || entry.type === "numeric" || entry.type === "timestamp") {
    return raw.trim();
  }
  return raw;
}

export function validateBindParams(
  refs: BindParamRef[],
  values: Record<string, BindParamValue | undefined>,
): string[] {
  const errors: string[] = [];
  const positional = refs
    .filter((ref) => !ref.named)
    .map((ref) => Number(ref.name))
    .sort((a, b) => a - b);
  positional.forEach((value, index) => {
    if (value !== index + 1) errors.push(`Platzhalter $${index + 1} fehlt.`);
  });
  for (const ref of refs) {
    const entry = values[ref.name];
    if (!entry) {
      errors.push(`${ref.label}: Wert fehlt.`);
      continue;
    }
    if (entry.type === "null") continue;
    const raw = entry.value.trim();
    if (entry.type === "int") {
      if (!INT_PATTERN.test(raw)) errors.push(`${ref.label}: Keine gültige Ganzzahl.`);
      continue;
    }
    if (entry.type === "numeric") {
      if (!NUMERIC_PATTERN.test(raw)) errors.push(`${ref.label}: Keine gültige Dezimalzahl.`);
      continue;
    }
    if (entry.type === "bool") {
      const lowered = raw.toLowerCase();
      if (!TRUE_VALUES.includes(lowered) && !FALSE_VALUES.includes(lowered)) {
        errors.push(`${ref.label}: Nur true oder false erlaubt.`);
      }
      continue;
    }
    if (entry.type === "timestamp") {
      if (!raw || Number.isNaN(Date.parse(raw))) {
        errors.push(`${ref.label}: Kein gültiger Zeitstempel.`);
      }
      continue;
    }
    if (entry.type === "text" && entry.value.length === 0) {
      errors.push(`${ref.label}: Wert fehlt.`);
    }
  }
  return errors;
}

export function buildParameterizedQuery(
  sql: string,
  values: Record<string, BindParamValue | undefined>,
  kind?: DatabaseKind,
): ParameterizedQuery {
  const refs = detectBindParams(sql);
  const order = new Map<string, number>();
  for (const [index, ref] of refs.entries()) {
    order.set(`${ref.named ? ":" : "$"}${ref.name}`, index + 1);
  }
  const occurrences = scanBindParams(sql);
  let out = "";
  let cursor = 0;
  for (const occurrence of occurrences) {
    const key = `${occurrence.named ? ":" : "$"}${occurrence.name}`;
    const position = order.get(key);
    if (position === undefined) continue;
    const ref = refs[position - 1];
    const entry = values[ref.name];
    const type: BindParamType = entry?.type ?? "text";
    out += sql.slice(cursor, occurrence.start);
    out += kind === "oracle" ? `$${position}` : `$${position}::${pgCastFor(type)}`;
    cursor = occurrence.end;
  }
  out += sql.slice(cursor);
  return {
    sql: out,
    values: refs.map((ref) => {
      const entry = values[ref.name];
      if (!entry) return null;
      return normalizeBindValue(entry);
    }),
  };
}

function sqlLiteral(entry: BindParamValue | undefined): string {
  const value = entry ? normalizeBindValue(entry) : null;
  if (value === null) return "NULL";
  if (entry?.type === "int" || entry?.type === "numeric" || entry?.type === "bool") return value;
  if (entry?.type === "timestamp") return `TIMESTAMP '${value.replace(/'/g, "''")}'`;
  return `'${value.replace(/'/g, "''")}'`;
}

export function inlineBindValues(
  sql: string,
  values: Record<string, BindParamValue | undefined>,
): string {
  let out = "";
  let cursor = 0;
  for (const occurrence of scanBindParams(sql)) {
    out += sql.slice(cursor, occurrence.start) + sqlLiteral(values[occurrence.name]);
    cursor = occurrence.end;
  }
  return out + sql.slice(cursor);
}
