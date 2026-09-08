import { format } from "sql-formatter";
import type { Capabilities, DatabaseKind } from "@/lib/db";

export type SqlDialect =
  | "sql"
  | "postgresql"
  | "mysql"
  | "sqlite"
  | "transactsql"
  | "clickhouse"
  | "plsql"
  | "duckdb";

export type SqlKeywordCaseOption = "upper" | "lower" | "preserve";

export const DEFAULT_SQL_DIALECT: SqlDialect = "sql";

const DIALECT_BY_KIND: Partial<Record<DatabaseKind, SqlDialect>> = {
  postgres: "postgresql",
  mysql: "mysql",
  sqlite: "sqlite",
  mssql: "transactsql",
  clickhouse: "clickhouse",
  oracle: "plsql",
  duckdb: "duckdb",
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

export type SqlFormatResult =
  | { ok: true; sql: string }
  | { ok: false; sql: string; reason: string };

export function formatSqlWith(sql: string, options: SqlFormatOptions): SqlFormatResult {
  try {
    return {
      ok: true,
      sql: format(sql, {
        language: options.dialect,
        tabWidth: options.tabWidth,
        keywordCase: options.keywordCase,
        linesBetweenQueries: options.linesBetweenQueries ?? 2,
        denseOperators: options.denseOperators ?? false,
        newlineBeforeSemicolon: options.newlineBeforeSemicolon ?? false,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      sql,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
