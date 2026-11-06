import { format } from "sql-formatter";
import type { SqlFormatOptions } from "./sql-format-options";

export type { SqlDialect, SqlFormatOptions, SqlKeywordCaseOption } from "./sql-format-options";
export {
  DEFAULT_SQL_DIALECT,
  sqlDialectForKind,
  sqlDialectLabel,
  supportsSqlFormatting,
} from "./sql-format-options";

export type SqlFormatResult =
  | { ok: true; sql: string }
  | { ok: false; sql: string; reason: string };

const COLON_PARAM_DIALECTS = new Set<SqlFormatOptions["dialect"]>([
  "sql",
  "postgresql",
  "mysql",
  "transactsql",
  "duckdb",
  "clickhouse",
  "bigquery",
]);

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
        ...(COLON_PARAM_DIALECTS.has(options.dialect)
          ? { paramTypes: { named: [":", "@"] as (":" | "@")[] } }
          : {}),
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
