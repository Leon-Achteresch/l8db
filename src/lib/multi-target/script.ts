import type { DatabaseKind } from "@/lib/db/providers";
import { scriptPolicyIssue } from "@/lib/sql-safety";
import { splitSqlStatements } from "@/lib/sql-statements";

export function scriptStatementCount(sql: string, kind: DatabaseKind | null | undefined): number {
  return splitSqlStatements(sql, kind ?? undefined).statements.length;
}

export function partialRiskStatements(sql: string, kind: DatabaseKind | null | undefined): number {
  const count = scriptStatementCount(sql, kind);
  if (count <= 1) return count;
  if (kind === "postgres" && scriptPolicyIssue(sql, kind, false) === null) return 1;
  return count;
}
