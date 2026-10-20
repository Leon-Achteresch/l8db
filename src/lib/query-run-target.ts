import {
  type SqlSplitOptions,
  splitSqlStatements,
  sqlToRun,
  statementAtOffset,
} from "@/lib/sql-statements";

export type QueryRunTarget = "selection-or-all" | "selection-or-statement" | "all";

export interface QueryRunTargetOptions extends SqlSplitOptions {
  sqlOnly?: boolean;
}

function pick(
  sql: string,
  selection: string,
  offset: number,
  target: QueryRunTarget,
  dialect: string | undefined,
  options: SqlSplitOptions,
): string {
  if (target === "all") return sql;
  if (target === "selection-or-all") return sqlToRun(sql, selection);
  if (selection.trim()) return selection;
  return statementAtOffset(sql, offset, dialect, options)?.text ?? "";
}

export function resolveQueryRunTarget(
  sql: string,
  selection: string,
  offset: number,
  target: QueryRunTarget,
  dialect?: string,
  options: QueryRunTargetOptions = {},
): string {
  const text = pick(sql, selection, offset, target, dialect, options);
  if (!options.sqlOnly || dialect !== "oracle") return text;
  const split = splitSqlStatements(text, dialect, options);
  return split.statements.length === 0 && split.commands.length > 0 ? "" : text;
}
