export type BindParamType = "text" | "int" | "numeric" | "bool" | "timestamp" | "null";

export const BIND_PARAM_TYPES: BindParamType[] = [
  "text",
  "int",
  "numeric",
  "bool",
  "timestamp",
  "null",
];

export const BIND_PARAM_TYPE_LABELS: Record<BindParamType, string> = {
  text: "Text",
  int: "Ganzzahl",
  numeric: "Dezimalzahl",
  bool: "Boolean",
  timestamp: "Zeitstempel",
  null: "NULL",
};

export interface BindParamRef {
  name: string;
  named: boolean;
  label: string;
}

export interface BindParamOccurrence {
  start: number;
  end: number;
  name: string;
  named: boolean;
}

export interface BindParamValue {
  type: BindParamType;
  value: string;
}

export interface ParameterizedQuery {
  sql: string;
  values: (string | null)[];
}

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;

function skipLineComment(sql: string, index: number): number {
  const end = sql.indexOf("\n", index);
  return end === -1 ? sql.length : end + 1;
}

function skipBlockComment(sql: string, index: number): number {
  let i = index + 2;
  let depth = 1;
  while (i < sql.length && depth > 0) {
    if (sql.startsWith("/*", i)) {
      depth += 1;
      i += 2;
    } else if (sql.startsWith("*/", i)) {
      depth -= 1;
      i += 2;
    } else {
      i += 1;
    }
  }
  return i;
}

function skipSingleQuoted(sql: string, index: number, escapeString: boolean): number {
  let i = index + 1;
  while (i < sql.length) {
    const c = sql[i];
    if (escapeString && c === "\\") {
      i += 2;
      continue;
    }
    if (c === "'") {
      if (sql[i + 1] === "'") {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i += 1;
  }
  return sql.length;
}

function skipDoubleQuoted(sql: string, index: number): number {
  let i = index + 1;
  while (i < sql.length) {
    if (sql[i] === '"') {
      if (sql[i + 1] === '"') {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i += 1;
  }
  return sql.length;
}

function dollarTagAt(sql: string, index: number): string | null {
  if (sql[index] !== "$") return null;
  let i = index + 1;
  while (i < sql.length && IDENT_PART.test(sql[i])) i += 1;
  if (sql[i] !== "$") return null;
  const tag = sql.slice(index, i + 1);
  if (/^\$\d/.test(tag)) return null;
  return tag;
}

function isEscapeStringStart(sql: string, index: number): boolean {
  const prev = sql[index - 1];
  if (prev !== "e" && prev !== "E") return false;
  const before = sql[index - 2];
  return before === undefined || !IDENT_PART.test(before);
}

export function scanBindParams(sql: string): BindParamOccurrence[] {
  const found: BindParamOccurrence[] = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "-" && sql[i + 1] === "-") {
      i = skipLineComment(sql, i);
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      i = skipBlockComment(sql, i);
      continue;
    }
    if (c === "'") {
      i = skipSingleQuoted(sql, i, isEscapeStringStart(sql, i));
      continue;
    }
    if (c === '"') {
      i = skipDoubleQuoted(sql, i);
      continue;
    }
    if (c === "$") {
      const tag = dollarTagAt(sql, i);
      if (tag) {
        const end = sql.indexOf(tag, i + tag.length);
        i = end === -1 ? sql.length : end + tag.length;
        continue;
      }
      let j = i + 1;
      while (j < sql.length && /\d/.test(sql[j])) j += 1;
      if (j > i + 1) {
        found.push({ start: i, end: j, name: sql.slice(i + 1, j), named: false });
        i = j;
        continue;
      }
      i += 1;
      continue;
    }
    if (c === ":") {
      if (sql[i + 1] === ":") {
        i += 2;
        continue;
      }
      let j = i + 1;
      if (j < sql.length && IDENT_START.test(sql[j])) {
        while (j < sql.length && IDENT_PART.test(sql[j])) j += 1;
        found.push({ start: i, end: j, name: sql.slice(i + 1, j), named: true });
        i = j;
        continue;
      }
      i += 1;
      continue;
    }
    i += 1;
  }
  return found;
}

export function detectBindParams(sql: string): BindParamRef[] {
  const occurrences = scanBindParams(sql);
  const positional = new Set<string>();
  const named: string[] = [];
  for (const occurrence of occurrences) {
    if (occurrence.named) {
      if (!named.includes(occurrence.name)) named.push(occurrence.name);
    } else {
      positional.add(occurrence.name);
    }
  }
  const positionalRefs = [...positional]
    .map((name) => Number(name))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b)
    .map((value) => ({ name: String(value), named: false, label: `$${value}` }));
  const namedRefs = named.map((name) => ({ name, named: true, label: `:${name}` }));
  return [...positionalRefs, ...namedRefs];
}

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
): ParameterizedQuery {
  const refs = detectBindParams(sql);
  const order = new Map<string, number>();
  refs.forEach((ref, index) => order.set(`${ref.named ? ":" : "$"}${ref.name}`, index + 1));
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
    out += `$${position}::${pgCastFor(type)}`;
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
