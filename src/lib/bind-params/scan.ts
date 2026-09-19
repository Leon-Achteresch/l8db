import type { BindParamOccurrence, BindParamRef } from "./types";

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
