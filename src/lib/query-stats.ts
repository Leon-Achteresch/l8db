import type { DatabaseKind, QueryResult } from "@/lib/db";

export interface QueryStatEntry {
  sql: string;
  calls: number | null;
  totalMs: number | null;
  meanMs: number | null;
  maxMs: number | null;
  rows: number | null;
}

export const QUERY_STATS_LIMITS = [10, 25, 50, 100] as const;

export const QUERY_STATS_DEFAULT_LIMIT = 25;

export function queryStatsSource(kind: DatabaseKind | null | undefined): string | null {
  switch (kind) {
    case "postgres":
      return "pg_stat_statements";
    case "mysql":
      return "performance_schema.events_statements_summary_by_digest";
    case "mssql":
      return "sys.dm_exec_query_stats";
    case "clickhouse":
      return "system.query_log";
    case "oracle":
      return "v$sqlarea";
    default:
      return null;
  }
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return QUERY_STATS_DEFAULT_LIMIT;
  return Math.min(500, Math.max(1, Math.floor(limit)));
}

export function queryStatsSql(kind: DatabaseKind, limit: number, fallback = false): string | null {
  const n = clampLimit(limit);
  switch (kind) {
    case "postgres":
      return (
        "SELECT s.query AS query, s.calls AS calls, s.total_exec_time AS total_ms, " +
        "s.mean_exec_time AS mean_ms, s.max_exec_time AS max_ms, s.rows AS rows_total " +
        "FROM pg_stat_statements s JOIN pg_database d ON d.oid = s.dbid " +
        "WHERE d.datname = current_database() AND s.query NOT ILIKE '%pg_stat_statements%' " +
        `ORDER BY s.total_exec_time DESC LIMIT ${n}`
      );
    case "mysql": {
      const text = fallback ? "DIGEST_TEXT" : "COALESCE(QUERY_SAMPLE_TEXT, DIGEST_TEXT)";
      return (
        `SELECT ${text} AS query, COUNT_STAR AS calls, SUM_TIMER_WAIT / 1000000000 AS total_ms, ` +
        "AVG_TIMER_WAIT / 1000000000 AS mean_ms, MAX_TIMER_WAIT / 1000000000 AS max_ms, " +
        "SUM_ROWS_SENT AS rows_total FROM performance_schema.events_statements_summary_by_digest " +
        "WHERE DIGEST_TEXT IS NOT NULL AND (SCHEMA_NAME = DATABASE() OR DATABASE() IS NULL) " +
        "AND DIGEST_TEXT NOT LIKE '%events_statements_summary_by_digest%' " +
        `ORDER BY SUM_TIMER_WAIT DESC LIMIT ${n}`
      );
    }
    case "mssql":
      return (
        `SELECT TOP (${n}) SUBSTRING(t.text, (s.statement_start_offset / 2) + 1, ` +
        "((CASE s.statement_end_offset WHEN -1 THEN DATALENGTH(t.text) ELSE s.statement_end_offset END " +
        "- s.statement_start_offset) / 2) + 1) AS query, s.execution_count AS calls, " +
        "s.total_elapsed_time / 1000.0 AS total_ms, " +
        "s.total_elapsed_time / 1000.0 / NULLIF(s.execution_count, 0) AS mean_ms, " +
        "s.max_elapsed_time / 1000.0 AS max_ms, s.total_rows AS rows_total " +
        "FROM sys.dm_exec_query_stats s CROSS APPLY sys.dm_exec_sql_text(s.sql_handle) t " +
        "WHERE (t.dbid = DB_ID() OR t.dbid IS NULL) AND t.text NOT LIKE '%dm_exec_query_stats%' " +
        "ORDER BY s.total_elapsed_time DESC"
      );
    case "clickhouse":
      return (
        "SELECT any(query) AS query, count() AS calls, sum(query_duration_ms) AS total_ms, " +
        "avg(query_duration_ms) AS mean_ms, max(query_duration_ms) AS max_ms, sum(read_rows) AS rows_total " +
        "FROM system.query_log WHERE type = 'QueryFinish' AND is_initial_query " +
        "AND event_time > now() - INTERVAL 1 DAY AND current_database = currentDatabase() " +
        "GROUP BY normalized_query_hash HAVING query NOT ILIKE '%system.query_log%' " +
        `ORDER BY total_ms DESC LIMIT ${n}`
      );
    case "oracle":
      return (
        "SELECT * FROM (SELECT sql_text AS query, executions AS calls, elapsed_time / 1000 AS total_ms, " +
        "elapsed_time / 1000 / NULLIF(executions, 0) AS mean_ms, NULL AS max_ms, " +
        "rows_processed AS rows_total FROM v$sqlarea WHERE executions > 0 " +
        "AND parsing_schema_name NOT IN (SELECT username FROM all_users WHERE oracle_maintained = 'Y') " +
        "AND sql_text NOT LIKE '%v$sqlarea%' " +
        `ORDER BY elapsed_time DESC) WHERE ROWNUM <= ${n}`
      );
    default:
      return null;
  }
}

