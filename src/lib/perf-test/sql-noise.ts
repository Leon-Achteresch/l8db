const READ_ONLY_START = /^(select|with|table|values|show)\b/i;

const WRITING_KEYWORD =
  /\b(insert|update|delete|merge|truncate|drop|alter|create|grant|revoke|call|do|vacuum|refresh)\b/i;

export function stripSqlNoise(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/;+$/, "")
    .trim();
}

export function isReadOnlyStatement(sql: string): boolean {
  const cleaned = stripSqlNoise(sql);
  if (cleaned.length === 0) return false;
  if (cleaned.includes(";")) return false;
  if (!READ_ONLY_START.test(cleaned)) return false;
  return !WRITING_KEYWORD.test(cleaned);
}
