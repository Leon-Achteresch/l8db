import type { DatabaseKind } from "@/lib/db";

interface TableToken {
  word: string | null;
  ident: string | null;
  mark: "(" | ")" | "," | "." | null;
}

const ENDS_FROM = new Set([
  "where",
  "group",
  "order",
  "having",
  "limit",
  "offset",
  "fetch",
  "union",
  "intersect",
  "except",
  "returning",
  "window",
  "qualify",
  "select",
  "into",
  "set",
  "values",
]);

const WORD_START = /[\p{L}_]/u;
const WORD_PART = /[\p{L}\p{M}\p{N}_$]/u;
const BACKSLASH_KINDS = new Set<DatabaseKind>(["mysql", "clickhouse", "bigquery", "snowflake"]);
const NESTED_COMMENT_KINDS = new Set<DatabaseKind>(["postgres", "mssql", "duckdb", "clickhouse"]);
const HASH_COMMENT_KINDS = new Set<DatabaseKind>(["mysql", "bigquery"]);
const STRING_DOUBLE_QUOTE_KINDS = new Set<DatabaseKind>(["mysql", "bigquery"]);
const SUBSCRIPT_BEFORE = /[\p{L}\p{M}\p{N}_$\])]/u;
const KEYWORD_BEFORE = /(?:^|[^\p{L}\p{M}\p{N}_$.])(?:from|join|as|on|into|update|table|select)$/iu;
const ESCAPED_IDENTIFIER_KINDS = new Set<DatabaseKind>(["clickhouse", "bigquery"]);
const BRACKET_KINDS = new Set<DatabaseKind>(["mssql", "sqlite", "sqlite_http", "odbc"]);
const CACHE_LIMIT = 64;
const cache = new Map<string, TableToken[]>();

function skipQuoted(sql: string, start: number, close: string, backslash: boolean): number {
  let i = start + 1;
  while (i < sql.length) {
    if (sql[i] === close) {
      if (sql[i + 1] === close) i += 2;
      else return i + 1;
    } else if (sql[i] === "\\" && backslash) i += 2;
    else i++;
  }
  return sql.length;
}

function tokenize(sql: string, kind: DatabaseKind | null): TableToken[] {
  const tokens: TableToken[] = [];
  const hash = kind !== null && HASH_COMMENT_KINDS.has(kind);
  const doubleQuoteStrings = kind !== null && STRING_DOUBLE_QUOTE_KINDS.has(kind);
  const backslash = kind !== null && BACKSLASH_KINDS.has(kind);
  const nested = kind === null || NESTED_COMMENT_KINDS.has(kind);
  const brackets = kind === null || BRACKET_KINDS.has(kind);
  const arrays = kind === null || kind === "odbc";
  const escapedIdentifiers = kind !== null && ESCAPED_IDENTIFIER_KINDS.has(kind);
  const subscript = (at: number) =>
    arrays &&
    SUBSCRIPT_BEFORE.test(sql[at - 1] ?? "") &&
    !KEYWORD_BEFORE.test(sql.slice(Math.max(0, at - 8), at));
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (sql.startsWith("--", i) || (hash && c === "#")) {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? sql.length : end + 1;
    } else if (sql.startsWith("/*", i)) {
      let nesting = 1;
      i += 2;
      while (i < sql.length && nesting) {
        if (nested && sql.startsWith("/*", i)) {
          nesting++;
          i += 2;
        } else if (sql.startsWith("*/", i)) {
          nesting--;
          i += 2;
        } else i++;
      }
    } else if ((c === "q" || c === "Q") && sql[i + 1] === "'" && kind === "oracle") {
      const opening = sql[i + 2];
      const closing =
        ({ "[": "]", "(": ")", "{": "}", "<": ">" } as Record<string, string>)[opening] ?? opening;
      const end = sql.indexOf(`${closing}'`, i + 3);
      i = end < 0 ? sql.length : end + 2;
    } else if (c === "$" && /^\$(?:[A-Za-z_]\w*)?\$/.test(sql.slice(i, i + 64))) {
      const tag = sql.slice(i, i + 64).match(/^\$(?:[A-Za-z_]\w*)?\$/)?.[0] ?? "$$";
      const end = sql.indexOf(tag, i + tag.length);
      i = end < 0 ? sql.length : end + tag.length;
    } else if (c === "'") {
      const escapes =
        backslash || (/[eE]/.test(sql[i - 1] ?? "") && !/[\w$]/.test(sql[i - 2] ?? ""));
      i = skipQuoted(sql, i, "'", escapes);
    } else if (c === '"' && doubleQuoteStrings) {
      i = skipQuoted(sql, i, '"', true);
    } else if (c === '"' || c === "`" || (c === "[" && brackets && !subscript(i))) {
      const close = c === "[" ? "]" : c;
      const end = skipQuoted(sql, i, close, c !== "[" && escapedIdentifiers);
      const text = sql
        .slice(i + 1, end - 1)
        .split(close + close)
        .join(close);
      tokens.push({ word: null, ident: text.toLowerCase(), mark: null });
      i = end;
    } else if (c === "(" || c === ")" || c === "," || c === ".") {
      tokens.push({ word: null, ident: null, mark: c });
      i++;
    } else if (WORD_START.test(c)) {
      const start = i++;
      while (i < sql.length && WORD_PART.test(sql[i])) i++;
      const text = sql.slice(start, i).toLowerCase();
      tokens.push({ word: text, ident: text, mark: null });
    } else i++;
  }
  return tokens;
}

function tokensOf(sql: string, kind: DatabaseKind | null): TableToken[] {
  const key = `${kind ?? ""}\u0000${sql}`;
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const tokens = tokenize(sql, kind);
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, tokens);
  return tokens;
}

export function tableTokenCacheKeys(): string[] {
  return [...cache.keys()];
}

export function readsTable(sql: string, table: string, kind: DatabaseKind | null = null): boolean {
  const name = table.slice(table.lastIndexOf(".") + 1).toLowerCase();
  if (!name) return false;
  const tokens = tokensOf(sql, kind);
  const stack = [{ from: false, expect: false }];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const state = stack[stack.length - 1];
    if (token.mark === ".") continue;
    if (state.expect && (token.word === "only" || token.word === "lateral")) continue;
    if (token.mark === "(") {
      stack.push({ from: state.expect, expect: state.expect });
      state.expect = false;
    } else if (token.mark === ")") {
      if (stack.length > 1) stack.pop();
    } else if (token.mark === ",") {
      if (state.from) state.expect = true;
    } else if (token.word === "from" || token.word === "join") {
      state.from = true;
      state.expect = true;
    } else if (token.word !== null && ENDS_FROM.has(token.word)) {
      state.from = false;
      state.expect = false;
    } else if (token.word === "on" || token.word === "using") {
      state.expect = false;
    } else if (state.expect && token.ident !== null) {
      if (tokens[index + 1]?.mark === ".") continue;
      if (token.ident === name) return true;
      state.expect = false;
    }
  }
  return false;
}
