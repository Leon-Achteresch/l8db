import type { DatabaseKind } from "@/lib/db";
import { quoteIdent } from "@/lib/sql-filter";
import { sqlTokens } from "@/lib/sql-safety";
import { splitSqlStatements } from "@/lib/sql-statements";

const WRAP_DIALECTS = new Set<string>([
  "postgres",
  "mysql",
  "sqlite",
  "sqlite_http",
  "duckdb",
  "clickhouse",
  "athena",
  "bigquery",
  "snowflake",
  "oracle",
  "mssql",
]);

const COLUMN_LIST_DIALECTS = new Set<string>(["postgres", "duckdb", "mssql"]);

const SOURCE_ALIAS = "l8db_q";

const FROM_BOUNDARIES = new Set([
  "WHERE",
  "GROUP",
  "HAVING",
  "ORDER",
  "LIMIT",
  "OFFSET",
  "FETCH",
  "WINDOW",
  "QUALIFY",
  "FOR",
  "SETTINGS",
  "FORMAT",
  ";",
]);

export interface QueryPageOptions {
  columns: string[];
  filter: string;
  sort: { column: string; desc: boolean } | null;
  limit: number;
  offset: number;
}

export interface QuerySourceTable {
  schema: string | null;
  table: string;
}

export function supportsQueryResultView(kind: DatabaseKind | undefined): boolean {
  return kind !== undefined && WRAP_DIALECTS.has(kind);
}

export function viewableSelect(sql: string, kind: DatabaseKind): string | null {
  if (!WRAP_DIALECTS.has(kind)) return null;
  const split = splitSqlStatements(sql, kind);
  if (split.unterminated || split.statements.length !== 1) return null;
  const text = split.statements[0].text.trim().replace(/;\s*$/, "").trimEnd();
  if (!text) return null;
  const tokens = sqlTokens(text, kind);
  const words = tokens.filter((token) => token.depth === 0);
  if (!["SELECT", "WITH"].includes(words[0]?.word)) return null;
  if (!words.some((token) => token.word === "SELECT")) return null;
  if (tokens.some((token) => ["INSERT", "UPDATE", "DELETE", "MERGE", "INTO"].includes(token.word)))
    return null;
  if (
    words.some(
      (token, index) =>
        token.word === "FOR" && ["SHARE", "NO", "KEY"].includes(words[index + 1]?.word),
    )
  )
    return null;
  return text;
}

function innerSql(text: string, kind: DatabaseKind): string {
  if (kind !== "mssql") return text;
  const words = sqlTokens(text, kind).filter((token) => token.depth === 0);
  const ordered = words.some(
    (token, index) => token.word === "ORDER" && words[index + 1]?.word === "BY",
  );
  const limited = words.some((token) => ["TOP", "OFFSET", "FOR"].includes(token.word));
  return ordered && !limited ? `${text}\nOFFSET 0 ROWS` : text;
}

function derivedTable(text: string, kind: DatabaseKind, columns: string[]): string {
  const alias = kind === "oracle" ? SOURCE_ALIAS : `AS ${SOURCE_ALIAS}`;
  const list =
    COLUMN_LIST_DIALECTS.has(kind) && columns.length > 0
      ? `(${columns.map((column) => quoteIdent(column, kind)).join(", ")})`
      : "";
  return `(\n${innerSql(text, kind)}\n) ${alias}${list}`;
}

function whereClause(filter: string): string {
  return filter.trim() ? `\nWHERE ${filter.trim()}` : "";
}

export function queryPageSql(text: string, kind: DatabaseKind, options: QueryPageOptions): string {
  const source = `SELECT * FROM ${derivedTable(text, kind, options.columns)}${whereClause(options.filter)}`;
  const order = options.sort
    ? `${quoteIdent(options.sort.column, kind)} ${options.sort.desc ? "DESC" : "ASC"}`
    : null;
  const limit = Math.max(1, Math.floor(options.limit));
  const offset = Math.max(0, Math.floor(options.offset));
  if (kind === "mssql")
    return `${source}\nORDER BY ${order ?? "(SELECT NULL)"}\nOFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
  const orderBy = order ? `\nORDER BY ${order}` : "";
  if (kind === "oracle")
    return `${source}${orderBy}\nOFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
  return `${source}${orderBy}\nLIMIT ${limit} OFFSET ${offset}`;
}

export function queryCountSql(
  text: string,
  kind: DatabaseKind,
  columns: string[],
  filter: string,
  cap?: number,
): string {
  const source = `${derivedTable(text, kind, columns)}${whereClause(filter)}`;
  const outerAlias = kind === "oracle" ? "l8db_c" : "AS l8db_c";
  if (cap === undefined) return `SELECT COUNT(*) AS l8db_count FROM ${source}`;
  const take = Math.max(1, Math.floor(cap)) + 1;
  const inner =
    kind === "mssql"
      ? `SELECT TOP (${take}) 1 AS l8db_one FROM ${source}`
      : kind === "oracle"
        ? `SELECT 1 AS l8db_one FROM ${source}\nFETCH FIRST ${take} ROWS ONLY`
        : `SELECT 1 AS l8db_one FROM ${source}\nLIMIT ${take}`;
  return `SELECT COUNT(*) AS l8db_count FROM (\n${inner}\n) ${outerAlias}`;
}

export function readCount(rows: Record<string, unknown>[]): number {
  const value = rows[0] ? Object.values(rows[0])[0] : 0;
  const count = Number(value);
  return Number.isFinite(count) ? count : 0;
}

function unquote(part: string): string {
  const trimmed = part.trim();
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === '"' && last === '"') || (first === "`" && last === "`"))
    return trimmed.slice(1, -1).replaceAll(first + first, first);
  if (first === "[" && last === "]") return trimmed.slice(1, -1).replaceAll("]]", "]");
  return trimmed;
}

const IDENTIFIER = String.raw`(?:"(?:[^"]|"")+"|\x60(?:[^\x60]|\x60\x60)+\x60|\[(?:[^\]]|\]\])+\]|[\p{L}_][\p{L}\p{N}_$#@]*)`;
const QUALIFIED = new RegExp(
  String.raw`^\s*(${IDENTIFIER}(?:\s*\.\s*${IDENTIFIER}){0,2})(?:\s+(?:AS\s+)?${IDENTIFIER})?\s*$`,
  "iu",
);
const PART = new RegExp(IDENTIFIER, "gu");

export function singleSourceTable(text: string, kind: DatabaseKind): QuerySourceTable | null {
  const tokens = sqlTokens(text, kind);
  const words = tokens.filter((token) => token.depth === 0);
  if (words[0]?.word !== "SELECT") return null;
  if (
    words.some((token) =>
      ["JOIN", "UNION", "EXCEPT", "INTERSECT", "MINUS", "DISTINCT", "GROUP", "PIVOT"].includes(
        token.word,
      ),
    )
  )
    return null;
  const fromIndex = words.findIndex((token) => token.word === "FROM");
  if (fromIndex === -1) return null;
  const from = words[fromIndex];
  const boundary = words.slice(fromIndex + 1).find((token) => FROM_BOUNDARIES.has(token.word));
  const clause = text.slice(from.start + from.word.length, boundary?.start ?? text.length);
  if (/[(),]/.test(clause)) return null;
  const match = QUALIFIED.exec(clause);
  if (!match) return null;
  const parts = (match[1].match(PART) ?? []).map(unquote);
  if (parts.length === 0) return null;
  const table = parts[parts.length - 1];
  const schema = parts.length > 1 ? parts[parts.length - 2] : null;
  return { schema, table };
}
