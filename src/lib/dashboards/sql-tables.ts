import type { DatabaseKind } from "@/lib/db";

interface TableToken {
  word: string | null;
  ident: string | null;
  mark: "(" | ")" | "," | "." | "[" | "]" | "number" | null;
  end: number;
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
const BRACKET_KEYWORDS = new Set([
  "from",
  "join",
  "as",
  "on",
  "into",
  "update",
  "table",
  "select",
  "where",
  "and",
  "or",
  "by",
  "distinct",
  "top",
  "case",
  "when",
  "then",
  "else",
]);
const NAME_END = /[\p{L}\p{M}\p{N}_$\])"`]/u;
const SPACING = /\/\*[\s\S]*?\*\/|--[^\n]*(?:\n|$)|\s+/g;
const NUMBER = /^\d*\.?\d*(?:[eE][+-]?\d+)?/;
const ESCAPED_IDENTIFIER_KINDS = new Set<DatabaseKind>(["clickhouse", "bigquery"]);
const BRACKET_KINDS = new Set<DatabaseKind>(["mssql", "sqlite", "sqlite_http", "odbc"]);
const CACHE_LIMIT = 64;
const cache = new Map<string, TableToken[]>();

const ODBC_DIALECTS: [RegExp, DatabaseKind][] = [
  [/postgres|psql|redshift/i, "postgres"],
  [/sql ?server|mssql|freetds|azure sql/i, "mssql"],
  [/mysql|maria/i, "mysql"],
  [/sqlite/i, "sqlite"],
  [/oracle/i, "oracle"],
  [/clickhouse/i, "clickhouse"],
  [/snowflake/i, "snowflake"],
  [/duckdb/i, "duckdb"],
  [/bigquery|simba google/i, "bigquery"],
];

export function tableDialect(
  kind: DatabaseKind | null | undefined,
  connectionString?: string | null,
): DatabaseKind | null {
  if (kind !== "odbc") return kind ?? null;
  const driver = /(?:^|;)\s*driver\s*=\s*\{?([^};]+)/i.exec(connectionString ?? "")?.[1] ?? "";
  return ODBC_DIALECTS.find(([pattern]) => pattern.test(driver))?.[1] ?? "odbc";
}

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

function nextQuotes(sql: string, quote: string): Int32Array {
  const next = new Int32Array(sql.length + 1).fill(-1);
  for (let i = sql.length - 1; i >= 0; i--) next[i] = sql[i] === quote ? i : next[i + 1];
  return next;
}

const WORD_CHAR = /[\p{L}\p{M}\p{N}_$]/u;

function bracketedIndexEnd(
  sql: string,
  start: number,
  quotes: { single: Int32Array; double: Int32Array },
): number {
  let depth = 1;
  let i = start + 1;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "]" && --depth === 0) return i + 1;
    if (c === "[") depth++;
    if (c === "'" || c === '"') {
      if (WORD_CHAR.test(sql[i - 1] ?? "")) return -1;
      const next = c === "'" ? quotes.single : quotes.double;
      let close = next[i + 1];
      while (close >= 0 && sql[close + 1] === c) close = next[close + 2];
      if (close < 0 || WORD_CHAR.test(sql[close + 1] ?? "")) return -1;
      i = close + 1;
      continue;
    }
    i++;
  }
  return -1;
}

function unbalancedQuotes(text: string): boolean {
  let single = 0;
  let double = 0;
  for (const c of text) {
    if (c === "'") single++;
    else if (c === '"') double++;
  }
  return single % 2 === 1 || double % 2 === 1;
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
  let quotes: { single: Int32Array; double: Int32Array } | undefined;
  const subscript = (at: number) => {
    if (!arrays) return false;
    const last = tokens[tokens.length - 1];
    if (!last) return false;
    const field = tokens[tokens.length - 2]?.mark === ".";
    const indexable =
      last.mark === ")" ||
      last.mark === "]" ||
      (last.ident !== null && (field || last.word === null || !BRACKET_KEYWORDS.has(last.word)));
    if (!indexable) return false;
    if (NAME_END.test(sql[at - 1] ?? " ")) return true;
    const gap = sql.slice(last.end, at).replace(SPACING, "");
    if (gap !== "") return false;
    quotes ??= { single: nextQuotes(sql, "'"), double: nextQuotes(sql, '"') };
    if (bracketedIndexEnd(sql, at, quotes) < 0) return false;
    return unbalancedQuotes(sql.slice(at + 1, skipQuoted(sql, at, "]", false) - 1));
  };
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
      tokens.push({ word: null, ident: text.toLowerCase(), mark: null, end });
      i = end;
    } else if (c === "(" || c === ")" || c === "," || c === "." || c === "[" || c === "]") {
      tokens.push({ word: null, ident: null, mark: c, end: i + 1 });
      i++;
    } else if (/\d/.test(c)) {
      const length = sql.slice(i, i + 64).match(NUMBER)?.[0].length || 1;
      tokens.push({ word: null, ident: null, mark: "number", end: i + length });
      i += length;
    } else if (WORD_START.test(c)) {
      const start = i++;
      while (i < sql.length && WORD_PART.test(sql[i])) i++;
      const text = sql.slice(start, i).toLowerCase();
      tokens.push({ word: text, ident: text, mark: null, end: i });
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
  return tokensRead(tokensOf(sql, kind), name);
}

function tokensRead(tokens: TableToken[], name: string): boolean {
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
