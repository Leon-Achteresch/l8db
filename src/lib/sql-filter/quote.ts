import { identifierStyleForKind, quoteIdentifier } from "@/lib/export";
import type { FilterKind } from "./operators";

export function quoteIdent(name: string, kind?: FilterKind): string {
  if (kind === "bigquery")
    return name
      .split(".")
      .map((part) => `\`${part.replace(/\\/g, "\\\\").replace(/`/g, "\\`")}\``)
      .join(".");
  return quoteIdentifier(
    kind === "clickhouse" ? name.replace(/\\/g, "\\\\") : name,
    identifierStyleForKind(kind),
  );
}

export function previewQuery(
  schema: string,
  name: string,
  kind?: FilterKind,
  language?: string,
): string {
  if (language === "json") return JSON.stringify({ find: name, filter: {} }, null, 2);
  if (language === "redis") return "SCAN 0 MATCH * COUNT 100";
  const table = `${schema ? `${quoteIdent(schema, kind)}.` : ""}${quoteIdent(name, kind)}`;
  if (kind === "mssql") return `SELECT TOP (100) * FROM ${table}`;
  if (kind === "oracle") return `SELECT * FROM ${table} FETCH FIRST 100 ROWS ONLY`;
  return `SELECT * FROM ${table} LIMIT 100`;
}

export function quoteLiteral(value: string, kind?: FilterKind, dataType?: string): string {
  const trimmed = value.trim();
  const type = (dataType?.toLowerCase() ?? "").replace(
    /^(?:nullable|lowcardinality)\((.*)\)$/,
    "$1",
  );
  if (
    kind === "cassandra" &&
    /^(time)?uuid$/.test(type) &&
    /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(trimmed)
  )
    return trimmed;
  if (
    type &&
    !/^(?:tinyint|smallint|mediumint|bigint|int(?:eger|\d+)?|uint\d+|float\d*|double(?: precision)?|decimal|numeric|number|real|money|smallmoney|bool(?:ean)?|bit)(?:\b|\()/.test(
      type,
    )
  )
    return quoteString(value, kind);
  if (kind === "mssql" && type === "bit" && /^(true|false)$/i.test(trimmed))
    return trimmed.toLowerCase() === "true" ? "1" : "0";
  const strict = kind === "oracle" || kind === "mssql";
  if (!strict && /^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  if (!strict && (trimmed === "true" || trimmed === "false")) return trimmed;
  return quoteString(value, kind);
}

export function quoteString(value: string, kind?: FilterKind): string {
  if (kind === "mysql" && value.includes("\\")) {
    return `CONCAT(${value
      .split("\\")
      .map((part) => quoteString(part, kind))
      .join(", CHAR(92 USING utf8mb4), ")})`;
  }
  if (kind === "bigquery")
    return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n")}'`;
  const postgresEscape = (!kind || kind === "postgres") && value.includes("\\");
  const escaped =
    kind === "clickhouse" || kind === "snowflake" || postgresEscape
      ? value.replace(/\\/g, "\\\\")
      : value;
  return `${kind === "mssql" ? "N" : postgresEscape ? "E" : ""}'${escaped.replace(/'/g, "''")}'`;
}

export function quoteLike(value: string, kind?: FilterKind): string {
  const backslash = kind === "clickhouse" || kind === "influxdb" || kind === "bigquery";
  const escapeCharacter = backslash ? "\\" : "!";
  const special = backslash ? /[%_\\]/g : kind === "mssql" ? /[!%_[]/g : /[!%_]/g;
  return value.replace(special, (character) => `${escapeCharacter}${character}`);
}

export function textMatch(columnExpression: string, pattern: string, kind?: FilterKind): string {
  const literal = quoteString(pattern, kind);
  switch (kind) {
    case "oracle":
      return `UPPER(TO_CHAR(${columnExpression})) LIKE UPPER(${literal}) ESCAPE '!'`;
    case "mssql":
      return `CAST(${columnExpression} AS NVARCHAR(MAX)) LIKE ${literal} ESCAPE '!'`;
    case "mysql":
      return `CAST(${columnExpression} AS CHAR) LIKE ${literal} ESCAPE '!'`;
    case "sqlite":
    case "sqlite_http":
      return `CAST(${columnExpression} AS TEXT) LIKE ${literal} ESCAPE '!'`;
    case "elasticsearch":
      return `${columnExpression} LIKE ${literal} ESCAPE '!'`;
    case "influxdb":
      return `CAST(${columnExpression} AS VARCHAR) ILIKE ${literal} ESCAPE '\\'`;
    case "clickhouse":
      return `toString(${columnExpression}) ILIKE ${literal}`;
    case "odbc":
      return `UPPER(CAST(${columnExpression} AS VARCHAR(4000))) LIKE UPPER(${literal}) ESCAPE '!'`;
    case "duckdb":
    case "snowflake":
      return `CAST(${columnExpression} AS VARCHAR) ILIKE ${literal} ESCAPE '!'`;
    case "athena":
      return `LOWER(CAST(${columnExpression} AS VARCHAR)) LIKE LOWER(${literal}) ESCAPE '!'`;
    case "bigquery":
      return `LOWER(CAST(${columnExpression} AS STRING)) LIKE LOWER(${literal})`;
    case "cassandra":
    case "mongodb":
    case "redis":
      return "";
    default:
      return `${columnExpression}::text ILIKE ${literal} ESCAPE '!'`;
  }
}
