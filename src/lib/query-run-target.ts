import { sqlToRun, statementAtOffset } from "@/lib/sql-statements";

export type QueryRunTarget = "selection-or-all" | "selection-or-statement" | "all";

export function resolveQueryRunTarget(
  sql: string,
  selection: string,
  offset: number,
  target: QueryRunTarget,
  dialect?: string,
): string {
  if (target === "all") return sql;
  if (target === "selection-or-all") return sqlToRun(sql, selection);
  if (selection.trim()) return selection;
  return statementAtOffset(sql, offset, dialect)?.text ?? "";
}
