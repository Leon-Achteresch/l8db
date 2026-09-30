import { splitSqlStatements } from "@/lib/sql-statements";
import { sqlCode } from "./sql-code";
import type { DeployKind } from "./types";

export const SEED_PATH = "database/seeds/seed.sql";

export function seedBranchAllowed(branch: string | null | undefined) {
  return Boolean(
    branch &&
      !["main", "master", "trunk", "production", "prod", "head"].includes(branch.toLowerCase()),
  );
}

export function seedStatementCount(sql: string, kind: DeployKind) {
  const split = splitSqlStatements(sql, kind);
  if (split.unterminated || !split.statements.length)
    throw new Error("Seed-SQL ist leer oder unvollständig.");
  for (const statement of split.statements) {
    if (!/^INSERT\s+INTO\b[\s\S]*\bVALUES\s*\(/i.test(sqlCode(statement.text)))
      throw new Error("Seeds dürfen nur INSERT INTO … VALUES enthalten.");
  }
  return split.statements.length;
}
