import type { DatabaseKind } from "@/lib/db";

interface TableToken {
  word: string | null;
  ident: string | null;
  mark: "(" | ")" | "," | "." | "[" | "]" | "number" | null;
  start: number;
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
  [/sql ?server|mssql|msodbcsql|sql native client|sqlncli|freetds|tdsodbc|azure sql/i, "mssql"],
  [/mysql|myodbc|maria/i, "mysql"],
  [/sqlite/i, "sqlite"],
  [/oracle|sqora/i, "oracle"],
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
  const raw = /(?:^|[;?&])\s*driver\s*=\s*\{?([^};&]+)/i.exec(connectionString ?? "")?.[1] ?? "";
  let driver = raw.replace(/\+/g, " ");
  try {
    driver = decodeURIComponent(driver);
  } catch {}
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
      tokens.push({ word: null, ident: text.toLowerCase(), mark: null, start: i, end });
      i = end;
    } else if (c === "(" || c === ")" || c === "," || c === "." || c === "[" || c === "]") {
      tokens.push({ word: null, ident: null, mark: c, start: i, end: i + 1 });
      i++;
    } else if (/\d/.test(c)) {
      const length = sql.slice(i, i + 64).match(NUMBER)?.[0].length || 1;
      tokens.push({ word: null, ident: null, mark: "number", start: i, end: i + length });
      i += length;
    } else if (WORD_START.test(c)) {
      const start = i++;
      while (i < sql.length && WORD_PART.test(sql[i])) i++;
      const text = sql.slice(start, i).toLowerCase();
      tokens.push({ word: text, ident: text, mark: null, start, end: i });
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

export interface TableRef {
  schema: string | null;
  name: string;
}

function cteNames(tokens: TableToken[]): Set<string> {
  return cteList(tokens).names;
}

function cteList(tokens: TableToken[]): { names: Set<string>; body: number } {
  const names = new Set<string>();
  if (tokens[0]?.word !== "with") return { names, body: 0 };
  let index = tokens[1]?.word === "recursive" ? 2 : 1;
  while (index < tokens.length) {
    const name = tokens[index]?.ident;
    if (!name) break;
    names.add(name);
    index++;
    const skipGroup = () => {
      let depth = 0;
      do {
        if (tokens[index]?.mark === "(") depth++;
        else if (tokens[index]?.mark === ")") depth--;
        index++;
      } while (index < tokens.length && depth > 0);
    };
    if (tokens[index]?.mark === "(") skipGroup();
    if (tokens[index]?.word !== "as") break;
    index++;
    while (tokens[index]?.word === "not" || tokens[index]?.word === "materialized") index++;
    if (tokens[index]?.mark !== "(") break;
    skipGroup();
    if (tokens[index]?.mark !== ",") return { names, body: index };
    index++;
  }
  return { names, body: -1 };
}

export interface ServerSqlParts {
  ctes: string;
  body: string;
}

function splitItems(tokens: TableToken[], from: number, to: number): TableToken[][] {
  const items: TableToken[][] = [[]];
  let depth = 0;
  for (let index = from; index < to; index++) {
    const token = tokens[index];
    if (token.mark === "(") depth++;
    else if (token.mark === ")") depth--;
    if (token.mark === "," && depth === 0) items.push([]);
    else items[items.length - 1].push(token);
  }
  return items.filter((item) => item.length);
}

function outputNames(sql: string, tokens: TableToken[], select: number): Set<string> | null {
  let index = select + 1;
  if (tokens[index]?.word === "top") {
    index++;
    if (tokens[index]?.mark === "(") {
      let depth = 0;
      do {
        if (tokens[index]?.mark === "(") depth++;
        else if (tokens[index]?.mark === ")") depth--;
        index++;
      } while (index < tokens.length && depth > 0);
    } else index++;
    if (tokens[index]?.word === "percent") index++;
    if (tokens[index]?.word === "with" && tokens[index + 1]?.word === "ties") index += 2;
  }
  let end = index;
  let depth = 0;
  for (; end < tokens.length; end++) {
    const token = tokens[end];
    if (token.mark === "(") depth++;
    else if (token.mark === ")") depth--;
    if (depth === 0 && (token.word === "from" || token.word === "union" || token.word === "into"))
      break;
  }
  const names = new Set<string>();
  for (const item of splitItems(tokens, index, end)) {
    const text = sql.slice(item[0].start, item[item.length - 1].end);
    if (text.includes("*")) return null;
    const last = item[item.length - 1];
    if (!last.ident) return null;
    names.add(last.ident);
  }
  return names;
}

function movableOrder(
  sql: string,
  tokens: TableToken[],
  order: number,
  names: Set<string> | null,
): string | null {
  const parts: string[] = [];
  for (const item of splitItems(tokens, order + 2, tokens.length)) {
    let direction = "";
    let body = item;
    const tail = item[item.length - 1].word;
    if (tail === "asc" || tail === "desc") {
      direction = ` ${tail.toUpperCase()}`;
      body = item.slice(0, -1);
    }
    if (body.length === 1 && body[0].mark === "number") {
      parts.push(`${sql.slice(body[0].start, body[0].end)}${direction}`);
      continue;
    }
    const simple = body.every((token, i) =>
      i % 2 === 0 ? token.ident !== null : token.mark === ".",
    );
    if (!simple || body.length % 2 === 0) return null;
    const column = body[body.length - 1];
    if (column.ident === null || (names !== null && !names.has(column.ident))) return null;
    parts.push(`${sql.slice(column.start, column.end)}${direction}`);
  }
  return parts.length ? `ORDER BY ${parts.join(", ")}` : null;
}

export function serverSqlParts(sql: string): ServerSqlParts {
  const tokens = tokensOf(sql, "mssql");
  const { body } = cteList(tokens);
  const bodyToken = tokens[body];
  const ctes = body > 0 && bodyToken ? sql.slice(0, tokens[body - 1].end).trimEnd() : "";
  let text = ctes ? sql.slice(bodyToken.start) : sql;
  const offset = ctes ? bodyToken.start : 0;
  let depth = 0;
  let select = -1;
  let ordered = false;
  let top = false;
  let paged = false;
  let combined = false;
  let orderStart = -1;
  let orderIndex = -1;
  for (let index = Math.max(body, 0); index < tokens.length; index++) {
    const token = tokens[index];
    if (token.mark === "(") depth++;
    else if (token.mark === ")") depth--;
    if (depth !== 0) continue;
    if (token.word === "select" && select < 0) {
      const next = tokens[index + 1];
      select = next?.word === "distinct" || next?.word === "all" ? index + 1 : index;
      if (tokens[select + 1]?.word === "top") top = true;
    } else if (token.word === "union" || token.word === "except" || token.word === "intersect")
      combined = true;
    else if (token.word === "order" && tokens[index + 1]?.word === "by") {
      ordered = true;
      orderStart = token.start - offset;
      orderIndex = index;
    } else if (ordered && (token.word === "offset" || token.word === "fetch")) paged = true;
  }
  const limited = paged || (top && !combined);
  if (ordered && !limited && combined && orderStart > 0) {
    const set = text.slice(0, orderStart).trimEnd();
    const names = select >= 0 ? outputNames(sql, tokens, select) : null;
    const order = movableOrder(sql, tokens, orderIndex, names);
    text = order ? `SELECT TOP 2147483647 * FROM (\n${set}\n) AS l8db_u ${order}` : set;
  } else if (ordered && !limited && select >= 0) {
    const at = tokens[select].end - offset;
    text = `${text.slice(0, at)} TOP 2147483647${text.slice(at)}`;
  }
  return { ctes, body: text };
}

export function tablesRead(sql: string, kind: DatabaseKind | null = null): TableRef[] {
  const tokens = tokensOf(sql, kind);
  const ctes = cteNames(tokens);
  const found: TableRef[] = [];
  const stack = [{ from: false, expect: false }];
  let qualifier: string | null = null;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const state = stack[stack.length - 1];
    if (token.mark === ".") continue;
    if (state.expect && (token.word === "only" || token.word === "lateral")) continue;
    if (token.mark === "(") {
      stack.push({ from: state.expect, expect: state.expect });
      state.expect = false;
      qualifier = null;
    } else if (token.mark === ")") {
      if (stack.length > 1) stack.pop();
    } else if (token.mark === ",") {
      if (state.from) state.expect = true;
    } else if (token.word === "from" || token.word === "join") {
      state.from = true;
      state.expect = true;
      qualifier = null;
    } else if (token.word !== null && ENDS_FROM.has(token.word)) {
      state.from = false;
      state.expect = false;
    } else if (token.word === "on" || token.word === "using") {
      state.expect = false;
    } else if (state.expect && token.ident !== null) {
      if (tokens[index + 1]?.mark === ".") {
        qualifier = token.ident;
        continue;
      }
      if (qualifier !== null || !ctes.has(token.ident))
        found.push({ schema: qualifier, name: token.ident });
      qualifier = null;
      state.expect = false;
    }
  }
  return found;
}

export function readsTable(sql: string, table: string, kind: DatabaseKind | null = null): boolean {
  const dot = table.lastIndexOf(".");
  const name = table.slice(dot + 1).toLowerCase();
  if (!name) return false;
  const schema = dot > 0 ? table.slice(0, dot).toLowerCase() : null;
  return tablesRead(sql, kind).some(
    (ref) => ref.name === name && (ref.schema === null || schema === null || ref.schema === schema),
  );
}