function field(row: Record<string, unknown>, name: string): unknown {
  if (name in row) return row[name];
  const wanted = name.toLowerCase();
  for (const key of Object.keys(row)) {
    if (key.toLowerCase() === wanted) return row[key];
  }
  return undefined;
}

export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function parseQueryStats(result: QueryResult): QueryStatEntry[] {
  return result.rows
    .map((row) => ({
      sql: String(field(row, "query") ?? "").trim(),
      calls: toNumber(field(row, "calls")),
      totalMs: toNumber(field(row, "total_ms")),
      meanMs: toNumber(field(row, "mean_ms")),
      maxMs: toNumber(field(row, "max_ms")),
      rows: toNumber(field(row, "rows_total")),
    }))
    .filter((entry) => entry.sql.length > 0);
}

export function queryStatsHint(kind: DatabaseKind, message: string): string | null {
  switch (kind) {
    case "postgres":
      return /pg_stat_statements/i.test(message)
        ? "Die Extension pg_stat_statements ist nicht aktiv: shared_preload_libraries = 'pg_stat_statements' in postgresql.conf setzen, den Server neu starten und CREATE EXTENSION pg_stat_statements ausführen."
        : null;
    case "mysql":
      return /performance_schema|denied/i.test(message)
        ? "performance_schema muss aktiv sein (performance_schema = ON) und der Benutzer braucht SELECT-Recht darauf."
        : null;
    case "mssql":
      return /permission|VIEW SERVER STATE/i.test(message)
        ? "Der Login braucht die Berechtigung VIEW SERVER STATE."
        : null;
    case "oracle":
      return /ORA-00942|does not exist|existiert nicht/i.test(message)
        ? "Der Benutzer braucht Leserecht auf V$SQLAREA (GRANT SELECT ON V_$SQLAREA oder SELECT_CATALOG_ROLE)."
        : null;
    case "clickhouse":
      return /query_log/i.test(message)
        ? "system.query_log ist nicht aktiv. Die Einstellung log_queries = 1 muss gesetzt sein."
        : null;
    default:
      return null;
  }
}

export async function loadQueryStats(
  kind: DatabaseKind,
  limit: number,
  run: (sql: string) => Promise<QueryResult>,
): Promise<QueryStatEntry[]> {
  const primary = queryStatsSql(kind, limit);
  if (!primary) {
    throw new Error("Diese Datenbank stellt keine Statement-Statistik bereit.");
  }
  try {
    return parseQueryStats(await run(primary));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const fallback = queryStatsSql(kind, limit, true);
    if (fallback && fallback !== primary && /QUERY_SAMPLE_TEXT/i.test(message)) {
      return parseQueryStats(await run(fallback));
    }
    const hint = queryStatsHint(kind, message);
    throw new Error(hint ? `${hint} (${message})` : message);
  }
}
