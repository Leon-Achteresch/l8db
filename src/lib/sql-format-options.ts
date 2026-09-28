import type { Capabilities, DatabaseKind } from "@/lib/db";

export type SqlDialect =
  | "sql"
  | "postgresql"
  | "mysql"
  | "sqlite"
  | "transactsql"
  | "clickhouse"
  | "plsql"
  | "duckdb"
  | "bigquery"
  | "snowflake";

export type SqlKeywordCaseOption = "upper" | "lower" | "preserve";

export const DEFAULT_SQL_DIALECT: SqlDialect = "sql";

const DIALECT_BY_KIND: Partial<Record<DatabaseKind, SqlDialect>> = {
  postgres: "postgresql",
  mysql: "mysql",
  sqlite: "sqlite",
  sqlite_http: "sqlite",
  mssql: "transactsql",
  clickhouse: "clickhouse",
  oracle: "plsql",
  duckdb: "duckdb",
  bigquery: "bigquery",
  snowflake: "snowflake",
};

const DIALECT_LABELS: Record<SqlDialect, string> = {
  sql: "Standard-SQL",
  postgresql: "PostgreSQL",
  mysql: "MySQL",
  sqlite: "SQLite",
  transactsql: "Transact-SQL",
  clickhouse: "ClickHouse",
  plsql: "PL/SQL",
  duckdb: "DuckDB",
  bigquery: "BigQuery",
  snowflake: "Snowflake",
};

export function sqlDialectForKind(kind: DatabaseKind | null | undefined): SqlDialect {
  if (!kind) return DEFAULT_SQL_DIALECT;
  return DIALECT_BY_KIND[kind] ?? DEFAULT_SQL_DIALECT;
}

export function sqlDialectLabel(dialect: SqlDialect): string {
  return DIALECT_LABELS[dialect] ?? DIALECT_LABELS.sql;
}

export function supportsSqlFormatting(
  queryLanguage: Capabilities["query_language"] | null | undefined,
): boolean {
  return queryLanguage === "sql";
}

export interface SqlFormatOptions {
  dialect: SqlDialect;
  tabWidth: number;
  keywordCase: SqlKeywordCaseOption;
  linesBetweenQueries?: number;
  denseOperators?: boolean;
  newlineBeforeSemicolon?: boolean;
}
